import type { DB } from "../db/connection.js";
import { DomainError, type Booking, type Doctor, type Patient, type Slot, type Specialty } from "../domain/types.js";
import { AuditRepository } from "../repositories/audit-repository.js";
import { BookingRepository } from "../repositories/booking-repository.js";
import { DoctorRepository } from "../repositories/doctor-repository.js";
import { PatientRepository } from "../repositories/patient-repository.js";
import { ScheduleRepository } from "../repositories/schedule-repository.js";
import { SpecialtyRepository } from "../repositories/specialty-repository.js";
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
 * booking validity — AI never writes here directly.
 */
export class BookingService {
  private readonly specialties: SpecialtyRepository;
  private readonly doctors: DoctorRepository;
  private readonly schedules: ScheduleRepository;
  private readonly patients: PatientRepository;
  private readonly bookings: BookingRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: DB) {
    this.specialties = new SpecialtyRepository(db);
    this.doctors = new DoctorRepository(db);
    this.schedules = new ScheduleRepository(db);
    this.patients = new PatientRepository(db);
    this.bookings = new BookingRepository(db);
    this.audit = new AuditRepository(db);
  }

  listSpecialties(): Specialty[] {
    return this.specialties.listActive();
  }

  listDoctorsBySpecialty(specialtyId: number): Doctor[] {
    const specialty = this.specialties.findById(specialtyId);
    if (!specialty) throw new DomainError("NOT_FOUND", "Specialty not found");
    return this.doctors.listActiveBySpecialty(specialtyId);
  }

  getDoctor(doctorId: number): Doctor {
    const doctor = this.doctors.findById(doctorId);
    if (!doctor || !doctor.active) throw new DomainError("NOT_FOUND", "Doctor not found");
    return doctor;
  }

  getAvailableSlots(doctorId: number, date: string): Slot[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new DomainError("INVALID_INPUT", "Date must be YYYY-MM-DD");
    }
    this.getDoctor(doctorId);
    const rules = this.schedules.rulesForDoctorWeekday(doctorId, weekdayOf(date));
    const exceptions = this.schedules.exceptionsForDoctorDate(doctorId, date);
    const booked = this.bookings.activeStartTimes(doctorId, date);
    return computeSlots(date, rules, exceptions, booked);
  }

  /** Next N dates (starting tomorrow) on which the doctor has at least one free slot. */
  getAvailableDates(doctorId: number, count = 5, horizonDays = 30): string[] {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 1; i <= horizonDays && dates.length < count; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      if (this.getAvailableSlots(doctorId, iso).length > 0) dates.push(iso);
    }
    return dates;
  }

  createOrFindPatient(fullName: string, rawPhone: string): Patient {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new DomainError("INVALID_INPUT", "Invalid phone number");
    const existing = this.patients.findByPhone(phone);
    if (existing) return existing;
    return this.patients.create(fullName.trim(), phone);
  }

  createBooking(input: CreateBookingInput): BookingResult {
    const doctor = this.getDoctor(input.doctorId);

    // Transaction: re-verify availability, then insert. The partial unique
    // index on (doctor_id, date, start_time) WHERE status='active' is the
    // final guard against a concurrent write.
    const txn = this.db.transaction((): BookingResult => {
      const slots = this.getAvailableSlots(input.doctorId, input.date);
      const slot = slots.find((s) => s.startTime === input.startTime);
      if (!slot) {
        throw new DomainError("SLOT_TAKEN", "Slot is no longer available");
      }

      const patient = this.createOrFindPatient(input.patientName, input.patientPhone);

      let reference = generateBookingReference();
      while (this.bookings.findByReference(reference)) {
        reference = generateBookingReference();
      }

      let booking: Booking;
      try {
        booking = this.bookings.create({
          reference,
          patientId: patient.id,
          doctorId: doctor.id,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE")) {
          throw new DomainError("SLOT_TAKEN", "Slot is no longer available");
        }
        throw err;
      }

      this.audit.record("booking_created", {
        reference,
        doctorId: doctor.id,
        patientId: patient.id,
        date: slot.date,
        startTime: slot.startTime,
      });

      return { booking, doctor, patient };
    });

    try {
      return txn();
    } catch (err) {
      this.audit.record("booking_failed", {
        doctorId: input.doctorId,
        date: input.date,
        startTime: input.startTime,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  cancelBooking(reference: string, rawPhone: string): Booking {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new DomainError("INVALID_INPUT", "Invalid phone number");

    const txn = this.db.transaction((): Booking => {
      const booking = this.bookings.findByReference(reference.trim().toUpperCase());
      if (!booking) throw new DomainError("NOT_FOUND", "Booking not found");
      if (booking.status === "cancelled") {
        throw new DomainError("ALREADY_CANCELLED", "Booking already cancelled");
      }
      const patient = this.patients.findById(booking.patientId);
      if (!patient || patient.phone !== phone) {
        throw new DomainError("PHONE_MISMATCH", "Phone number does not match booking");
      }
      this.bookings.cancel(booking.id);
      this.audit.record("booking_cancelled", { reference: booking.reference });
      return { ...booking, status: "cancelled" };
    });
    return txn();
  }

  listBookings(doctorId: number, date: string): Booking[] {
    return this.bookings.listByDoctorDate(doctorId, date);
  }
}
