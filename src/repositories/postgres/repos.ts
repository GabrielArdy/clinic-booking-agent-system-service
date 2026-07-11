import { randomUUID } from "node:crypto";
import type { Executor } from "../../db/executor.js";
import type {
  ActiveStatus,
  AppointmentEntry,
  AuditLogEntry,
  AuthSession,
  Booking,
  ClinicSetting,
  MasterGroup,
  MasterPosition,
  MasterRole,
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
} from "../../domain/types.js";
import * as M from "../mappers.js";
import type {
  AuditRepo,
  AuthRepo,
  AuthUserRecord,
  BookingRepo,
  ChatMessage,
  ClinicRepo,
  CreateAssignmentInput,
  CreateDoctorInput,
  CreateStaffInput,
  CreateUserInput,
  DoctorRepo,
  PatientRepo,
  Repositories,
  ScheduleRepo,
  SessionRecord,
  SessionRepo,
  ShiftRepo,
  SlotPresetRepo,
  SpecialtyRepo,
  StaffRepo,
  ThemeRepo,
  UpdateClinicInput,
  UpdateDoctorInput,
  UpdateUserInput,
  UpdateShiftInput,
  UpdateSpecialtyInput,
  UpdateStaffInput,
  UpdateThemeInput,
} from "../ports.js";

class PgSpecialtyRepository implements SpecialtyRepo {
  constructor(private readonly ex: Executor) {}
  private static COLS = "id, name, description, active";
  async listActive(): Promise<Specialty[]> {
    const rows = await this.ex.all<M.SpecialtyRow>(
      `SELECT ${PgSpecialtyRepository.COLS} FROM specialties WHERE active = true ORDER BY name`,
    );
    return rows.map(M.toSpecialty);
  }
  async listAll(): Promise<Specialty[]> {
    const rows = await this.ex.all<M.SpecialtyRow>(
      `SELECT ${PgSpecialtyRepository.COLS} FROM specialties ORDER BY name`,
    );
    return rows.map(M.toSpecialty);
  }
  async findById(id: number): Promise<Specialty | null> {
    const row = await this.ex.get<M.SpecialtyRow>(
      `SELECT ${PgSpecialtyRepository.COLS} FROM specialties WHERE id = $1`,
      [id],
    );
    return row ? M.toSpecialty(row) : null;
  }
  async create(name: string, description: string | null = null): Promise<Specialty> {
    const r = await this.ex.run(
      "INSERT INTO specialties (name, description) VALUES ($1, $2) RETURNING id",
      [name, description],
    );
    return (await this.findById(r.lastId!))!;
  }
  async update(id: number, patch: UpdateSpecialtyInput): Promise<Specialty | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await this.ex.run(
      "UPDATE specialties SET name = $1, description = $2, active = $3 WHERE id = $4",
      [
        patch.name ?? current.name,
        patch.description === undefined ? current.description : patch.description,
        patch.active ?? current.active,
        id,
      ],
    );
    return this.findById(id);
  }
  async deactivate(id: number): Promise<boolean> {
    const r = await this.ex.run("UPDATE specialties SET active = false WHERE id = $1", [id]);
    return r.changes > 0;
  }
}

const DOCTOR_SELECT = `
  SELECT d.id, d.full_name, d.specialty_id, d.active, d.photo_url,
         d.email, d.phone, d.bio, s.name AS specialty_name
  FROM doctors d JOIN specialties s ON s.id = d.specialty_id
`;

class PgDoctorRepository implements DoctorRepo {
  constructor(private readonly ex: Executor) {}
  async listActiveBySpecialty(specialtyId: number): Promise<Doctor[]> {
    const rows = await this.ex.all<M.DoctorRow>(
      `${DOCTOR_SELECT} WHERE d.specialty_id = $1 AND d.active = true ORDER BY d.full_name`,
      [specialtyId],
    );
    return rows.map(M.toDoctor);
  }
  async listAll(): Promise<Doctor[]> {
    const rows = await this.ex.all<M.DoctorRow>(`${DOCTOR_SELECT} ORDER BY d.full_name`);
    return rows.map(M.toDoctor);
  }
  async findById(id: number): Promise<Doctor | null> {
    const row = await this.ex.get<M.DoctorRow>(`${DOCTOR_SELECT} WHERE d.id = $1`, [id]);
    return row ? M.toDoctor(row) : null;
  }
  async create(input: CreateDoctorInput): Promise<Doctor> {
    const r = await this.ex.run(
      `INSERT INTO doctors (full_name, specialty_id, photo_url, email, phone, bio)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.fullName,
        input.specialtyId,
        input.photoUrl ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.bio ?? null,
      ],
    );
    return (await this.findById(r.lastId!))!;
  }
  async update(id: number, patch: UpdateDoctorInput): Promise<Doctor | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await this.ex.run(
      `UPDATE doctors SET full_name = $1, specialty_id = $2, photo_url = $3, email = $4, phone = $5, bio = $6, active = $7
       WHERE id = $8`,
      [
        patch.fullName ?? current.fullName,
        patch.specialtyId ?? current.specialtyId,
        patch.photoUrl === undefined ? current.photoUrl : patch.photoUrl,
        patch.email === undefined ? current.email : patch.email,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.bio === undefined ? current.bio : patch.bio,
        patch.active ?? current.active,
        id,
      ],
    );
    return this.findById(id);
  }
  async deactivate(id: number): Promise<boolean> {
    const r = await this.ex.run("UPDATE doctors SET active = false WHERE id = $1", [id]);
    return r.changes > 0;
  }
}

class PgScheduleRepository implements ScheduleRepo {
  constructor(private readonly ex: Executor) {}
  async rulesForDoctorWeekday(doctorId: number, weekday: number): Promise<ScheduleRule[]> {
    const rows = await this.ex.all<M.RuleRow>(
      `SELECT id, doctor_id, weekday, start_time, end_time, slot_minutes
       FROM doctor_schedule_rules WHERE doctor_id = $1 AND weekday = $2 ORDER BY start_time`,
      [doctorId, weekday],
    );
    return rows.map(M.toRule);
  }
  async rulesForDoctor(doctorId: number): Promise<ScheduleRule[]> {
    const rows = await this.ex.all<M.RuleRow>(
      `SELECT id, doctor_id, weekday, start_time, end_time, slot_minutes
       FROM doctor_schedule_rules WHERE doctor_id = $1 ORDER BY weekday, start_time`,
      [doctorId],
    );
    return rows.map(M.toRule);
  }
  async exceptionsForDoctorDate(doctorId: number, date: string): Promise<ScheduleException[]> {
    const rows = await this.ex.all<M.ExceptionRow>(
      `SELECT id, doctor_id, date, start_time, end_time, reason
       FROM doctor_schedule_exceptions WHERE doctor_id = $1 AND date = $2`,
      [doctorId, date],
    );
    return rows.map(M.toException);
  }
  async exceptionsForDoctorRange(
    doctorId: number,
    from: string,
    to: string,
  ): Promise<ScheduleException[]> {
    const rows = await this.ex.all<M.ExceptionRow>(
      `SELECT id, doctor_id, date, start_time, end_time, reason
       FROM doctor_schedule_exceptions
       WHERE doctor_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date, start_time`,
      [doctorId, from, to],
    );
    return rows.map(M.toException);
  }
  async createRule(rule: Omit<ScheduleRule, "id">): Promise<number> {
    const r = await this.ex.run(
      `INSERT INTO doctor_schedule_rules (doctor_id, weekday, start_time, end_time, slot_minutes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [rule.doctorId, rule.weekday, rule.startTime, rule.endTime, rule.slotMinutes],
    );
    return r.lastId!;
  }
  async createException(exception: Omit<ScheduleException, "id">): Promise<number> {
    const r = await this.ex.run(
      `INSERT INTO doctor_schedule_exceptions (doctor_id, date, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [exception.doctorId, exception.date, exception.startTime, exception.endTime, exception.reason],
    );
    return r.lastId!;
  }
}

class PgPatientRepository implements PatientRepo {
  constructor(private readonly ex: Executor) {}
  async findByPhone(phone: string): Promise<Patient | null> {
    const row = await this.ex.get<M.PatientRow>(
      "SELECT id, full_name, phone FROM patients WHERE phone = $1",
      [phone],
    );
    return row ? M.toPatient(row) : null;
  }
  async findById(id: number): Promise<Patient | null> {
    const row = await this.ex.get<M.PatientRow>(
      "SELECT id, full_name, phone FROM patients WHERE id = $1",
      [id],
    );
    return row ? M.toPatient(row) : null;
  }
  async create(fullName: string, phone: string): Promise<Patient> {
    const r = await this.ex.run(
      "INSERT INTO patients (full_name, phone) VALUES ($1, $2) RETURNING id",
      [fullName, phone],
    );
    return { id: r.lastId!, fullName, phone };
  }
}

const BOOKING_SELECT = `
  SELECT id, reference, patient_id, doctor_id, date, start_time, end_time, status FROM bookings
`;

class PgBookingRepository implements BookingRepo {
  constructor(private readonly ex: Executor) {}
  async activeSlotCounts(doctorId: number, date: string): Promise<Map<string, number>> {
    const rows = await this.ex.all<{ start_time: string; n: string | number }>(
      `SELECT start_time, COUNT(*) AS n FROM bookings
       WHERE doctor_id = $1 AND date = $2 AND status = 'active'
       GROUP BY start_time`,
      [doctorId, date],
    );
    return new Map(rows.map((r) => [r.start_time, Number(r.n)]));
  }
  async activeSlotSeqs(doctorId: number, date: string, startTime: string): Promise<Set<number>> {
    const rows = await this.ex.all<{ slot_seq: number }>(
      `SELECT slot_seq FROM bookings
       WHERE doctor_id = $1 AND date = $2 AND start_time = $3 AND status = 'active'`,
      [doctorId, date, startTime],
    );
    return new Set(rows.map((r) => Number(r.slot_seq)));
  }
  async create(booking: Omit<Booking, "id" | "status">, slotSeq: number): Promise<Booking> {
    const r = await this.ex.run(
      `INSERT INTO bookings (reference, patient_id, doctor_id, date, start_time, end_time, slot_seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        booking.reference,
        booking.patientId,
        booking.doctorId,
        booking.date,
        booking.startTime,
        booking.endTime,
        slotSeq,
      ],
    );
    return { ...booking, id: r.lastId!, status: "active" };
  }
  async findByReference(reference: string): Promise<Booking | null> {
    const row = await this.ex.get<M.BookingRow>(`${BOOKING_SELECT} WHERE reference = $1`, [reference]);
    return row ? M.toBooking(row) : null;
  }
  async listByDoctorDate(doctorId: number, date: string): Promise<Booking[]> {
    const rows = await this.ex.all<M.BookingRow>(
      `${BOOKING_SELECT} WHERE doctor_id = $1 AND date = $2 ORDER BY start_time`,
      [doctorId, date],
    );
    return rows.map(M.toBooking);
  }
  async listByDoctorRangeWithPatient(
    doctorId: number,
    from: string,
    to: string,
  ): Promise<AppointmentEntry[]> {
    const rows = await this.ex.all<M.AppointmentRow>(
      `SELECT b.id, b.reference, b.date, b.start_time, b.end_time, b.status,
              p.id AS patient_id, p.full_name AS patient_name, p.phone AS patient_phone
       FROM bookings b
       JOIN patients p ON p.id = b.patient_id
       WHERE b.doctor_id = $1 AND b.date >= $2 AND b.date <= $3
       ORDER BY b.date, b.start_time`,
      [doctorId, from, to],
    );
    return rows.map(M.toAppointmentEntry);
  }
  async cancel(id: number): Promise<void> {
    await this.ex.run(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
      [id],
    );
  }
}

class PgSessionRepository implements SessionRepo {
  constructor(private readonly ex: Executor) {}
  async create(stage: string): Promise<SessionRecord> {
    const id = randomUUID();
    await this.ex.run(
      "INSERT INTO conversation_sessions (id, stage, state_json) VALUES ($1, $2, '{}')",
      [id, stage],
    );
    return { id, stage, state: {} };
  }
  async find(id: string): Promise<SessionRecord | null> {
    const row = await this.ex.get<{ id: string; stage: string; state_json: string }>(
      "SELECT id, stage, state_json FROM conversation_sessions WHERE id = $1",
      [id],
    );
    if (!row) return null;
    return { id: row.id, stage: row.stage, state: M.safeParse(row.state_json) };
  }
  async save(session: SessionRecord): Promise<void> {
    await this.ex.run(
      `UPDATE conversation_sessions SET stage = $1, state_json = $2, updated_at = now() WHERE id = $3`,
      [session.stage, JSON.stringify(session.state), session.id],
    );
  }
  async appendMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void> {
    await this.ex.run(
      "INSERT INTO conversation_messages (session_id, role, content) VALUES ($1, $2, $3)",
      [sessionId, role, content],
    );
  }
  async messages(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.ex.all<{ role: string; content: string; created_at: string }>(
      `SELECT role, content, created_at FROM conversation_messages WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    return rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at }));
  }
}

class PgAuditRepository implements AuditRepo {
  constructor(private readonly ex: Executor) {}
  async record(eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.ex.run("INSERT INTO audit_events (event_type, payload_json) VALUES ($1, $2)", [
      eventType,
      JSON.stringify(payload),
    ]);
  }
  async list(opts: { limit: number; offset: number; eventType?: string }): Promise<AuditLogEntry[]> {
    const filter = opts.eventType ? "WHERE event_type = $3" : "";
    const params: (string | number)[] = opts.eventType
      ? [opts.limit, opts.offset, opts.eventType]
      : [opts.limit, opts.offset];
    const rows = await this.ex.all<M.AuditRow>(
      `SELECT id, event_type, payload_json, created_at FROM audit_events
       ${filter} ORDER BY id DESC LIMIT $1 OFFSET $2`,
      params,
    );
    return rows.map(M.toAuditEntry);
  }
}

const AUTH_USER_SELECT = `
  SELECT u.id, u.email, u.password_hash, u.full_name, u.position_code,
         p.position_name, p.group_code, u.doctor_id, u.staff_id, u.user_status
  FROM users u
  JOIN master_position p ON p.position_code = u.position_code
`;

function toAuthUserRecord(r: M.AuthUserRow): AuthUserRecord {
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    fullName: r.full_name,
    positionCode: r.position_code,
    positionName: r.position_name,
    groupCode: r.group_code,
    doctorId: r.doctor_id,
    staffId: r.staff_id,
    status: r.user_status,
  };
}

class PgAuthRepository implements AuthRepo {
  constructor(private readonly ex: Executor) {}

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const row = await this.ex.get<M.AuthUserRow>(
      `${AUTH_USER_SELECT} WHERE u.email = $1 AND u.deleted_at IS NULL`,
      [email.toLowerCase()],
    );
    return row ? toAuthUserRecord(row) : null;
  }
  async findUserById(id: number): Promise<AuthUserRecord | null> {
    const row = await this.ex.get<M.AuthUserRow>(
      `${AUTH_USER_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [id],
    );
    return row ? toAuthUserRecord(row) : null;
  }
  async listUsers(): Promise<AuthUserRecord[]> {
    const rows = await this.ex.all<M.AuthUserRow>(
      `${AUTH_USER_SELECT} WHERE u.deleted_at IS NULL ORDER BY u.full_name`,
    );
    return rows.map(toAuthUserRecord);
  }
  async createUser(input: CreateUserInput): Promise<AuthUserRecord> {
    const r = await this.ex.run(
      `INSERT INTO users (email, password_hash, full_name, position_code, doctor_id, staff_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.email.toLowerCase(),
        input.passwordHash,
        input.fullName,
        input.positionCode,
        input.doctorId ?? null,
        input.staffId ?? null,
      ],
    );
    return (await this.findUserById(r.lastId!))!;
  }
  async updateUser(id: number, patch: UpdateUserInput): Promise<AuthUserRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown): void => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.fullName !== undefined) add("full_name", patch.fullName);
    if (patch.passwordHash !== undefined) add("password_hash", patch.passwordHash);
    if (patch.positionCode !== undefined) add("position_code", patch.positionCode);
    if (patch.doctorId !== undefined) add("doctor_id", patch.doctorId);
    if (patch.staffId !== undefined) add("staff_id", patch.staffId);
    if (patch.status !== undefined) add("user_status", patch.status);
    if (sets.length > 0) {
      sets.push("updated_at = now()");
      params.push(id);
      await this.ex.run(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    }
    return this.findUserById(id);
  }

  async rolesForUser(userId: number): Promise<string[]> {
    const rows = await this.ex.all<{ role_code: string }>(
      `SELECT ur.role_code FROM user_roles ur
       JOIN master_roles r ON r.role_code = ur.role_code
       WHERE ur.user_id = $1 AND r.role_status = 'ACTIVE' AND r.deleted_at IS NULL
       ORDER BY ur.role_code`,
      [userId],
    );
    return rows.map((r) => r.role_code);
  }
  async setUserRoles(userId: number, roleCodes: string[]): Promise<void> {
    await this.ex.run("DELETE FROM user_roles WHERE user_id = $1", [userId]);
    for (const code of roleCodes) {
      await this.ex.run("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [
        userId,
        code,
      ]);
    }
  }

  async listGroups(): Promise<MasterGroup[]> {
    const rows = await this.ex.all<M.GroupRow>(
      `SELECT id, group_name, group_code, group_status FROM master_groups
       WHERE deleted_at IS NULL ORDER BY group_code`,
    );
    return rows.map(M.toGroup);
  }
  async listRoles(): Promise<MasterRole[]> {
    const rows = await this.ex.all<M.RoleRow>(
      `SELECT id, role_code, role_name, description, group_code, role_status FROM master_roles
       WHERE deleted_at IS NULL ORDER BY role_code`,
    );
    return rows.map(M.toRole);
  }
  async listPositions(): Promise<MasterPosition[]> {
    const rows = await this.ex.all<M.PositionRow>(
      `SELECT id, position_code, position_name, group_code FROM master_position
       WHERE deleted_at IS NULL ORDER BY position_code`,
    );
    return rows.map(M.toPosition);
  }
  async findPositionByCode(code: string): Promise<MasterPosition | null> {
    const row = await this.ex.get<M.PositionRow>(
      `SELECT id, position_code, position_name, group_code FROM master_position
       WHERE position_code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return row ? M.toPosition(row) : null;
  }
  async createPosition(input: {
    positionCode: string;
    positionName: string;
    groupCode: string;
  }): Promise<MasterPosition> {
    await this.ex.run(
      "INSERT INTO master_position (position_code, position_name, group_code) VALUES ($1, $2, $3)",
      [input.positionCode, input.positionName, input.groupCode],
    );
    return (await this.findPositionByCode(input.positionCode))!;
  }
  async updatePosition(
    code: string,
    patch: { positionName?: string; groupCode?: string },
  ): Promise<MasterPosition | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown): void => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.positionName !== undefined) add("position_name", patch.positionName);
    if (patch.groupCode !== undefined) add("group_code", patch.groupCode);
    if (sets.length > 0) {
      sets.push("updated_at = now()");
      params.push(code);
      await this.ex.run(
        `UPDATE master_position SET ${sets.join(", ")} WHERE position_code = $${params.length} AND deleted_at IS NULL`,
        params,
      );
    }
    return this.findPositionByCode(code);
  }
  async deletePosition(code: string): Promise<boolean> {
    const r = await this.ex.run(
      `UPDATE master_position SET deleted_at = now()
       WHERE position_code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return r.changes > 0;
  }

  async upsertGroup(code: string, name: string): Promise<void> {
    await this.ex.run(
      `INSERT INTO master_groups (group_code, group_name) VALUES ($1, $2)
       ON CONFLICT (group_code) DO NOTHING`,
      [code, name],
    );
  }
  async upsertRole(
    code: string,
    name: string,
    groupCode: string,
    description?: string,
  ): Promise<void> {
    await this.ex.run(
      `INSERT INTO master_roles (role_code, role_name, group_code, description) VALUES ($1, $2, $3, $4)
       ON CONFLICT (role_code) DO NOTHING`,
      [code, name, groupCode, description ?? null],
    );
  }
  async upsertPosition(code: string, name: string, groupCode: string): Promise<void> {
    await this.ex.run(
      `INSERT INTO master_position (position_code, position_name, group_code) VALUES ($1, $2, $3)
       ON CONFLICT (position_code) DO NOTHING`,
      [code, name, groupCode],
    );
  }

  async createSession(userId: number, token: string, expiresAt: string): Promise<void> {
    await this.ex.run(
      "INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
      [token, userId, expiresAt],
    );
  }
  async findSession(token: string): Promise<AuthSession | null> {
    const row = await this.ex.get<M.AuthSessionRow>(
      "SELECT token, user_id, expires_at FROM auth_sessions WHERE token = $1 AND revoked_at IS NULL",
      [token],
    );
    return row ? M.toAuthSession(row) : null;
  }
  async revokeSession(token: string): Promise<void> {
    await this.ex.run("UPDATE auth_sessions SET revoked_at = now() WHERE token = $1", [token]);
  }
}

class PgClinicRepository implements ClinicRepo {
  constructor(private readonly ex: Executor) {}
  async get(): Promise<ClinicSetting> {
    const row = await this.ex.get<M.ClinicRow>("SELECT * FROM clinic_settings WHERE id = 1");
    return M.toClinic(row!);
  }
  async update(patch: UpdateClinicInput): Promise<ClinicSetting> {
    const current = await this.get();
    await this.ex.run(
      `UPDATE clinic_settings SET
         name = $1, address = $2, latitude = $3, longitude = $4, phone = $5, email = $6,
         permission_letter_url = $7, emblem_url = $8, extra_json = $9, updated_at = now()
       WHERE id = 1`,
      [
        patch.name ?? current.name,
        patch.address ?? current.address,
        patch.latitude === undefined ? current.latitude : patch.latitude,
        patch.longitude === undefined ? current.longitude : patch.longitude,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.email === undefined ? current.email : patch.email,
        patch.permissionLetterUrl === undefined
          ? current.permissionLetterUrl
          : patch.permissionLetterUrl,
        patch.emblemUrl === undefined ? current.emblemUrl : patch.emblemUrl,
        JSON.stringify(patch.extra ?? current.extra),
      ],
    );
    return this.get();
  }
}

class PgThemeRepository implements ThemeRepo {
  constructor(private readonly ex: Executor) {}
  async get(): Promise<ThemeSetting> {
    const row = await this.ex.get<M.ThemeRow>("SELECT * FROM theme_settings WHERE id = 1");
    return M.toTheme(row!);
  }
  async update(patch: UpdateThemeInput): Promise<ThemeSetting> {
    const current = await this.get();
    await this.ex.run(
      `UPDATE theme_settings SET
         primary_color = $1, secondary_color = $2, accent_color = $3, logo_url = $4,
         font_family = $5, dark_mode = $6, extra_json = $7, updated_at = now()
       WHERE id = 1`,
      [
        patch.primaryColor ?? current.primaryColor,
        patch.secondaryColor ?? current.secondaryColor,
        patch.accentColor ?? current.accentColor,
        patch.logoUrl === undefined ? current.logoUrl : patch.logoUrl,
        patch.fontFamily ?? current.fontFamily,
        patch.darkMode ?? current.darkMode,
        JSON.stringify(patch.extra ?? current.extra),
      ],
    );
    return this.get();
  }
}

class PgStaffRepository implements StaffRepo {
  constructor(private readonly ex: Executor) {}
  private static COLS = "id, full_name, role, email, phone, photo_url, active";
  async listAll(): Promise<Staff[]> {
    const rows = await this.ex.all<M.StaffRow>(
      `SELECT ${PgStaffRepository.COLS} FROM staff ORDER BY full_name`,
    );
    return rows.map(M.toStaff);
  }
  async findById(id: number): Promise<Staff | null> {
    const row = await this.ex.get<M.StaffRow>(
      `SELECT ${PgStaffRepository.COLS} FROM staff WHERE id = $1`,
      [id],
    );
    return row ? M.toStaff(row) : null;
  }
  async create(input: CreateStaffInput): Promise<Staff> {
    const r = await this.ex.run(
      "INSERT INTO staff (full_name, role, email, phone, photo_url) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [
        input.fullName,
        input.role ?? "staff",
        input.email ?? null,
        input.phone ?? null,
        input.photoUrl ?? null,
      ],
    );
    return (await this.findById(r.lastId!))!;
  }
  async update(id: number, patch: UpdateStaffInput): Promise<Staff | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await this.ex.run(
      "UPDATE staff SET full_name = $1, role = $2, email = $3, phone = $4, photo_url = $5, active = $6 WHERE id = $7",
      [
        patch.fullName ?? current.fullName,
        patch.role ?? current.role,
        patch.email === undefined ? current.email : patch.email,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.photoUrl === undefined ? current.photoUrl : patch.photoUrl,
        patch.active ?? current.active,
        id,
      ],
    );
    return this.findById(id);
  }
  async deactivate(id: number): Promise<boolean> {
    const r = await this.ex.run("UPDATE staff SET active = false WHERE id = $1", [id]);
    return r.changes > 0;
  }
}

class PgSlotPresetRepository implements SlotPresetRepo {
  constructor(private readonly ex: Executor) {}
  async listAll(): Promise<SlotPreset[]> {
    const rows = await this.ex.all<M.PresetRow>(
      "SELECT id, label, minutes, active FROM slot_presets ORDER BY minutes",
    );
    return rows.map(M.toPreset);
  }
  async findById(id: number): Promise<SlotPreset | null> {
    const row = await this.ex.get<M.PresetRow>(
      "SELECT id, label, minutes, active FROM slot_presets WHERE id = $1",
      [id],
    );
    return row ? M.toPreset(row) : null;
  }
  async create(label: string, minutes: number): Promise<SlotPreset> {
    const r = await this.ex.run(
      "INSERT INTO slot_presets (label, minutes) VALUES ($1, $2) RETURNING id",
      [label, minutes],
    );
    return (await this.findById(r.lastId!))!;
  }
  async update(
    id: number,
    patch: { label?: string; minutes?: number; active?: boolean },
  ): Promise<SlotPreset | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await this.ex.run("UPDATE slot_presets SET label = $1, minutes = $2, active = $3 WHERE id = $4", [
      patch.label ?? current.label,
      patch.minutes ?? current.minutes,
      patch.active ?? current.active,
      id,
    ]);
    return this.findById(id);
  }
  async delete(id: number): Promise<boolean> {
    const r = await this.ex.run("DELETE FROM slot_presets WHERE id = $1", [id]);
    return r.changes > 0;
  }
}

class PgShiftRepository implements ShiftRepo {
  constructor(private readonly ex: Executor) {}
  private static COLS = "id, name, start_time, end_time, active";
  private static ACOLS = "id, shift_id, doctor_id, staff_id, date";
  async listShifts(): Promise<Shift[]> {
    const rows = await this.ex.all<M.ShiftRow>(
      `SELECT ${PgShiftRepository.COLS} FROM shifts ORDER BY start_time`,
    );
    return rows.map(M.toShift);
  }
  async findShift(id: number): Promise<Shift | null> {
    const row = await this.ex.get<M.ShiftRow>(
      `SELECT ${PgShiftRepository.COLS} FROM shifts WHERE id = $1`,
      [id],
    );
    return row ? M.toShift(row) : null;
  }
  async createShift(name: string, startTime: string, endTime: string): Promise<Shift> {
    const r = await this.ex.run(
      "INSERT INTO shifts (name, start_time, end_time) VALUES ($1, $2, $3) RETURNING id",
      [name, startTime, endTime],
    );
    return (await this.findShift(r.lastId!))!;
  }
  async updateShift(id: number, patch: UpdateShiftInput): Promise<Shift | null> {
    const current = await this.findShift(id);
    if (!current) return null;
    await this.ex.run(
      "UPDATE shifts SET name = $1, start_time = $2, end_time = $3, active = $4 WHERE id = $5",
      [
        patch.name ?? current.name,
        patch.startTime ?? current.startTime,
        patch.endTime ?? current.endTime,
        patch.active ?? current.active,
        id,
      ],
    );
    return this.findShift(id);
  }
  async deleteShift(id: number): Promise<boolean> {
    const r = await this.ex.run("DELETE FROM shifts WHERE id = $1", [id]);
    return r.changes > 0;
  }
  async listAssignments(date?: string): Promise<ShiftAssignment[]> {
    const rows = date
      ? await this.ex.all<M.AssignmentRow>(
          `SELECT ${PgShiftRepository.ACOLS} FROM shift_assignments WHERE date = $1 ORDER BY id`,
          [date],
        )
      : await this.ex.all<M.AssignmentRow>(
          `SELECT ${PgShiftRepository.ACOLS} FROM shift_assignments ORDER BY date, id`,
        );
    return rows.map(M.toAssignment);
  }
  async findAssignment(id: number): Promise<ShiftAssignment | null> {
    const row = await this.ex.get<M.AssignmentRow>(
      `SELECT ${PgShiftRepository.ACOLS} FROM shift_assignments WHERE id = $1`,
      [id],
    );
    return row ? M.toAssignment(row) : null;
  }
  async createAssignment(input: CreateAssignmentInput): Promise<ShiftAssignment> {
    const r = await this.ex.run(
      "INSERT INTO shift_assignments (shift_id, doctor_id, staff_id, date) VALUES ($1, $2, $3, $4) RETURNING id",
      [input.shiftId, input.doctorId ?? null, input.staffId ?? null, input.date],
    );
    return (await this.findAssignment(r.lastId!))!;
  }
  async deleteAssignment(id: number): Promise<boolean> {
    const r = await this.ex.run("DELETE FROM shift_assignments WHERE id = $1", [id]);
    return r.changes > 0;
  }
}

export function makePgRepos(ex: Executor): Repositories {
  return {
    specialties: new PgSpecialtyRepository(ex),
    doctors: new PgDoctorRepository(ex),
    schedules: new PgScheduleRepository(ex),
    patients: new PgPatientRepository(ex),
    bookings: new PgBookingRepository(ex),
    sessions: new PgSessionRepository(ex),
    audit: new PgAuditRepository(ex),
    clinic: new PgClinicRepository(ex),
    theme: new PgThemeRepository(ex),
    staff: new PgStaffRepository(ex),
    slotPresets: new PgSlotPresetRepository(ex),
    shifts: new PgShiftRepository(ex),
    auth: new PgAuthRepository(ex),
  };
}
