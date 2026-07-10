import type { DB } from "../db/connection.js";
import type { Booking } from "../domain/types.js";

interface Row {
  id: number;
  reference: string;
  patient_id: number;
  doctor_id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: "active" | "cancelled";
}

function toBooking(row: Row): Booking {
  return {
    id: row.id,
    reference: row.reference,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
  };
}

const BASE_SELECT = `
  SELECT id, reference, patient_id, doctor_id, date, start_time, end_time, status
  FROM bookings
`;

export class BookingRepository {
  constructor(private readonly db: DB) {}

  activeStartTimes(doctorId: number, date: string): Set<string> {
    const rows = this.db
      .prepare(
        "SELECT start_time FROM bookings WHERE doctor_id = ? AND date = ? AND status = 'active'",
      )
      .all(doctorId, date) as { start_time: string }[];
    return new Set(rows.map((r) => r.start_time));
  }

  isSlotTaken(doctorId: number, date: string, startTime: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM bookings
         WHERE doctor_id = ? AND date = ? AND start_time = ? AND status = 'active'`,
      )
      .get(doctorId, date, startTime);
    return row !== undefined;
  }

  create(booking: Omit<Booking, "id" | "status">): Booking {
    const result = this.db
      .prepare(
        `INSERT INTO bookings (reference, patient_id, doctor_id, date, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        booking.reference,
        booking.patientId,
        booking.doctorId,
        booking.date,
        booking.startTime,
        booking.endTime,
      );
    return { ...booking, id: Number(result.lastInsertRowid), status: "active" };
  }

  findByReference(reference: string): Booking | null {
    const row = this.db.prepare(`${BASE_SELECT} WHERE reference = ?`).get(reference) as
      | Row
      | undefined;
    return row ? toBooking(row) : null;
  }

  listByDoctorDate(doctorId: number, date: string): Booking[] {
    const rows = this.db
      .prepare(`${BASE_SELECT} WHERE doctor_id = ? AND date = ? ORDER BY start_time`)
      .all(doctorId, date) as Row[];
    return rows.map(toBooking);
  }

  cancel(id: number): void {
    this.db
      .prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?")
      .run(id);
  }
}
