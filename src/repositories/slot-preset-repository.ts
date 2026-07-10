import type { DB } from "../db/connection.js";
import type { SlotPreset } from "../domain/types.js";

interface Row {
  id: number;
  label: string;
  minutes: number;
  active: number;
}

function toPreset(row: Row): SlotPreset {
  return { id: row.id, label: row.label, minutes: row.minutes, active: row.active === 1 };
}

const COLS = "id, label, minutes, active";

export class SlotPresetRepository {
  constructor(private readonly db: DB) {}

  listAll(): SlotPreset[] {
    const rows = this.db
      .prepare(`SELECT ${COLS} FROM slot_presets ORDER BY minutes`)
      .all() as Row[];
    return rows.map(toPreset);
  }

  findById(id: number): SlotPreset | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM slot_presets WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row ? toPreset(row) : null;
  }

  create(label: string, minutes: number): SlotPreset {
    const result = this.db
      .prepare("INSERT INTO slot_presets (label, minutes) VALUES (?, ?)")
      .run(label, minutes);
    return this.findById(Number(result.lastInsertRowid))!;
  }

  update(
    id: number,
    patch: { label?: string; minutes?: number; active?: boolean },
  ): SlotPreset | null {
    const current = this.findById(id);
    if (!current) return null;
    this.db
      .prepare("UPDATE slot_presets SET label = ?, minutes = ?, active = ? WHERE id = ?")
      .run(
        patch.label ?? current.label,
        patch.minutes ?? current.minutes,
        (patch.active ?? current.active) ? 1 : 0,
        id,
      );
    return this.findById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM slot_presets WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
