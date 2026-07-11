import type { Executor } from "../db/executor.js";
import type {
  ActiveStatus,
  AppointmentEntry,
  AuditLogEntry,
  AuthSession,
  Booking,
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

export interface SessionRecord {
  id: string;
  stage: string;
  state: Record<string, unknown>;
}

export interface ChatMessage {
  role: string;
  content: string;
  createdAt: string;
}

// ---- input types ----
export interface CreateDoctorInput {
  fullName: string;
  specialtyId: number;
  photoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
}
export interface UpdateDoctorInput {
  fullName?: string;
  specialtyId?: number;
  photoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
  active?: boolean;
}
export interface UpdateSpecialtyInput {
  name?: string;
  description?: string | null;
  active?: boolean;
}
export interface CreateStaffInput {
  fullName: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
}
export interface UpdateStaffInput {
  fullName?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  active?: boolean;
}
export interface UpdateClinicInput {
  name?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
  permissionLetterUrl?: string | null;
  emblemUrl?: string | null;
  extra?: Record<string, unknown>;
}
export interface UpdateThemeInput {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string | null;
  fontFamily?: string;
  darkMode?: boolean;
  extra?: Record<string, unknown>;
}
export interface UpdateShiftInput {
  name?: string;
  startTime?: string;
  endTime?: string;
  active?: boolean;
}
export interface CreateAssignmentInput {
  shiftId: number;
  doctorId?: number | null;
  staffId?: number | null;
  date: string;
}

// ---- repository interfaces ----
export interface SpecialtyRepo {
  listActive(): Promise<Specialty[]>;
  listAll(): Promise<Specialty[]>;
  findById(id: number): Promise<Specialty | null>;
  create(name: string, description?: string | null): Promise<Specialty>;
  update(id: number, patch: UpdateSpecialtyInput): Promise<Specialty | null>;
  deactivate(id: number): Promise<boolean>;
}

export interface DoctorRepo {
  listActiveBySpecialty(specialtyId: number): Promise<Doctor[]>;
  listAll(): Promise<Doctor[]>;
  findById(id: number): Promise<Doctor | null>;
  create(input: CreateDoctorInput): Promise<Doctor>;
  update(id: number, patch: UpdateDoctorInput): Promise<Doctor | null>;
  deactivate(id: number): Promise<boolean>;
}

export interface ScheduleRepo {
  rulesForDoctorWeekday(doctorId: number, weekday: number): Promise<ScheduleRule[]>;
  rulesForDoctor(doctorId: number): Promise<ScheduleRule[]>;
  exceptionsForDoctorDate(doctorId: number, date: string): Promise<ScheduleException[]>;
  /** Exceptions within [from, to], sorted by date then start time. */
  exceptionsForDoctorRange(
    doctorId: number,
    from: string,
    to: string,
  ): Promise<ScheduleException[]>;
  createRule(rule: Omit<ScheduleRule, "id">): Promise<number>;
  createException(exception: Omit<ScheduleException, "id">): Promise<number>;
}

export interface PatientRepo {
  findByPhone(phone: string): Promise<Patient | null>;
  findById(id: number): Promise<Patient | null>;
  create(fullName: string, phone: string): Promise<Patient>;
}

export interface BookingRepo {
  /** Active booking count per start time for one doctor/date. */
  activeSlotCounts(doctorId: number, date: string): Promise<Map<string, number>>;
  /** Seat indexes currently held by active bookings in one slot. */
  activeSlotSeqs(doctorId: number, date: string, startTime: string): Promise<Set<number>>;
  /** slotSeq = seat index within the slot (0..capacity-1); unique per active slot. */
  create(booking: Omit<Booking, "id" | "status">, slotSeq: number): Promise<Booking>;
  findByReference(reference: string): Promise<Booking | null>;
  listByDoctorDate(doctorId: number, date: string): Promise<Booking[]>;
  /** Bookings + patient info for a doctor within [from, to], sorted by date, time. */
  listByDoctorRangeWithPatient(
    doctorId: number,
    from: string,
    to: string,
  ): Promise<AppointmentEntry[]>;
  cancel(id: number): Promise<void>;
}

export interface SessionRepo {
  create(stage: string): Promise<SessionRecord>;
  find(id: string): Promise<SessionRecord | null>;
  save(session: SessionRecord): Promise<void>;
  appendMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void>;
  messages(sessionId: string): Promise<ChatMessage[]>;
}

export interface AuditRepo {
  record(eventType: string, payload: Record<string, unknown>): Promise<void>;
  /** Newest first, optional event-type filter. For the admin Audit Log page. */
  list(opts: { limit: number; offset: number; eventType?: string }): Promise<AuditLogEntry[]>;
}

// ---- auth / RBAC ----

/** users row + position join; the only shape that carries the password hash. */
export interface AuthUserRecord {
  id: number;
  email: string;
  passwordHash: string;
  fullName: string;
  positionCode: string;
  positionName: string;
  groupCode: string;
  doctorId: number | null;
  staffId: number | null;
  status: ActiveStatus;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  positionCode: string;
  doctorId?: number | null;
  staffId?: number | null;
}

export interface UpdateUserInput {
  fullName?: string;
  passwordHash?: string;
  positionCode?: string;
  doctorId?: number | null;
  staffId?: number | null;
  status?: ActiveStatus;
}

export interface AuthRepo {
  // users
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(id: number): Promise<AuthUserRecord | null>;
  listUsers(): Promise<AuthUserRecord[]>;
  createUser(input: CreateUserInput): Promise<AuthUserRecord>;
  updateUser(id: number, patch: UpdateUserInput): Promise<AuthUserRecord | null>;
  // role assignments (transactional user_roles)
  rolesForUser(userId: number): Promise<string[]>;
  setUserRoles(userId: number, roleCodes: string[]): Promise<void>;
  // masters
  listGroups(): Promise<MasterGroup[]>;
  listRoles(): Promise<MasterRole[]>;
  listPositions(): Promise<MasterPosition[]>;
  findPositionByCode(code: string): Promise<MasterPosition | null>;
  createPosition(input: {
    positionCode: string;
    positionName: string;
    groupCode: string;
  }): Promise<MasterPosition>;
  updatePosition(
    code: string,
    patch: { positionName?: string; groupCode?: string },
  ): Promise<MasterPosition | null>;
  /** Soft delete (sets deleted_at). */
  deletePosition(code: string): Promise<boolean>;
  // idempotent seed helpers
  upsertGroup(code: string, name: string): Promise<void>;
  upsertRole(code: string, name: string, groupCode: string, description?: string): Promise<void>;
  upsertPosition(code: string, name: string, groupCode: string): Promise<void>;
  // sessions (opaque bearer tokens)
  createSession(userId: number, token: string, expiresAt: string): Promise<void>;
  /** Non-revoked session or null; expiry is checked by the service. */
  findSession(token: string): Promise<AuthSession | null>;
  revokeSession(token: string): Promise<void>;
}

export interface ClinicRepo {
  get(): Promise<ClinicSetting>;
  update(patch: UpdateClinicInput): Promise<ClinicSetting>;
}

export interface ThemeRepo {
  get(): Promise<ThemeSetting>;
  update(patch: UpdateThemeInput): Promise<ThemeSetting>;
}

export interface StaffRepo {
  listAll(): Promise<Staff[]>;
  findById(id: number): Promise<Staff | null>;
  create(input: CreateStaffInput): Promise<Staff>;
  update(id: number, patch: UpdateStaffInput): Promise<Staff | null>;
  deactivate(id: number): Promise<boolean>;
}

export interface SlotPresetRepo {
  listAll(): Promise<SlotPreset[]>;
  findById(id: number): Promise<SlotPreset | null>;
  create(label: string, minutes: number): Promise<SlotPreset>;
  update(
    id: number,
    patch: { label?: string; minutes?: number; active?: boolean },
  ): Promise<SlotPreset | null>;
  delete(id: number): Promise<boolean>;
}

export interface ShiftRepo {
  listShifts(): Promise<Shift[]>;
  findShift(id: number): Promise<Shift | null>;
  createShift(name: string, startTime: string, endTime: string): Promise<Shift>;
  updateShift(id: number, patch: UpdateShiftInput): Promise<Shift | null>;
  deleteShift(id: number): Promise<boolean>;
  listAssignments(date?: string): Promise<ShiftAssignment[]>;
  findAssignment(id: number): Promise<ShiftAssignment | null>;
  createAssignment(input: CreateAssignmentInput): Promise<ShiftAssignment>;
  deleteAssignment(id: number): Promise<boolean>;
}

/** Bundle of every repository, bound to one Executor (base connection or tx). */
export interface Repositories {
  specialties: SpecialtyRepo;
  doctors: DoctorRepo;
  schedules: ScheduleRepo;
  patients: PatientRepo;
  bookings: BookingRepo;
  sessions: SessionRepo;
  audit: AuditRepo;
  clinic: ClinicRepo;
  theme: ThemeRepo;
  staff: StaffRepo;
  slotPresets: SlotPresetRepo;
  shifts: ShiftRepo;
  auth: AuthRepo;
}

/** Builds a repositories bundle over a given executor (dialect-specific). */
export type RepositoryFactory = (ex: Executor) => Repositories;
