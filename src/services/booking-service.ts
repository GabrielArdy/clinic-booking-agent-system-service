import type { Database, Executor } from "../db/executor.js";
import {
  DomainError,
  type AppointmentDaySummary,
  type AppointmentEntry,
  type Booking,
  type Doctor,
  type Patient,
  type ScheduleException,
  type Slot,
  type Specialty,
} from "../domain/types.js";
import type { Repositories, RepositoryFactory } from "../repositories/ports.js";
import { generateBookingReference } from "./booking-reference.js";
import { normalizePhone } from "./phone.js";
import { InMemorySlotLock, slotLockKey, type SlotLock } from "./slot-lock.js";
import { computeSlots, slotStartDate, weekdayOf } from "./slots.js";

/** Bookings must be made at least this long before the appointment starts. */
export const MIN_BOOKING_LEAD_HOURS = 6;
/** Cancellations close this long before the appointment starts. */
export const MIN_CANCEL_LEAD_HOURS = 2;

const HOUR_MS = 60 * 60 * 1000;

export interface CreateBookingInput {
  doctorId: number;
  date: string;
  startTime: string;
  patientName: string;
  patientPhone: string;
  /** Session that held the slot; its own hold never blocks it. */
  holderId?: string;
}

export interface BookingResult {
  booking: Booking;
  doctor: Doctor;
  patient: Patient;
}

export interface BookingLookup {
  booking: Booking;
  doctor: Doctor;
  /** Active and still outside the 2h cancellation cutoff. */
  canCancel: boolean;
}

/**
 * Deterministic booking application service. The single source of truth for
 * booking validity — AI never writes here directly. Async and database-agnostic:
 * works over sqlite or postgres via the injected repository factory.
 */
export class BookingService {
  private readonly repos: Repositories;

  constructor(
    private readonly db: Database,
    private readonly makeRepos: RepositoryFactory,
    /** Injectable clock for testing time-based rules. */
    private readonly now: () => Date = () => new Date(),
    /** Redis-backed in production; in-memory fallback for dev/tests. */
    private readonly slotLock: SlotLock = new InMemorySlotLock(),
  ) {
    this.repos = makeRepos(db);
  }

  /** True when the slot still satisfies the 6h booking lead time. */
  private meetsBookingLead(date: string, startTime: string): boolean {
    return (
      slotStartDate(date, startTime).getTime() - this.now().getTime() >=
      MIN_BOOKING_LEAD_HOURS * HOUR_MS
    );
  }

  listSpecialties(): Promise<Specialty[]> {
    return this.repos.specialties.listActive();
  }

  async listDoctorsBySpecialty(specialtyId: number): Promise<Doctor[]> {
    const specialty = await this.repos.specialties.findById(specialtyId);
    if (!specialty) throw new DomainError("NOT_FOUND", "Specialty not found");
    return this.repos.doctors.listActiveBySpecialty(specialtyId);
  }

  async getDoctor(doctorId: number): Promise<Doctor> {
    const doctor = await this.repos.doctors.findById(doctorId);
    if (!doctor || !doctor.active) throw new DomainError("NOT_FOUND", "Doctor not found");
    return doctor;
  }

  /**
   * All slots for the date, unavailable ones included and flagged:
   * full (at capacity), lead_time (starts in less than 6h), or held (the
   * remaining seats are locked by other in-progress booking sessions).
   * `holderId` = requesting session, whose own hold never blocks it.
   */
  async getAvailableSlots(doctorId: number, date: string, holderId?: string): Promise<Slot[]> {
    const slots = await this.computeDaySlots(this.repos, doctorId, date);
    return Promise.all(
      slots.map(async (s) => {
        if (!s.available) return s;
        if (!this.meetsBookingLead(s.date, s.startTime)) {
          return { ...s, available: false, unavailableReason: "lead_time" as const };
        }
        const held = await this.slotLock.countOthers(
          slotLockKey(doctorId, s.date, s.startTime),
          holderId,
        );
        if (s.bookedCount + held >= s.capacity) {
          return { ...s, available: false, unavailableReason: "held" as const };
        }
        return s;
      }),
    );
  }

  /**
   * Locks one seat of a slot for the session while it finishes the booking
   * flow. Auto-expires after the lock TTL (5 min) when the flow goes idle.
   */
  async holdSlot(
    doctorId: number,
    date: string,
    startTime: string,
    holderId: string,
  ): Promise<void> {
    const slots = await this.getAvailableSlots(doctorId, date, holderId);
    const slot = slots.find((s) => s.startTime === startTime);
    if (!slot || !slot.available) {
      const message =
        slot?.unavailableReason === "held"
          ? "Slot is currently being booked by someone else"
          : "Slot is no longer available";
      throw new DomainError("SLOT_TAKEN", message);
    }
    const acquired = await this.slotLock.acquire(
      slotLockKey(doctorId, date, startTime),
      holderId,
      slot.capacity - slot.bookedCount,
    );
    if (!acquired) {
      throw new DomainError("SLOT_TAKEN", "Slot is currently being booked by someone else");
    }
  }

  /** Releases the session's hold, e.g. on cancel, restart, or slot change. */
  async releaseHold(
    doctorId: number,
    date: string,
    startTime: string,
    holderId: string,
  ): Promise<void> {
    await this.slotLock.release(slotLockKey(doctorId, date, startTime), holderId);
  }

  /** Slot computation over an arbitrary repositories bundle (base or tx-scoped). */
  private async computeDaySlots(
    repos: Repositories,
    doctorId: number,
    date: string,
  ): Promise<Slot[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new DomainError("INVALID_INPUT", "Date must be YYYY-MM-DD");
    }
    const doctor = await repos.doctors.findById(doctorId);
    if (!doctor || !doctor.active) throw new DomainError("NOT_FOUND", "Doctor not found");
    const rules = await repos.schedules.rulesForDoctorWeekday(doctorId, weekdayOf(date));
    const exceptions = await repos.schedules.exceptionsForDoctorDate(doctorId, date);
    const bookedCounts = await repos.bookings.activeSlotCounts(doctorId, date);
    return computeSlots(date, rules, exceptions, bookedCounts);
  }

  /** Next N dates (starting tomorrow) on which the doctor has a free slot. */
  async getAvailableDates(doctorId: number, count = 5, horizonDays = 30): Promise<string[]> {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 1; i <= horizonDays && dates.length < count; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      if ((await this.getAvailableSlots(doctorId, iso)).some((s) => s.available)) dates.push(iso);
    }
    return dates;
  }

  async createOrFindPatient(repos: Repositories, fullName: string, rawPhone: string): Promise<Patient> {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new DomainError("INVALID_INPUT", "Invalid phone number");
    const existing = await repos.patients.findByPhone(phone);
    if (existing) return existing;
    return repos.patients.create(fullName.trim(), phone);
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const doctor = await this.getDoctor(input.doctorId);
    if (!this.meetsBookingLead(input.date, input.startTime)) {
      throw new DomainError(
        "TOO_LATE_TO_BOOK",
        `Appointments must be booked at least ${MIN_BOOKING_LEAD_HOURS} hours in advance`,
      );
    }

    try {
      // Transaction: re-verify availability, then insert. The partial unique
      // index on (doctor_id, date, start_time, slot_seq) WHERE status='active'
      // is the final guard against a concurrent write claiming the same seat.
      const result = await this.db.tx(async (ex: Executor): Promise<BookingResult> => {
        const repos = this.makeRepos(ex);
        const slots = await this.computeDaySlots(repos, input.doctorId, input.date);
        const slot = slots.find((s) => s.startTime === input.startTime);
        if (!slot || !slot.available) {
          throw new DomainError("SLOT_TAKEN", "Slot is no longer available");
        }

        // Other sessions' holds also reserve seats until they expire.
        const held = await this.slotLock.countOthers(
          slotLockKey(input.doctorId, input.date, slot.startTime),
          input.holderId,
        );
        if (slot.bookedCount + held >= slot.capacity) {
          throw new DomainError("SLOT_TAKEN", "Slot is currently being booked by someone else");
        }

        const patient = await this.createOrFindPatient(repos, input.patientName, input.patientPhone);

        let reference = generateBookingReference();
        while (await repos.bookings.findByReference(reference)) {
          reference = generateBookingReference();
        }

        // Smallest free seat: cancellations can leave gaps, so counting is not enough.
        const takenSeats = await repos.bookings.activeSlotSeqs(
          input.doctorId,
          input.date,
          slot.startTime,
        );
        let slotSeq = 0;
        while (takenSeats.has(slotSeq)) slotSeq++;
        if (slotSeq >= slot.capacity) {
          throw new DomainError("SLOT_TAKEN", "Slot is no longer available");
        }

        let booking: Booking;
        try {
          booking = await repos.bookings.create(
            {
              reference,
              patientId: patient.id,
              doctorId: doctor.id,
              date: slot.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
            },
            slotSeq,
          );
        } catch (err) {
          if (err instanceof Error && /unique/i.test(err.message)) {
            throw new DomainError("SLOT_TAKEN", "Slot is no longer available");
          }
          throw err;
        }

        await repos.audit.record("booking_created", {
          reference,
          doctorId: doctor.id,
          patientId: patient.id,
          date: slot.date,
          startTime: slot.startTime,
        });

        return { booking, doctor, patient };
      });

      // Booking persisted: the session's own hold has served its purpose.
      if (input.holderId) {
        await this.releaseHold(input.doctorId, input.date, input.startTime, input.holderId);
      }
      return result;
    } catch (err) {
      await this.repos.audit.record("booking_failed", {
        doctorId: input.doctorId,
        date: input.date,
        startTime: input.startTime,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** True when the booking can still be cancelled (2h cutoff before start). */
  private meetsCancelLead(booking: Booking): boolean {
    return (
      slotStartDate(booking.date, booking.startTime).getTime() - this.now().getTime() >=
      MIN_CANCEL_LEAD_HOURS * HOUR_MS
    );
  }

  /**
   * Looks up a booking by reference + phone (patient verification) for the
   * check-appointment flow. Cancelling it later still re-verifies everything.
   */
  async findBookingForPatient(reference: string, rawPhone: string): Promise<BookingLookup> {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new DomainError("INVALID_INPUT", "Invalid phone number");
    const booking = await this.repos.bookings.findByReference(reference.trim().toUpperCase());
    if (!booking) throw new DomainError("NOT_FOUND", "Booking not found");
    const patient = await this.repos.patients.findById(booking.patientId);
    if (!patient || patient.phone !== phone) {
      throw new DomainError("PHONE_MISMATCH", "Phone number does not match booking");
    }
    const doctor = await this.repos.doctors.findById(booking.doctorId);
    if (!doctor) throw new DomainError("NOT_FOUND", "Doctor not found");
    return {
      booking,
      doctor,
      canCancel: booking.status === "active" && this.meetsCancelLead(booking),
    };
  }

  async cancelBooking(reference: string, rawPhone: string): Promise<Booking> {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new DomainError("INVALID_INPUT", "Invalid phone number");

    return this.db.tx(async (ex): Promise<Booking> => {
      const repos = this.makeRepos(ex);
      const booking = await repos.bookings.findByReference(reference.trim().toUpperCase());
      if (!booking) throw new DomainError("NOT_FOUND", "Booking not found");
      if (booking.status === "cancelled") {
        throw new DomainError("ALREADY_CANCELLED", "Booking already cancelled");
      }
      const patient = await repos.patients.findById(booking.patientId);
      if (!patient || patient.phone !== phone) {
        throw new DomainError("PHONE_MISMATCH", "Phone number does not match booking");
      }
      if (!this.meetsCancelLead(booking)) {
        throw new DomainError(
          "TOO_LATE_TO_CANCEL",
          `Cancellation is closed within ${MIN_CANCEL_LEAD_HOURS} hours of the appointment`,
        );
      }
      // Cancelling releases the seat: slot availability counts active bookings
      // only, so the freed seat is immediately bookable again.
      await repos.bookings.cancel(booking.id);
      await repos.audit.record("booking_cancelled", { reference: booking.reference });
      return { ...booking, status: "cancelled" };
    });
  }

  listBookings(doctorId: number, date: string): Promise<Booking[]> {
    return this.repos.bookings.listByDoctorDate(doctorId, date);
  }

  /**
   * Appointments of one doctor within [from, to] for the admin schedule
   * planner: enriched entries for the list, schedule exceptions (blocking
   * time), and per-date summaries for the calendar. Range capped at 92 days.
   */
  async listAppointments(
    doctorId: number,
    from: string,
    to: string,
  ): Promise<{
    doctor: Doctor;
    appointments: AppointmentEntry[];
    exceptions: ScheduleException[];
    days: AppointmentDaySummary[];
  }> {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(from) || !datePattern.test(to)) {
      throw new DomainError("INVALID_INPUT", "Dates must be YYYY-MM-DD");
    }
    if (from > to) {
      throw new DomainError("INVALID_INPUT", "'from' must not be after 'to'");
    }
    const spanDays =
      (slotStartDate(to, "00:00").getTime() - slotStartDate(from, "00:00").getTime()) /
        (24 * HOUR_MS) +
      1;
    if (spanDays > 92) {
      throw new DomainError("INVALID_INPUT", "Date range must not exceed 92 days");
    }
    // Inactive doctors keep their history visible on the admin planner.
    const doctor = await this.repos.doctors.findById(doctorId);
    if (!doctor) throw new DomainError("NOT_FOUND", "Doctor not found");

    const [appointments, exceptions] = await Promise.all([
      this.repos.bookings.listByDoctorRangeWithPatient(doctorId, from, to),
      this.repos.schedules.exceptionsForDoctorRange(doctorId, from, to),
    ]);

    const byDate = new Map<string, AppointmentDaySummary>();
    const dayFor = (date: string): AppointmentDaySummary => {
      const day = byDate.get(date) ?? {
        date,
        total: 0,
        active: 0,
        cancelled: 0,
        exceptions: 0,
        blocked: false,
      };
      byDate.set(date, day);
      return day;
    };
    for (const appt of appointments) {
      const day = dayFor(appt.date);
      day.total += 1;
      if (appt.status === "active") day.active += 1;
      else day.cancelled += 1;
    }
    for (const ex of exceptions) {
      const day = dayFor(ex.date);
      day.exceptions += 1;
      // Whole-day exception (no time window) blocks the entire date.
      if (ex.startTime === null || ex.endTime === null) day.blocked = true;
    }

    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { doctor, appointments, exceptions, days };
  }
}
