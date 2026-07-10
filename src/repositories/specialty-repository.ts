import type { DB } from "../db/connection.js";
import type { Specialty } from "../domain/types.js";

interface Row {
  id: number;
  name: string;
  active: number;
}

function toSpecialty(row: Row): Specialty {
  return { id: row.id, name: row.name, active: row.active === 1 };
}

export class SpecialtyRepository {
  constructor(private readonly db: DB) {}

  listActive(): Specialty[] {
    const rows = this.db
      .prepare("SELECT id, name, active FROM specialties WHERE active = 1 ORDER BY name")
      .all() as Row[];
    return rows.map(toSpecialty);
  }

  findById(id: number): Specialty | null {
    const row = this.db
      .prepare("SELECT id, name, active FROM specialties WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? toSpecialty(row) : null;
  }
}
