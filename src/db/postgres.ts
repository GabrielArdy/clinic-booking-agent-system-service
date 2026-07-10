import pg from "pg";
import type { Database as Db, DbType, Executor, RunResult } from "./executor.js";

const { Pool, types } = pg;

// Return timestamp / timestamptz as raw strings (not JS Date) so the API shape
// matches sqlite's TEXT timestamps. 1114 = timestamp, 1184 = timestamptz.
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1184, (v) => v);

/** Wraps a pg Pool or a checked-out PoolClient with the Executor surface. */
class PgExecutor implements Executor {
  readonly type: DbType = "postgres";

  constructor(private readonly q: pg.Pool | pg.PoolClient) {}

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const r = await this.q.query(sql, params as unknown[]);
    const first = r.rows[0] as { id?: number } | undefined;
    return { lastId: first?.id ?? null, changes: r.rowCount ?? 0 };
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const r = await this.q.query(sql, params as unknown[]);
    return (r.rows[0] as T | undefined) ?? null;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.q.query(sql, params as unknown[]);
    return r.rows as T[];
  }
}

export interface PgConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
}

/**
 * postgres adapter over node-postgres. INSERTs in the pg repositories append
 * `RETURNING id` so `run().lastId` is populated. Transactions check out a
 * dedicated client so BEGIN/COMMIT wrap only that connection.
 */
export class PgDatabase implements Db {
  readonly type: DbType = "postgres";
  private readonly base: PgExecutor;

  constructor(private readonly pool: pg.Pool) {
    this.base = new PgExecutor(pool);
  }

  static open(config: PgConfig): PgDatabase {
    const pool = config.connectionString
      ? new Pool({
          connectionString: config.connectionString,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        })
      : new Pool({
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
          database: config.database,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        });
    return new PgDatabase(pool);
  }

  run(sql: string, params?: unknown[]): Promise<RunResult> {
    return this.base.run(sql, params);
  }
  get<T>(sql: string, params?: unknown[]): Promise<T | null> {
    return this.base.get<T>(sql, params);
  }
  all<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.base.all<T>(sql, params);
  }

  async tx<T>(fn: (ex: Executor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
