import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";
import type { Database } from "./executor.js";
import { seed } from "./seed.js";
import { logger } from "../logging/logger.js";

/**
 * Empties every application table (schema and migration history are kept).
 * Tables are discovered at runtime so new migrations are covered automatically.
 * DESTRUCTIVE — the CLI below requires an explicit --yes.
 */
export async function truncateAll(db: Database): Promise<string[]> {
  const tables =
    db.type === "postgres"
      ? (
          await db.all<{ tablename: string }>(
            `SELECT tablename FROM pg_tables
             WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
          )
        ).map((r) => r.tablename)
      : (
          await db.all<{ name: string }>(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`,
          )
        ).map((r) => r.name);

  if (tables.length === 0) return [];

  if (db.type === "postgres") {
    // CASCADE resolves FK ordering; RESTART IDENTITY resets sequences.
    const list = tables.map((t) => `"${t}"`).join(", ");
    await db.exec(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  } else {
    await db.exec("PRAGMA foreign_keys = OFF");
    try {
      for (const t of tables) {
        await db.run(`DELETE FROM "${t}"`);
      }
      // Reset AUTOINCREMENT counters (table only exists once used).
      const hasSeq = await db.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'",
      );
      if (hasSeq) await db.run("DELETE FROM sqlite_sequence");
    } finally {
      await db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // Singleton settings rows are created by migration 003, not by the seed —
  // restore them so repos.clinic.get() / repos.theme.get() keep working.
  for (const singleton of ["clinic_settings", "theme_settings"]) {
    if (tables.includes(singleton)) {
      await db.run(`INSERT INTO ${singleton} (id) VALUES (1)`);
    }
  }
  return tables;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes");
  const reseed = args.includes("--seed");

  const config = loadConfig();
  // Never print credentials: mask the password when a URL is used.
  const target =
    config.dbType === "postgres"
      ? (config.postgres.connectionString ?? `${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`).replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@")
      : config.databasePath;

  if (!confirmed) {
    console.error(
      [
        "Refusing to run without --yes.",
        `This would DELETE ALL DATA in ${config.dbType} database: ${target}`,
        "",
        "Usage: npm run db:truncate -- --yes [--seed]",
        "  --yes    confirm the wipe (required)",
        "  --seed   re-run the idempotent seed afterwards",
      ].join("\n"),
    );
    process.exit(1);
  }

  const db = openDatabase(config);
  const tables = await truncateAll(db);
  logger.info("database truncated", { dbType: config.dbType, target, tables: tables.length });
  if (reseed) {
    await seed(db);
    logger.info("reseed complete");
  }
  await db.close();
}
