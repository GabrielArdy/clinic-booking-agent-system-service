import type { DB } from "../db/connection.js";
import type { ScheduleException, ScheduleRule } from "../domain/types.js";

interface RuleRow {
  id: number;
  doctor_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
}

interface ExceptionRow {
  id: number;
  doctor_id: number;
  date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

export class ScheduleRepository {
  constructor(private readonly db: DB) {}

  rulesForDoctorWeekday(doctorId: number, weekday: number): ScheduleRule[] {
    const rows = this.db
      .prepare(
        `SELECT id, doctor_id, weekday, start_time, end_time, slot_minutes
         FROM doctor_schedule_rules WHERE doctor_id = ? AND weekday = ? ORDER BY start_time`,
      )
      .all(doctorId, weekday) as RuleRow[];
    return rows.map((r) => ({
      id: r.id,
      doctorId: r.doctor_id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
      slotMinutes: r.slot_minutes,
    }));
  }

  rulesForDoctor(doctorId: number): ScheduleRule[] {
    const rows = this.db
      .prepare(
        `SELECT id, doctor_id, weekday, start_time, end_time, slot_minutes
         FROM doctor_schedule_rules WHERE doctor_id = ? ORDER BY weekday, start_time`,
      )
      .all(doctorId) as RuleRow[];
    return rows.map((r) => ({
      id: r.id,
      doctorId: r.doctor_id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
      slotMinutes: r.slot_minutes,
    }));
  }

  exceptionsForDoctorDate(doctorId: number, date: string): ScheduleException[] {
    const rows = this.db
      .prepare(
        `SELECT id, doctor_id, date, start_time, end_time, reason
         FROM doctor_schedule_exceptions WHERE doctor_id = ? AND date = ?`,
      )
      .all(doctorId, date) as ExceptionRow[];
    return rows.map((r) => ({
      id: r.id,
      doctorId: r.doctor_id,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      reason: r.reason,
    }));
  }

  createRule(rule: Omit<ScheduleRule, "id">): number {
    const result = this.db
      .prepare(
        `INSERT INTO doctor_schedule_rules (doctor_id, weekday, start_time, end_time, slot_minutes)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(rule.doctorId, rule.weekday, rule.startTime, rule.endTime, rule.slotMinutes);
    return Number(result.lastInsertRowid);
  }

  createException(exception: Omit<ScheduleException, "id">): number {
    const result = this.db
      .prepare(
        `INSERT INTO doctor_schedule_exceptions (doctor_id, date, start_time, end_time, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        exception.doctorId,
        exception.date,
        exception.startTime,
        exception.endTime,
        exception.reason,
      );
    return Number(result.lastInsertRowid);
  }
}
