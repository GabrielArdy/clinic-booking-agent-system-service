import "dotenv/config";

export interface AppConfig {
  port: number;
  databasePath: string;
  adminToken: string;
  ai: {
    enabled: boolean;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  return {
    port: Number(process.env.PORT ?? 3000),
    databasePath: process.env.DATABASE_PATH ?? "data/clinic.db",
    adminToken: process.env.ADMIN_TOKEN ?? "",
    ai: {
      enabled: apiKey.length > 0,
      apiKey,
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5",
      baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    },
  };
}
