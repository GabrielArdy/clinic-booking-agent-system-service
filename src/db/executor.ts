export type DbType = "sqlite" | "postgres";

export interface RunResult {
  /** Last inserted row id (from lastInsertRowid on sqlite, RETURNING id on pg). */
  lastId: number | null;
  /** Number of affected rows. */
  changes: number;
}

/**
 * Minimal async query surface implemented by both the sqlite and postgres
 * adapters. Repositories depend only on this. Placeholders are dialect-specific
 * (`?` for sqlite, `$1..$n` for postgres) — hence the two repository impls.
 */
export interface Executor {
  readonly type: DbType;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  get<T>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** A connected database: an Executor plus transactions and lifecycle. */
export interface Database extends Executor {
  /** Runs `fn` inside a transaction; commits on resolve, rolls back on throw. */
  tx<T>(fn: (ex: Executor) => Promise<T>): Promise<T>;
  /** Executes raw multi-statement SQL (migrations); no parameters. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Coerce a dialect-native boolean (sqlite 0/1, postgres true/false) to boolean. */
export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1" || v === "t";
}
