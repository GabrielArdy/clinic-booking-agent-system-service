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

/** Booking enriched with patient info, for the admin schedule/planner page. */
export interface AppointmentEntry {
  id: number;
  reference: string;
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  endTime: string;
  status: "active" | "cancelled";
  patient: {
    id: number;
    fullName: string;
    phone: string;
  };
}

/**
 * Per-date aggregate for calendar badges. Sparse: only dates that have
 * appointments and/or schedule exceptions appear.
 */
export interface AppointmentDaySummary {
  date: string; // 'YYYY-MM-DD'
  total: number;
  active: number;
  cancelled: number;
  /** Schedule exceptions (blocking time) on this date. */
  exceptions: number;
  /** true = a whole-day exception blocks the entire date. */
  blocked: boolean;
}

// ---- Auth / RBAC entities ----

export type ActiveStatus = "ACTIVE" | "INACTIVE";

export interface MasterGroup {
  id: number;
  groupName: string;
  groupCode: string; // e.g. 'AD100', 'DOC100', 'STF100'
  groupStatus: ActiveStatus;
}

export interface MasterRole {
  id: number;
  roleCode: string; // e.g. 'CMS_CLINIC', 'DOC_APPOINTMENT'
  roleName: string;
  description: string | null;
  groupCode: string; // default group the role belongs to
  roleStatus: ActiveStatus;
}

export interface MasterPosition {
  id: number;
  positionCode: string; // e.g. 'A001', 'D001', 'D012', 'P001'
  positionName: string;
  groupCode: string;
}

/** Login account. Password hash never leaves the repository/service layer. */
export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  positionCode: string;
  positionName?: string;
  groupCode?: string;
  doctorId: number | null;
  staffId: number | null;
  status: ActiveStatus;
  roles: string[]; // role codes
}

export interface AuthSession {
  token: string;
  userId: number;
  expiresAt: string; // ISO datetime
}

export interface AuditLogEntry {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// ---- live chat (patient <-> staff) ----

export type LiveChatStatus = "waiting" | "active" | "closed";
export type LiveChatCloseReason = "completed_by_staff" | "completed_by_patient" | "timeout";
export type PatientTitle = "Mr" | "Mrs" | "Ms";

/**
 * A patient <-> staff chat session. The patient's secret access key is NOT
 * part of this shape — it is only returned once, to the patient, at creation.
 */
export interface LiveChatSession {
  id: number;
  patientTitle: PatientTitle;
  patientName: string;
  patientPhone: string;
  status: LiveChatStatus;
  staffUserId: number | null;
  staffName: string | null;
  closedReason: LiveChatCloseReason | null;
  lastPatientEventAt: string; // ISO datetime
  createdAt: string;
  claimedAt: string | null;
  closedAt: string | null;
}

export interface LiveChatMessage {
  id: number;
  sessionId: number;
  sender: "patient" | "staff" | "system";
  body: string;
  createdAt: string;
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
      | "TOO_LATE_TO_CANCEL"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "STAFF_BUSY"
      | "CHAT_CLOSED",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
