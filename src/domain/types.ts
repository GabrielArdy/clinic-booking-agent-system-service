export interface Specialty {
  id: number;
  name: string;
  active: boolean;
}

export interface Doctor {
  id: number;
  fullName: string;
  specialtyId: number;
  specialtyName?: string;
  active: boolean;
}

export interface ScheduleRule {
  id: number;
  doctorId: number;
  weekday: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // 'HH:MM'
  endTime: string;
  slotMinutes: number;
}

export interface ScheduleException {
  id: number;
  doctorId: number;
  date: string; // 'YYYY-MM-DD'
  startTime: string | null; // null = whole day
  endTime: string | null;
  reason: string | null;
}

export interface Patient {
  id: number;
  fullName: string;
  phone: string;
}

export interface Slot {
  date: string;
  startTime: string;
  endTime: string;
}

export interface Booking {
  id: number;
  reference: string;
  patientId: number;
  doctorId: number;
  date: string;
  startTime: string;
  endTime: string;
  status: "active" | "cancelled";
}

export class DomainError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "SLOT_TAKEN"
      | "INVALID_INPUT"
      | "PHONE_MISMATCH"
      | "ALREADY_CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
