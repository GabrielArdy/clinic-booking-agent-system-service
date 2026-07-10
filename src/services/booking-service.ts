import type { Database, Executor } from "../db/executor.js";
import { DomainError, type Booking, type Doctor, type Patient, type Slot, type Specialty } from "../domain/types.js";
import type { Repositories, RepositoryFactory } from "../repositories/ports.js";
import { generateBookingReference } from "./booking-reference.js";
import { normalizePhone } from "./phone.js";
import { computeSlots, weekdayOf } from "./slots.js";

export interface CreateBookingInput {
  doctorId: number;
  date: string;
  startTime: string;
  patientName: string;
  patientPhone: string;
}

export interface BookingResult {
  booking: Booking;
  doctor: Doctor;
  patient: Patient;
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
  ) {
    this.repos = makeRepos(db);
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

  getAvailableSlots(doctorId: number, date: string): Promise<Slot[]> {
    return this.computeAvailableSlots(this.repos, doctorId, date);
  }

  /** Slot computation over an arbitrary repositories bundle (base or tx-scoped). */
  private async computeAvailableSlots(
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
    const booked = await repos.bookings.activeStartTimes(doctorId, date);
    return computeSlots(date, rules, exceptions, booked);
  }

  /** Next N dates (starting tomorrow) on which the doctor has a free slot. */
  async getAvailableDates(doctorId: number, count = 5, horizonDays = 30): Promise<string[]> {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 1; i <= horizonDays && dates.length < count; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      if ((await this.getAvailableSlots(doctorId, iso)).length > 0) dates.push(iso);
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

    try {
      // Transaction: re-verify availability, then insert. The partial unique
      // index on (doctor_id, date, start_time) WHERE status='active' is the
      // final guard against a concurrent write.
      return await this.db.tx(async (ex: Executor): Promise<BookingResult> => {
        const repos = this.makeRepos(ex);
        const slots = await this.computeAvailableSlots(repos, input.doctorId, input.date);
        const slot = slots.find((s) => s.startTime === input.startTime);
        if (!slot) {
          throw new DomainError("SLOT_TAKEN", "Slot is no longer available");
        }

        const patient = await this.createOrFindPatient(repos, input.patientName, input.patientPhone);

        let reference = generateBookingReference();
        while (await repos.bookings.findByReference(reference)) {
          reference = generateBookingReference();
        }

        let booking: Booking;
        try {
          booking = await repos.bookings.create({
            reference,
            patientId: patient.id,
            doctorId: doctor.id,
            date: slot.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
          });
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
      await repos.bookings.cancel(booking.id);
      await repos.audit.record("booking_cancelled", { reference: booking.reference });
      return { ...booking, status: "cancelled" };
    });
  }

  listBookings(doctorId: number, date: string): Promise<Booking[]> {
    return this.repos.bookings.listByDoctorDate(doctorId, date);
  }
}
