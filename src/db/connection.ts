import type { AppConfig } from "../config.js";
import type { Database } from "./executor.js";
import { SqliteDatabase } from "./sqlite.js";
import { PgDatabase } from "./postgres.js";

export type { Database } from "./executor.js";

/** Opens the configured database (sqlite or postgres). */
export function openDatabase(config: AppConfig): Database {
  if (config.dbType === "postgres") {
    return PgDatabase.open(config.postgres);
  }
  return SqliteDatabase.open(config.databasePath);
}
