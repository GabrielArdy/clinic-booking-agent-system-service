export interface Specialty {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}

export interface Doctor {
  id: number;
  fullName: string;
  specialtyId: number;
  specialtyName?: string;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
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
  /** Max concurrent bookings: floor(slotMinutes / 15), min 1. */
  capacity: number;
  bookedCount: number;
  /** false = cannot be booked (see unavailableReason). */
  available: boolean;
  /**
   * "full" = at capacity; "lead_time" = starts in less than the 6h booking
   * lead; "held" = remaining seats are locked by in-progress bookings.
   */
  unavailableReason?: "full" | "lead_time" | "held";
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

// ---- CMS console entities ----

export interface ClinicSetting {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  permissionLetterUrl: string | null;
  emblemUrl: string | null;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export interface ThemeSetting {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  fontFamily: string;
  darkMode: boolean;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export interface Staff {
  id: number;
  fullName: string;
  role: string;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  active: boolean;
}

export interface SlotPreset {
  id: number;
  label: string;
  minutes: number;
  active: boolean;
}

export interface Shift {
  id: number;
  name: string;
  startTime: string; // 'HH:MM'
  endTime: string;
  active: boolean;
}

export interface ShiftAssignment {
  id: number;
  shiftId: number;
  doctorId: number | null;
  staffId: number | null;
  date: string; // 'YYYY-MM-DD'
}

export class DomainError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "SLOT_TAKEN"
      | "INVALID_INPUT"
      | "PHONE_MISMATCH"
      | "ALREADY_CANCELLED"
      | "TOO_LATE_TO_BOOK"
      | "TOO_LATE_TO_CANCEL",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
