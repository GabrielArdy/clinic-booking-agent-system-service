import type { DB } from "../db/connection.js";
import type { Staff } from "../domain/types.js";

interface Row {
  id: number;
  full_name: string;
  role: string;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  active: number;
}

function toStaff(row: Row): Staff {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    photoUrl: row.photo_url,
    active: row.active === 1,
  };
}

const COLS = "id, full_name, role, email, phone, photo_url, active";

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

export class StaffRepository {
  constructor(private readonly db: DB) {}

  listAll(): Staff[] {
    const rows = this.db.prepare(`SELECT ${COLS} FROM staff ORDER BY full_name`).all() as Row[];
    return rows.map(toStaff);
  }

  findById(id: number): Staff | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM staff WHERE id = ?`).get(id) as Row | undefined;
    return row ? toStaff(row) : null;
  }

  create(input: CreateStaffInput): Staff {
    const result = this.db
      .prepare(
        "INSERT INTO staff (full_name, role, email, phone, photo_url) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        input.fullName,
        input.role ?? "staff",
        input.email ?? null,
        input.phone ?? null,
        input.photoUrl ?? null,
      );
    return this.findById(Number(result.lastInsertRowid))!;
  }

  update(id: number, patch: UpdateStaffInput): Staff | null {
    const current = this.findById(id);
    if (!current) return null;
    this.db
      .prepare(
        "UPDATE staff SET full_name = ?, role = ?, email = ?, phone = ?, photo_url = ?, active = ? WHERE id = ?",
      )
      .run(
        patch.fullName ?? current.fullName,
        patch.role ?? current.role,
        patch.email === undefined ? current.email : patch.email,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.photoUrl === undefined ? current.photoUrl : patch.photoUrl,
        (patch.active ?? current.active) ? 1 : 0,
        id,
      );
    return this.findById(id);
  }

  deactivate(id: number): boolean {
    const result = this.db.prepare("UPDATE staff SET active = 0 WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
