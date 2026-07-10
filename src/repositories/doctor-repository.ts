import type { DB } from "../db/connection.js";
import type { Doctor } from "../domain/types.js";

interface Row {
  id: number;
  full_name: string;
  specialty_id: number;
  specialty_name: string;
  photo_url: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  active: number;
}

function toDoctor(row: Row): Doctor {
  return {
    id: row.id,
    fullName: row.full_name,
    specialtyId: row.specialty_id,
    specialtyName: row.specialty_name,
    photoUrl: row.photo_url,
    email: row.email,
    phone: row.phone,
    bio: row.bio,
    active: row.active === 1,
  };
}

const BASE_SELECT = `
  SELECT d.id, d.full_name, d.specialty_id, d.active, d.photo_url,
         d.email, d.phone, d.bio, s.name AS specialty_name
  FROM doctors d
  JOIN specialties s ON s.id = d.specialty_id
`;

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

  create(input: CreateDoctorInput): Doctor {
    const result = this.db
      .prepare(
        `INSERT INTO doctors (full_name, specialty_id, photo_url, email, phone, bio)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.fullName,
        input.specialtyId,
        input.photoUrl ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.bio ?? null,
      );
    return this.findById(Number(result.lastInsertRowid))!;
  }

  /** Partial update; merges over the current row. Returns null if not found. */
  update(id: number, patch: UpdateDoctorInput): Doctor | null {
    const current = this.findById(id);
    if (!current) return null;
    this.db
      .prepare(
        `UPDATE doctors
         SET full_name = ?, specialty_id = ?, photo_url = ?, email = ?, phone = ?, bio = ?, active = ?
         WHERE id = ?`,
      )
      .run(
        patch.fullName ?? current.fullName,
        patch.specialtyId ?? current.specialtyId,
        patch.photoUrl === undefined ? current.photoUrl : patch.photoUrl,
        patch.email === undefined ? current.email : patch.email,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.bio === undefined ? current.bio : patch.bio,
        (patch.active ?? current.active) ? 1 : 0,
        id,
      );
    return this.findById(id);
  }

  /** Soft delete: deactivate so historical bookings stay intact. */
  deactivate(id: number): boolean {
    const result = this.db.prepare("UPDATE doctors SET active = 0 WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
