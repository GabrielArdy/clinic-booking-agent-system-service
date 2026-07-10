import type { DB } from "../db/connection.js";
import type { Doctor } from "../domain/types.js";

interface Row {
  id: number;
  full_name: string;
  specialty_id: number;
  specialty_name: string;
  photo_url: string | null;
  active: number;
}

function toDoctor(row: Row): Doctor {
  return {
    id: row.id,
    fullName: row.full_name,
    specialtyId: row.specialty_id,
    specialtyName: row.specialty_name,
    photoUrl: row.photo_url,
    active: row.active === 1,
  };
}

const BASE_SELECT = `
  SELECT d.id, d.full_name, d.specialty_id, d.active, d.photo_url, s.name AS specialty_name
  FROM doctors d
  JOIN specialties s ON s.id = d.specialty_id
`;

export class DoctorRepository {
  constructor(private readonly db: DB) {}

  listActiveBySpecialty(specialtyId: number): Doctor[] {
    const rows = this.db
      .prepare(`${BASE_SELECT} WHERE d.specialty_id = ? AND d.active = 1 ORDER BY d.full_name`)
      .all(specialtyId) as Row[];
    return rows.map(toDoctor);
  }

  listAll(): Doctor[] {
    const rows = this.db.prepare(`${BASE_SELECT} ORDER BY d.full_name`).all() as Row[];
    return rows.map(toDoctor);
  }

  findById(id: number): Doctor | null {
    const row = this.db.prepare(`${BASE_SELECT} WHERE d.id = ?`).get(id) as Row | undefined;
    return row ? toDoctor(row) : null;
  }

  create(fullName: string, specialtyId: number, photoUrl: string | null = null): Doctor {
    const result = this.db
      .prepare("INSERT INTO doctors (full_name, specialty_id, photo_url) VALUES (?, ?, ?)")
      .run(fullName, specialtyId, photoUrl);
    return this.findById(Number(result.lastInsertRowid))!;
  }
}
