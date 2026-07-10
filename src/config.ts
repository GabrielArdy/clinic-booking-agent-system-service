import "dotenv/config";

export type AIProviderName = "openrouter" | "agentrouter";

export interface AppConfig {
  port: number;
  databasePath: string;
  adminToken: string;
  ai: {
    enabled: boolean;
    provider: AIProviderName;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
}

export function loadConfig(): AppConfig {
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
    databasePath: process.env.DATABASE_PATH ?? "data/clinic.db",
    adminToken: process.env.ADMIN_TOKEN ?? "",
    ai: {
      enabled: ai.apiKey.length > 0,
      provider,
      ...ai,
    },
  };
}
