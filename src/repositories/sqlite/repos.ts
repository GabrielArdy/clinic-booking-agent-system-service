import { randomUUID } from "node:crypto";
import type { Executor } from "../../db/executor.js";
import type {
  Booking,
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
} from "../../domain/types.js";
import * as M from "../mappers.js";
import type {
  AuditRepo,
  BookingRepo,
  ChatMessage,
  ClinicRepo,
  CreateAssignmentInput,
  CreateDoctorInput,
  CreateStaffInput,
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
  UpdateShiftInput,
  UpdateSpecialtyInput,
  UpdateStaffInput,
  UpdateThemeInput,
} from "../ports.js";

/** better-sqlite3 cannot bind JS booleans — store as 0/1. */
const b = (v: boolean): number => (v ? 1 : 0);

class SqliteSpecialtyRepository implements SpecialtyRepo {
  constructor(private readonly ex: Executor) {}
  private static COLS = "id, name, description, active";
  async listActive(): Promise<Specialty[]> {
    const rows = await this.ex.all<M.SpecialtyRow>(
      `SELECT ${SqliteSpecialtyRepository.COLS} FROM specialties WHERE active = 1 ORDER BY name`,
    );
    return rows.map(M.toSpecialty);
  }
  async listAll(): Promise<Specialty[]> {
    const rows = await this.ex.all<M.SpecialtyRow>(
      `SELECT ${SqliteSpecialtyRepository.COLS} FROM specialties ORDER BY name`,
    );
    return rows.map(M.toSpecialty);
  }
  async findById(id: number): Promise<Specialty | null> {
    const row = await this.ex.get<M.SpecialtyRow>(
      `SELECT ${SqliteSpecialtyRepository.COLS} FROM specialties WHERE id = ?`,
      [id],
    );
    return row ? M.toSpecialty(row) : null;
  }
  async create(name: string, description: string | null = null): Promise<Specialty> {
    const r = await this.ex.run("INSERT INTO specialties (name, description) VALUES (?, ?)", [
      name,
      description,
    ]);
    return (await this.findById(r.lastId!))!;
  }
  async update(id: number, patch: UpdateSpecialtyInput): Promise<Specialty | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await this.ex.run("UPDATE specialties SET name = ?, description = ?, active = ? WHERE id = ?", [
      patch.name ?? current.name,
      patch.description === undefined ? current.description : patch.description,
      b(patch.active ?? current.active),
      id,
    ]);
    return this.findById(id);
  }
  async deactivate(id: number): Promise<boolean> {
    const r = await this.ex.run("UPDATE specialties SET active = 0 WHERE id = ?", [id]);
    return r.changes > 0;
  }
}

const DOCTOR_SELECT = `
  SELECT d.id, d.full_name, d.specialty_id, d.active, d.photo_url,
         d.email, d.phone, d.bio, s.name AS specialty_name
  FROM doctors d JOIN specialties s ON s.id = d.specialty_id
`;

class SqliteDoctorRepository implements DoctorRepo {
  constructor(private readonly ex: Executor) {}
  async listActiveBySpecialty(specialtyId: number): Promise<Doctor[]> {
    const rows = await this.ex.all<M.DoctorRow>(
      `${DOCTOR_SELECT} WHERE d.specialty_id = ? AND d.active = 1 ORDER BY d.full_name`,
      [specialtyId],
    );
    return rows.map(M.toDoctor);
  }
  async listAll(): Promise<Doctor[]> {
    const rows = await this.ex.all<M.DoctorRow>(`${DOCTOR_SELECT} ORDER BY d.full_name`);
    return rows.map(M.toDoctor);
  }
  async findById(id: number): Promise<Doctor | null> {
    const row = await this.ex.get<M.DoctorRow>(`${DOCTOR_SELECT} WHERE d.id = ?`, [id]);
    return row ? M.toDoctor(row) : null;
  }
  async create(input: CreateDoctorInput): Promise<Doctor> {
    const r = await this.ex.run(
      `INSERT INTO doctors (full_name, specialty_id, photo_url, email, phone, bio)
       VALUES (?, ?, ?, ?, ?, ?)`,
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
      `UPDATE doctors SET full_name = ?, specialty_id = ?, photo_url = ?, email = ?, phone = ?, bio = ?, active = ?
       WHERE id = ?`,
      [
        patch.fullName ?? current.fullName,
        patch.specialtyId ?? current.specialtyId,
        patch.photoUrl === undefined ? current.photoUrl : patch.photoUrl,
        patch.email === undefined ? current.email : patch.email,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.bio === undefined ? current.bio : patch.bio,
        b(patch.active ?? current.active),
        id,
      ],
    );
    return this.findById(id);
  }
  async deactivate(id: number): Promise<boolean> {
    const r = await this.ex.run("UPDATE doctors SET active = 0 WHERE id = ?", [id]);
    return r.changes > 0;
  }
}

class SqliteScheduleRepository implements ScheduleRepo {
  constructor(private readonly ex: Executor) {}
  async rulesForDoctorWeekday(doctorId: number, weekday: number): Promise<ScheduleRule[]> {
    const rows = await this.ex.all<M.RuleRow>(
      `SELECT id, doctor_id, weekday, start_time, end_time, slot_minutes
       FROM doctor_schedule_rules WHERE doctor_id = ? AND weekday = ? ORDER BY start_time`,
      [doctorId, weekday],
    );
    return rows.map(M.toRule);
  }
  async rulesForDoctor(doctorId: number): Promise<ScheduleRule[]> {
    const rows = await this.ex.all<M.RuleRow>(
      `SELECT id, doctor_id, weekday, start_time, end_time, slot_minutes
       FROM doctor_schedule_rules WHERE doctor_id = ? ORDER BY weekday, start_time`,
      [doctorId],
    );
    return rows.map(M.toRule);
  }
  async exceptionsForDoctorDate(doctorId: number, date: string): Promise<ScheduleException[]> {
    const rows = await this.ex.all<M.ExceptionRow>(
      `SELECT id, doctor_id, date, start_time, end_time, reason
       FROM doctor_schedule_exceptions WHERE doctor_id = ? AND date = ?`,
      [doctorId, date],
    );
    return rows.map(M.toException);
  }
  async createRule(rule: Omit<ScheduleRule, "id">): Promise<number> {
    const r = await this.ex.run(
      `INSERT INTO doctor_schedule_rules (doctor_id, weekday, start_time, end_time, slot_minutes)
       VALUES (?, ?, ?, ?, ?)`,
      [rule.doctorId, rule.weekday, rule.startTime, rule.endTime, rule.slotMinutes],
    );
    return r.lastId!;
  }
  async createException(exception: Omit<ScheduleException, "id">): Promise<number> {
    const r = await this.ex.run(
      `INSERT INTO doctor_schedule_exceptions (doctor_id, date, start_time, end_time, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [exception.doctorId, exception.date, exception.startTime, exception.endTime, exception.reason],
    );
    return r.lastId!;
  }
}

class SqlitePatientRepository implements PatientRepo {
  constructor(private readonly ex: Executor) {}
  async findByPhone(phone: string): Promise<Patient | null> {
    const row = await this.ex.get<M.PatientRow>(
      "SELECT id, full_name, phone FROM patients WHERE phone = ?",
      [phone],
    );
    return row ? M.toPatient(row) : null;
  }
  async findById(id: number): Promise<Patient | null> {
    const row = await this.ex.get<M.PatientRow>(
      "SELECT id, full_name, phone FROM patients WHERE id = ?",
      [id],
    );
    return row ? M.toPatient(row) : null;
  }
  async create(fullName: string, phone: string): Promise<Patient> {
    const r = await this.ex.run("INSERT INTO patients (full_name, phone) VALUES (?, ?)", [
      fullName,
      phone,
    ]);
    return { id: r.lastId!, fullName, phone };
  }
}

const BOOKING_SELECT = `
  SELECT id, reference, patient_id, doctor_id, date, start_time, end_time, status FROM bookings
`;

class SqliteBookingRepository implements BookingRepo {
  constructor(private readonly ex: Executor) {}
  async activeStartTimes(doctorId: number, date: string): Promise<Set<string>> {
    const rows = await this.ex.all<{ start_time: string }>(
      "SELECT start_time FROM bookings WHERE doctor_id = ? AND date = ? AND status = 'active'",
      [doctorId, date],
    );
    return new Set(rows.map((r) => r.start_time));
  }
  async isSlotTaken(doctorId: number, date: string, startTime: string): Promise<boolean> {
    const row = await this.ex.get(
      `SELECT 1 FROM bookings WHERE doctor_id = ? AND date = ? AND start_time = ? AND status = 'active'`,
      [doctorId, date, startTime],
    );
    return row !== null;
  }
  async create(booking: Omit<Booking, "id" | "status">): Promise<Booking> {
    const r = await this.ex.run(
      `INSERT INTO bookings (reference, patient_id, doctor_id, date, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        booking.reference,
        booking.patientId,
        booking.doctorId,
        booking.date,
        booking.startTime,
        booking.endTime,
      ],
    );
    return { ...booking, id: r.lastId!, status: "active" };
  }
  async findByReference(reference: string): Promise<Booking | null> {
    const row = await this.ex.get<M.BookingRow>(`${BOOKING_SELECT} WHERE reference = ?`, [reference]);
    return row ? M.toBooking(row) : null;
  }
  async listByDoctorDate(doctorId: number, date: string): Promise<Booking[]> {
    const rows = await this.ex.all<M.BookingRow>(
      `${BOOKING_SELECT} WHERE doctor_id = ? AND date = ? ORDER BY start_time`,
      [doctorId, date],
    );
    return rows.map(M.toBooking);
  }
  async cancel(id: number): Promise<void> {
    await this.ex.run(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?",
      [id],
    );
  }
}

class SqliteSessionRepository implements SessionRepo {
  constructor(private readonly ex: Executor) {}
  async create(stage: string): Promise<SessionRecord> {
    const id = randomUUID();
    await this.ex.run(
      "INSERT INTO conversation_sessions (id, stage, state_json) VALUES (?, ?, '{}')",
      [id, stage],
    );
    return { id, stage, state: {} };
  }
  async find(id: string): Promise<SessionRecord | null> {
    const row = await this.ex.get<{ id: string; stage: string; state_json: string }>(
      "SELECT id, stage, state_json FROM conversation_sessions WHERE id = ?",
      [id],
    );
    if (!row) return null;
    return { id: row.id, stage: row.stage, state: M.safeParse(row.state_json) };
  }
  async save(session: SessionRecord): Promise<void> {
    await this.ex.run(
      `UPDATE conversation_sessions SET stage = ?, state_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [session.stage, JSON.stringify(session.state), session.id],
    );
  }
  async appendMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void> {
    await this.ex.run(
      "INSERT INTO conversation_messages (session_id, role, content) VALUES (?, ?, ?)",
      [sessionId, role, content],
    );
  }
  async messages(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.ex.all<{ role: string; content: string; created_at: string }>(
      `SELECT role, content, created_at FROM conversation_messages WHERE session_id = ? ORDER BY id`,
      [sessionId],
    );
    return rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at }));
  }
}

class SqliteAuditRepository implements AuditRepo {
  constructor(private readonly ex: Executor) {}
  async record(eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.ex.run("INSERT INTO audit_events (event_type, payload_json) VALUES (?, ?)", [
      eventType,
      JSON.stringify(payload),
    ]);
  }
}

class SqliteClinicRepository implements ClinicRepo {
  constructor(private readonly ex: Executor) {}
  async get(): Promise<ClinicSetting> {
    const row = await this.ex.get<M.ClinicRow>("SELECT * FROM clinic_settings WHERE id = 1");
    return M.toClinic(row!);
  }
  async update(patch: UpdateClinicInput): Promise<ClinicSetting> {
    const current = await this.get();
    await this.ex.run(
      `UPDATE clinic_settings SET
         name = ?, address = ?, latitude = ?, longitude = ?, phone = ?, email = ?,
         permission_letter_url = ?, emblem_url = ?, extra_json = ?, updated_at = datetime('now')
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

class SqliteThemeRepository implements ThemeRepo {
  constructor(private readonly ex: Executor) {}
  async get(): Promise<ThemeSetting> {
    const row = await this.ex.get<M.ThemeRow>("SELECT * FROM theme_settings WHERE id = 1");
    return M.toTheme(row!);
  }
  async update(patch: UpdateThemeInput): Promise<ThemeSetting> {
    const current = await this.get();
    await this.ex.run(
      `UPDATE theme_settings SET
         primary_color = ?, secondary_color = ?, accent_color = ?, logo_url = ?,
         font_family = ?, dark_mode = ?, extra_json = ?, updated_at = datetime('now')
       WHERE id = 1`,
      [
        patch.primaryColor ?? current.primaryColor,
        patch.secondaryColor ?? current.secondaryColor,
        patch.accentColor ?? current.accentColor,
        patch.logoUrl === undefined ? current.logoUrl : patch.logoUrl,
        patch.fontFamily ?? current.fontFamily,
        b(patch.darkMode ?? current.darkMode),
        JSON.stringify(patch.extra ?? current.extra),
      ],
    );
    return this.get();
  }
}

class SqliteStaffRepository implements StaffRepo {
  constructor(private readonly ex: Executor) {}
  private static COLS = "id, full_name, role, email, phone, photo_url, active";
  async listAll(): Promise<Staff[]> {
    const rows = await this.ex.all<M.StaffRow>(
      `SELECT ${SqliteStaffRepository.COLS} FROM staff ORDER BY full_name`,
    );
    return rows.map(M.toStaff);
  }
  async findById(id: number): Promise<Staff | null> {
    const row = await this.ex.get<M.StaffRow>(
      `SELECT ${SqliteStaffRepository.COLS} FROM staff WHERE id = ?`,
      [id],
    );
    return row ? M.toStaff(row) : null;
  }
  async create(input: CreateStaffInput): Promise<Staff> {
    const r = await this.ex.run(
      "INSERT INTO staff (full_name, role, email, phone, photo_url) VALUES (?, ?, ?, ?, ?)",
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
      "UPDATE staff SET full_name = ?, role = ?, email = ?, phone = ?, photo_url = ?, active = ? WHERE id = ?",
      [
        patch.fullName ?? current.fullName,
        patch.role ?? current.role,
        patch.email === undefined ? current.email : patch.email,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.photoUrl === undefined ? current.photoUrl : patch.photoUrl,
        b(patch.active ?? current.active),
        id,
      ],
    );
    return this.findById(id);
  }
  async deactivate(id: number): Promise<boolean> {
    const r = await this.ex.run("UPDATE staff SET active = 0 WHERE id = ?", [id]);
    return r.changes > 0;
  }
}

class SqliteSlotPresetRepository implements SlotPresetRepo {
  constructor(private readonly ex: Executor) {}
  async listAll(): Promise<SlotPreset[]> {
    const rows = await this.ex.all<M.PresetRow>(
      "SELECT id, label, minutes, active FROM slot_presets ORDER BY minutes",
    );
    return rows.map(M.toPreset);
  }
  async findById(id: number): Promise<SlotPreset | null> {
    const row = await this.ex.get<M.PresetRow>(
      "SELECT id, label, minutes, active FROM slot_presets WHERE id = ?",
      [id],
    );
    return row ? M.toPreset(row) : null;
  }
  async create(label: string, minutes: number): Promise<SlotPreset> {
    const r = await this.ex.run("INSERT INTO slot_presets (label, minutes) VALUES (?, ?)", [
      label,
      minutes,
    ]);
    return (await this.findById(r.lastId!))!;
  }
  async update(
    id: number,
    patch: { label?: string; minutes?: number; active?: boolean },
  ): Promise<SlotPreset | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await this.ex.run("UPDATE slot_presets SET label = ?, minutes = ?, active = ? WHERE id = ?", [
      patch.label ?? current.label,
      patch.minutes ?? current.minutes,
      b(patch.active ?? current.active),
      id,
    ]);
    return this.findById(id);
  }
  async delete(id: number): Promise<boolean> {
    const r = await this.ex.run("DELETE FROM slot_presets WHERE id = ?", [id]);
    return r.changes > 0;
  }
}

class SqliteShiftRepository implements ShiftRepo {
  constructor(private readonly ex: Executor) {}
  private static COLS = "id, name, start_time, end_time, active";
  private static ACOLS = "id, shift_id, doctor_id, staff_id, date";
  async listShifts(): Promise<Shift[]> {
    const rows = await this.ex.all<M.ShiftRow>(
      `SELECT ${SqliteShiftRepository.COLS} FROM shifts ORDER BY start_time`,
    );
    return rows.map(M.toShift);
  }
  async findShift(id: number): Promise<Shift | null> {
    const row = await this.ex.get<M.ShiftRow>(
      `SELECT ${SqliteShiftRepository.COLS} FROM shifts WHERE id = ?`,
      [id],
    );
    return row ? M.toShift(row) : null;
  }
  async createShift(name: string, startTime: string, endTime: string): Promise<Shift> {
    const r = await this.ex.run("INSERT INTO shifts (name, start_time, end_time) VALUES (?, ?, ?)", [
      name,
      startTime,
      endTime,
    ]);
    return (await this.findShift(r.lastId!))!;
  }
  async updateShift(id: number, patch: UpdateShiftInput): Promise<Shift | null> {
    const current = await this.findShift(id);
    if (!current) return null;
    await this.ex.run(
      "UPDATE shifts SET name = ?, start_time = ?, end_time = ?, active = ? WHERE id = ?",
      [
        patch.name ?? current.name,
        patch.startTime ?? current.startTime,
        patch.endTime ?? current.endTime,
        b(patch.active ?? current.active),
        id,
      ],
    );
    return this.findShift(id);
  }
  async deleteShift(id: number): Promise<boolean> {
    const r = await this.ex.run("DELETE FROM shifts WHERE id = ?", [id]);
    return r.changes > 0;
  }
  async listAssignments(date?: string): Promise<ShiftAssignment[]> {
    const rows = date
      ? await this.ex.all<M.AssignmentRow>(
          `SELECT ${SqliteShiftRepository.ACOLS} FROM shift_assignments WHERE date = ? ORDER BY id`,
          [date],
        )
      : await this.ex.all<M.AssignmentRow>(
          `SELECT ${SqliteShiftRepository.ACOLS} FROM shift_assignments ORDER BY date, id`,
        );
    return rows.map(M.toAssignment);
  }
  async findAssignment(id: number): Promise<ShiftAssignment | null> {
    const row = await this.ex.get<M.AssignmentRow>(
      `SELECT ${SqliteShiftRepository.ACOLS} FROM shift_assignments WHERE id = ?`,
      [id],
    );
    return row ? M.toAssignment(row) : null;
  }
  async createAssignment(input: CreateAssignmentInput): Promise<ShiftAssignment> {
    const r = await this.ex.run(
      "INSERT INTO shift_assignments (shift_id, doctor_id, staff_id, date) VALUES (?, ?, ?, ?)",
      [input.shiftId, input.doctorId ?? null, input.staffId ?? null, input.date],
    );
    return (await this.findAssignment(r.lastId!))!;
  }
  async deleteAssignment(id: number): Promise<boolean> {
    const r = await this.ex.run("DELETE FROM shift_assignments WHERE id = ?", [id]);
    return r.changes > 0;
  }
}

export function makeSqliteRepos(ex: Executor): Repositories {
  return {
    specialties: new SqliteSpecialtyRepository(ex),
    doctors: new SqliteDoctorRepository(ex),
    schedules: new SqliteScheduleRepository(ex),
    patients: new SqlitePatientRepository(ex),
    bookings: new SqliteBookingRepository(ex),
    sessions: new SqliteSessionRepository(ex),
    audit: new SqliteAuditRepository(ex),
    clinic: new SqliteClinicRepository(ex),
    theme: new SqliteThemeRepository(ex),
    staff: new SqliteStaffRepository(ex),
    slotPresets: new SqliteSlotPresetRepository(ex),
    shifts: new SqliteShiftRepository(ex),
  };
}
