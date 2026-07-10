import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";
import type { Database } from "./executor.js";
import type { DbType } from "./executor.js";
import { logger } from "../logging/logger.js";

const MIGRATIONS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

function schemaMigrationsDdl(type: DbType): string {
  const appliedAt =
    type === "postgres"
      ? "applied_at TIMESTAMPTZ NOT NULL DEFAULT now()"
      : "applied_at TEXT NOT NULL DEFAULT (datetime('now'))";
  return `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, ${appliedAt})`;
}

/** Applies pending .sql migrations from migrations/<dbType>/ in filename order. */
export async function runMigrations(db: Database): Promise<string[]> {
  const dir = path.join(MIGRATIONS_ROOT, db.type);
  await db.exec(schemaMigrationsDdl(db.type));

  const applied = new Set(
    (await db.all<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name),
  );

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const placeholder = db.type === "postgres" ? "$1" : "?";
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await db.exec(sql);
    await db.run(`INSERT INTO schema_migrations (name) VALUES (${placeholder})`, [file]);
    ran.push(file);
  }
  return ran;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  const ran = await runMigrations(db);
  logger.info("migrations complete", { ran, dbType: config.dbType });
  await db.close();
}
