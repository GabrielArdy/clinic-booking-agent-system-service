import type { DB } from "../db/connection.js";
import type { Patient } from "../domain/types.js";

interface Row {
  id: number;
  full_name: string;
  phone: string;
}

function toPatient(row: Row): Patient {
  return { id: row.id, fullName: row.full_name, phone: row.phone };
}

export class PatientRepository {
  constructor(private readonly db: DB) {}

  findByPhone(phone: string): Patient | null {
    const row = this.db
      .prepare("SELECT id, full_name, phone FROM patients WHERE phone = ?")
      .get(phone) as Row | undefined;
    return row ? toPatient(row) : null;
  }

  findById(id: number): Patient | null {
    const row = this.db
      .prepare("SELECT id, full_name, phone FROM patients WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? toPatient(row) : null;
  }

  create(fullName: string, phone: string): Patient {
    const result = this.db
      .prepare("INSERT INTO patients (full_name, phone) VALUES (?, ?)")
      .run(fullName, phone);
    return { id: Number(result.lastInsertRowid), fullName, phone };
  }
}
