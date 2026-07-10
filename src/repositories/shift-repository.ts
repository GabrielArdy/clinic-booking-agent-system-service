import type { DB } from "../db/connection.js";
import type { Shift, ShiftAssignment } from "../domain/types.js";

interface ShiftRow {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  active: number;
}

function toShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    active: row.active === 1,
  };
}

interface AssignmentRow {
  id: number;
  shift_id: number;
  doctor_id: number | null;
  staff_id: number | null;
  date: string;
}

function toAssignment(row: AssignmentRow): ShiftAssignment {
  return {
    id: row.id,
    shiftId: row.shift_id,
    doctorId: row.doctor_id,
    staffId: row.staff_id,
    date: row.date,
  };
}

const SHIFT_COLS = "id, name, start_time, end_time, active";
const ASSIGN_COLS = "id, shift_id, doctor_id, staff_id, date";

export interface CreateAssignmentInput {
  shiftId: number;
  doctorId?: number | null;
  staffId?: number | null;
  date: string;
}

export class ShiftRepository {
  constructor(private readonly db: DB) {}

  // ---- shifts ----
  listShifts(): Shift[] {
    const rows = this.db.prepare(`SELECT ${SHIFT_COLS} FROM shifts ORDER BY start_time`).all() as ShiftRow[];
    return rows.map(toShift);
  }

  findShift(id: number): Shift | null {
    const row = this.db.prepare(`SELECT ${SHIFT_COLS} FROM shifts WHERE id = ?`).get(id) as
      | ShiftRow
      | undefined;
    return row ? toShift(row) : null;
  }

  createShift(name: string, startTime: string, endTime: string): Shift {
    const result = this.db
      .prepare("INSERT INTO shifts (name, start_time, end_time) VALUES (?, ?, ?)")
      .run(name, startTime, endTime);
    return this.findShift(Number(result.lastInsertRowid))!;
  }

  updateShift(
    id: number,
    patch: { name?: string; startTime?: string; endTime?: string; active?: boolean },
  ): Shift | null {
    const current = this.findShift(id);
    if (!current) return null;
    this.db
      .prepare("UPDATE shifts SET name = ?, start_time = ?, end_time = ?, active = ? WHERE id = ?")
      .run(
        patch.name ?? current.name,
        patch.startTime ?? current.startTime,
        patch.endTime ?? current.endTime,
        (patch.active ?? current.active) ? 1 : 0,
        id,
      );
    return this.findShift(id);
  }

  deleteShift(id: number): boolean {
    const result = this.db.prepare("DELETE FROM shifts WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ---- assignments (on-duty roster) ----
  listAssignments(date?: string): ShiftAssignment[] {
    const rows = date
      ? (this.db
          .prepare(`SELECT ${ASSIGN_COLS} FROM shift_assignments WHERE date = ? ORDER BY id`)
          .all(date) as AssignmentRow[])
      : (this.db
          .prepare(`SELECT ${ASSIGN_COLS} FROM shift_assignments ORDER BY date, id`)
          .all() as AssignmentRow[]);
    return rows.map(toAssignment);
  }

  findAssignment(id: number): ShiftAssignment | null {
    const row = this.db
      .prepare(`SELECT ${ASSIGN_COLS} FROM shift_assignments WHERE id = ?`)
      .get(id) as AssignmentRow | undefined;
    return row ? toAssignment(row) : null;
  }

  createAssignment(input: CreateAssignmentInput): ShiftAssignment {
    const result = this.db
      .prepare(
        "INSERT INTO shift_assignments (shift_id, doctor_id, staff_id, date) VALUES (?, ?, ?, ?)",
      )
      .run(input.shiftId, input.doctorId ?? null, input.staffId ?? null, input.date);
    return this.findAssignment(Number(result.lastInsertRowid))!;
  }

  deleteAssignment(id: number): boolean {
    const result = this.db.prepare("DELETE FROM shift_assignments WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
