import type { DB } from "../db/connection.js";
import type { Specialty } from "../domain/types.js";

interface Row {
  id: number;
  name: string;
  description: string | null;
  active: number;
}

function toSpecialty(row: Row): Specialty {
  return { id: row.id, name: row.name, description: row.description, active: row.active === 1 };
}

const COLS = "id, name, description, active";

export class SpecialtyRepository {
  constructor(private readonly db: DB) {}

  listActive(): Specialty[] {
    const rows = this.db
      .prepare(`SELECT ${COLS} FROM specialties WHERE active = 1 ORDER BY name`)
      .all() as Row[];
    return rows.map(toSpecialty);
  }

  listAll(): Specialty[] {
    const rows = this.db.prepare(`SELECT ${COLS} FROM specialties ORDER BY name`).all() as Row[];
    return rows.map(toSpecialty);
  }

  findById(id: number): Specialty | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM specialties WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row ? toSpecialty(row) : null;
  }

  create(name: string, description: string | null = null): Specialty {
    const result = this.db
      .prepare("INSERT INTO specialties (name, description) VALUES (?, ?)")
      .run(name, description);
    return this.findById(Number(result.lastInsertRowid))!;
  }

  update(
    id: number,
    patch: { name?: string; description?: string | null; active?: boolean },
  ): Specialty | null {
    const current = this.findById(id);
    if (!current) return null;
    this.db
      .prepare("UPDATE specialties SET name = ?, description = ?, active = ? WHERE id = ?")
      .run(
        patch.name ?? current.name,
        patch.description === undefined ? current.description : patch.description,
        (patch.active ?? current.active) ? 1 : 0,
        id,
      );
    return this.findById(id);
  }

  /** Soft delete so existing doctors/bookings keep their specialty reference. */
  deactivate(id: number): boolean {
    const result = this.db.prepare("UPDATE specialties SET active = 0 WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
