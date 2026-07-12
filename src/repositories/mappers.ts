import { toBool } from "../db/executor.js";
import type {
  ActiveStatus,
  AppointmentEntry,
  AuditLogEntry,
  AuthSession,
  Booking,
  LiveChatCloseReason,
  LiveChatMessage,
  LiveChatSession,
  LiveChatStatus,
  PatientTitle,
  MasterGroup,
  MasterPosition,
  MasterRole,
  ClinicSetting,
  Doctor,
  Patient,
  ScheduleException,
  ScheduleRule,
  Shift,
  ShiftAssignment,
  SlotPreset,
  Specialty,
  Staff,
  ThemeSetting,
} from "../domain/types.js";

// Row shapes share column names across dialects; `active`/`dark_mode` differ in
// type (sqlite 0/1 vs postgres boolean) and are normalised via toBool.

export function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface SpecialtyRow {
  id: number;
  name: string;
  description: string | null;
  active: unknown;
}
export function toSpecialty(r: SpecialtyRow): Specialty {
  return { id: r.id, name: r.name, description: r.description, active: toBool(r.active) };
}

export interface DoctorRow {
  id: number;
  full_name: string;
  specialty_id: number;
  specialty_name: string;
  photo_url: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  active: unknown;
}
export function toDoctor(r: DoctorRow): Doctor {
  return {
    id: r.id,
    fullName: r.full_name,
    specialtyId: r.specialty_id,
    specialtyName: r.specialty_name,
    photoUrl: r.photo_url,
    email: r.email,
    phone: r.phone,
    bio: r.bio,
    active: toBool(r.active),
  };
}

export interface RuleRow {
  id: number;
  doctor_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
}
export function toRule(r: RuleRow): ScheduleRule {
  return {
    id: r.id,
    doctorId: r.doctor_id,
    weekday: r.weekday,
    startTime: r.start_time,
    endTime: r.end_time,
    slotMinutes: r.slot_minutes,
  };
}

export interface ExceptionRow {
  id: number;
  doctor_id: number;
  date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}
export function toException(r: ExceptionRow): ScheduleException {
  return {
    id: r.id,
    doctorId: r.doctor_id,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    reason: r.reason,
  };
}

export interface PatientRow {
  id: number;
  full_name: string;
  phone: string;
}
export function toPatient(r: PatientRow): Patient {
  return { id: r.id, fullName: r.full_name, phone: r.phone };
}

export interface BookingRow {
  id: number;
  reference: string;
  patient_id: number;
  doctor_id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: "active" | "cancelled";
}
export function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    reference: r.reference,
    patientId: r.patient_id,
    doctorId: r.doctor_id,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    status: r.status,
  };
}

export interface AppointmentRow {
  id: number;
  reference: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "active" | "cancelled";
  patient_id: number;
  patient_name: string;
  patient_phone: string;
}
export function toAppointmentEntry(r: AppointmentRow): AppointmentEntry {
  return {
    id: r.id,
    reference: r.reference,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    status: r.status,
    patient: {
      id: r.patient_id,
      fullName: r.patient_name,
      phone: r.patient_phone,
    },
  };
}

// ---- live chat rows ----

/** pg returns TIMESTAMPTZ as Date, sqlite as string. */
function toIso(v: string | Date | null): string | null {
  if (v === null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

export interface LiveChatSessionRow {
  id: number;
  patient_title: PatientTitle;
  patient_name: string;
  patient_phone: string;
  status: LiveChatStatus;
  staff_user_id: number | null;
  staff_name: string | null;
  closed_reason: LiveChatCloseReason | null;
  last_patient_event_at: string | Date;
  created_at: string | Date;
  claimed_at: string | Date | null;
  closed_at: string | Date | null;
}
export function toLiveChatSession(r: LiveChatSessionRow): LiveChatSession {
  return {
    id: r.id,
    patientTitle: r.patient_title,
    patientName: r.patient_name,
    patientPhone: r.patient_phone,
    status: r.status,
    staffUserId: r.staff_user_id,
    staffName: r.staff_name,
    closedReason: r.closed_reason,
    lastPatientEventAt: toIso(r.last_patient_event_at)!,
    createdAt: toIso(r.created_at)!,
    claimedAt: toIso(r.claimed_at),
    closedAt: toIso(r.closed_at),
  };
}

export interface LiveChatMessageRow {
  id: number;
  session_id: number;
  sender: "patient" | "staff" | "system";
  body: string;
  created_at: string | Date;
}
export function toLiveChatMessage(r: LiveChatMessageRow): LiveChatMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    sender: r.sender,
    body: r.body,
    createdAt: toIso(r.created_at)!,
  };
}

// ---- auth / RBAC rows ----

export interface GroupRow {
  id: number;
  group_name: string;
  group_code: string;
  group_status: ActiveStatus;
}
export function toGroup(r: GroupRow): MasterGroup {
  return { id: r.id, groupName: r.group_name, groupCode: r.group_code, groupStatus: r.group_status };
}

export interface RoleRow {
  id: number;
  role_code: string;
  role_name: string;
  description: string | null;
  group_code: string;
  role_status: ActiveStatus;
}
export function toRole(r: RoleRow): MasterRole {
  return {
    id: r.id,
    roleCode: r.role_code,
    roleName: r.role_name,
    description: r.description,
    groupCode: r.group_code,
    roleStatus: r.role_status,
  };
}

export interface PositionRow {
  id: number;
  position_code: string;
  position_name: string;
  group_code: string;
}
export function toPosition(r: PositionRow): MasterPosition {
  return {
    id: r.id,
    positionCode: r.position_code,
    positionName: r.position_name,
    groupCode: r.group_code,
  };
}

export interface AuthUserRow {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  position_code: string;
  position_name: string;
  group_code: string;
  doctor_id: number | null;
  staff_id: number | null;
  user_status: ActiveStatus;
}

export interface AuthSessionRow {
  token: string;
  user_id: number;
  expires_at: string | Date;
}
export function toAuthSession(r: AuthSessionRow): AuthSession {
  return {
    token: r.token,
    userId: r.user_id,
    expiresAt: typeof r.expires_at === "string" ? r.expires_at : r.expires_at.toISOString(),
  };
}

export interface AuditRow {
  id: number;
  event_type: string;
  payload_json: string;
  created_at: string | Date;
}
export function toAuditEntry(r: AuditRow): AuditLogEntry {
  return {
    id: r.id,
    eventType: r.event_type,
    payload: safeParse(r.payload_json),
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
  };
}

export interface ClinicRow {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  permission_letter_url: string | null;
  emblem_url: string | null;
  extra_json: string;
  updated_at: string;
}
export function toClinic(r: ClinicRow): ClinicSetting {
  return {
    name: r.name,
    address: r.address,
    latitude: r.latitude,
    longitude: r.longitude,
    phone: r.phone,
    email: r.email,
    permissionLetterUrl: r.permission_letter_url,
    emblemUrl: r.emblem_url,
    extra: safeParse(r.extra_json),
    updatedAt: r.updated_at,
  };
}

export interface ThemeRow {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string | null;
  font_family: string;
  dark_mode: unknown;
  extra_json: string;
  updated_at: string;
}
export function toTheme(r: ThemeRow): ThemeSetting {
  return {
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    accentColor: r.accent_color,
    logoUrl: r.logo_url,
    fontFamily: r.font_family,
    darkMode: toBool(r.dark_mode),
    extra: safeParse(r.extra_json),
    updatedAt: r.updated_at,
  };
}

export interface StaffRow {
  id: number;
  full_name: string;
  role: string;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  active: unknown;
}
export function toStaff(r: StaffRow): Staff {
  return {
    id: r.id,
    fullName: r.full_name,
    role: r.role,
    email: r.email,
    phone: r.phone,
    photoUrl: r.photo_url,
    active: toBool(r.active),
  };
}

export interface PresetRow {
  id: number;
  label: string;
  minutes: number;
  active: unknown;
}
export function toPreset(r: PresetRow): SlotPreset {
  return { id: r.id, label: r.label, minutes: r.minutes, active: toBool(r.active) };
}

export interface ShiftRow {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  active: unknown;
}
export function toShift(r: ShiftRow): Shift {
  return {
    id: r.id,
    name: r.name,
    startTime: r.start_time,
    endTime: r.end_time,
    active: toBool(r.active),
  };
}

export interface AssignmentRow {
  id: number;
  shift_id: number;
  doctor_id: number | null;
  staff_id: number | null;
  date: string;
}
export function toAssignment(r: AssignmentRow): ShiftAssignment {
  return {
    id: r.id,
    shiftId: r.shift_id,
    doctorId: r.doctor_id,
    staffId: r.staff_id,
    date: r.date,
  };
}
