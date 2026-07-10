import type { DB } from "../db/connection.js";
import type { ClinicSetting } from "../domain/types.js";

interface Row {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  permission_letter_url: string | null;
  emblem_url: string | null;
  extra_json: string;
  updated_at: string;
}

function toClinicSetting(row: Row): ClinicSetting {
  return {
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    email: row.email,
    permissionLetterUrl: row.permission_letter_url,
    emblemUrl: row.emblem_url,
    extra: safeParse(row.extra_json),
    updatedAt: row.updated_at,
  };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface UpdateClinicInput {
  name?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
  permissionLetterUrl?: string | null;
  emblemUrl?: string | null;
  extra?: Record<string, unknown>;
}

/** Single-row (id = 1) clinic settings, seeded by migration 003. */
export class ClinicSettingsRepository {
  constructor(private readonly db: DB) {}

  get(): ClinicSetting {
    const row = this.db.prepare("SELECT * FROM clinic_settings WHERE id = 1").get() as Row;
    return toClinicSetting(row);
  }

  update(patch: UpdateClinicInput): ClinicSetting {
    const current = this.get();
    this.db
      .prepare(
        `UPDATE clinic_settings SET
           name = ?, address = ?, latitude = ?, longitude = ?, phone = ?, email = ?,
           permission_letter_url = ?, emblem_url = ?, extra_json = ?, updated_at = datetime('now')
         WHERE id = 1`,
      )
      .run(
        patch.name ?? current.name,
        patch.address ?? current.address,
        patch.latitude === undefined ? current.latitude : patch.latitude,
        patch.longitude === undefined ? current.longitude : patch.longitude,
        patch.phone === undefined ? current.phone : patch.phone,
        patch.email === undefined ? current.email : patch.email,
        patch.permissionLetterUrl === undefined
          ? current.permissionLetterUrl
          : patch.permissionLetterUrl,
        patch.emblemUrl === undefined ? current.emblemUrl : patch.emblemUrl,
        JSON.stringify(patch.extra ?? current.extra),
      );
    return this.get();
  }
}
