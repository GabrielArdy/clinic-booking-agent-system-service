import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Database as Db, DbType, Executor, RunResult } from "./executor.js";

/**
 * sqlite adapter over better-sqlite3. The driver is synchronous; methods return
 * already-resolved promises so callers share the async Database interface with
 * postgres. Because it is single-connection and synchronous, transactions use
 * manual BEGIN/COMMIT and the same executor inside the callback.
 */
export class SqliteDatabase implements Db {
  readonly type: DbType = "sqlite";

  constructor(private readonly db: Database.Database) {}

  static open(databasePath: string): SqliteDatabase {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    const db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return new SqliteDatabase(db);
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const r = this.db.prepare(sql).run(...(params as never[]));
    return { lastId: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null, changes: r.changes };
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (this.db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  async tx<T>(fn: (ex: Executor) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
