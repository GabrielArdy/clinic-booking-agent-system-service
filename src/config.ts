import "dotenv/config";
import type { DbType } from "./db/executor.js";
import type { PgConfig } from "./db/postgres.js";

export type AIProviderName = "openrouter" | "agentrouter";

export interface AppConfig {
  port: number;
  dbType: DbType;
  databasePath: string; // sqlite only
  postgres: PgConfig; // postgres only
  adminToken: string;
  /** Allowed CORS origins; ["*"] = any (no credentials mode). */
  corsOrigins: string[];
  /** Redis connection URL; empty = in-memory slot locks (single process). */
  redisUrl: string;
  /** Seconds an in-progress booking holds its slot before auto-release. */
  slotHoldTtlSeconds: number;
  ai: {
    enabled: boolean;
    provider: AIProviderName;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
}

export function loadConfig(): AppConfig {
  const rawDbType = (process.env.DB_TYPE ?? "sqlite").toLowerCase();
  const dbType: DbType = rawDbType === "postgres" || rawDbType === "postgresql" ? "postgres" : "sqlite";
  const rawProvider = (process.env.AI_PROVIDER ?? "openrouter").toLowerCase();
  const provider: AIProviderName = rawProvider === "agentrouter" ? "agentrouter" : "openrouter";

  const ai =
    provider === "agentrouter"
      ? {
          apiKey: process.env.AGENTROUTER_API_KEY ?? "",
          model: process.env.AGENTROUTER_MODEL ?? "claude-opus-4-8",
          baseUrl: process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org/v1",
        }
      : {
          apiKey: process.env.OPENROUTER_API_KEY ?? "",
          model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5",
          baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
        };

  return {
    port: Number(process.env.PORT ?? 3000),
    dbType,
    databasePath: process.env.DATABASE_PATH ?? "data/clinic.db",
    postgres: {
      connectionString: process.env.DATABASE_URL || undefined,
      host: process.env.PGHOST ?? "localhost",
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "postgres",
      password: process.env.PGPASSWORD ?? "postgres",
      database: process.env.PGDATABASE ?? "clinic",
      ssl: (process.env.PGSSL ?? "").toLowerCase() === "true",
    },
    adminToken: process.env.ADMIN_TOKEN ?? "",
    corsOrigins: (process.env.CORS_ORIGINS ?? "*")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, "")) // origins never carry a trailing slash
      .filter((s) => s.length > 0),
    redisUrl: process.env.REDIS_URL ?? "",
    slotHoldTtlSeconds: Number(process.env.SLOT_HOLD_TTL_SECONDS ?? 300),
    ai: {
      enabled: ai.apiKey.length > 0,
      provider,
      ...ai,
    },
  };
}
