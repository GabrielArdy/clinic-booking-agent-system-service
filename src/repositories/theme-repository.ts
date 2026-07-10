import type { DB } from "../db/connection.js";
import type { ThemeSetting } from "../domain/types.js";

interface Row {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string | null;
  font_family: string;
  dark_mode: number;
  extra_json: string;
  updated_at: string;
}

function toTheme(row: Row): ThemeSetting {
  return {
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    accentColor: row.accent_color,
    logoUrl: row.logo_url,
    fontFamily: row.font_family,
    darkMode: row.dark_mode === 1,
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

export interface UpdateThemeInput {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string | null;
  fontFamily?: string;
  darkMode?: boolean;
  extra?: Record<string, unknown>;
}

/** Single-row (id = 1) theme settings, seeded by migration 003. */
export class ThemeRepository {
  constructor(private readonly db: DB) {}

  get(): ThemeSetting {
    const row = this.db.prepare("SELECT * FROM theme_settings WHERE id = 1").get() as Row;
    return toTheme(row);
  }

  update(patch: UpdateThemeInput): ThemeSetting {
    const current = this.get();
    this.db
      .prepare(
        `UPDATE theme_settings SET
           primary_color = ?, secondary_color = ?, accent_color = ?, logo_url = ?,
           font_family = ?, dark_mode = ?, extra_json = ?, updated_at = datetime('now')
         WHERE id = 1`,
      )
      .run(
        patch.primaryColor ?? current.primaryColor,
        patch.secondaryColor ?? current.secondaryColor,
        patch.accentColor ?? current.accentColor,
        patch.logoUrl === undefined ? current.logoUrl : patch.logoUrl,
        patch.fontFamily ?? current.fontFamily,
        (patch.darkMode ?? current.darkMode) ? 1 : 0,
        JSON.stringify(patch.extra ?? current.extra),
      );
    return this.get();
  }
}
