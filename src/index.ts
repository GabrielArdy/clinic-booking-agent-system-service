import { loadConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./logging/logger.js";
import { buildRepositories } from "./repositories/factory.js";
import { BookingService } from "./services/booking-service.js";
import { ConversationRouter } from "./conversation/router.js";
import { DisabledAIProvider, type AIProviderAdapter } from "./ai/provider.js";
import { OpenRouterAdapter } from "./ai/openrouter-adapter.js";
import { AgentRouterAdapter } from "./ai/agentrouter-adapter.js";
import { createApp } from "./api/app.js";

const config = loadConfig();
const db = openDatabase(config);
await runMigrations(db);

const { repos, makeRepos } = buildRepositories(db);
const booking = new BookingService(db, makeRepos);

function buildAI(): AIProviderAdapter {
  if (!config.ai.enabled) return new DisabledAIProvider();
  const opts = {
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    baseUrl: config.ai.baseUrl,
  };
  return config.ai.provider === "agentrouter"
    ? new AgentRouterAdapter(opts)
    : new OpenRouterAdapter(opts);
}
const ai = buildAI();
const conversation = new ConversationRouter(booking, repos.sessions, ai);

const app = createApp({ config, conversation, booking, repos });

const server = app.listen(config.port, () => {
  logger.info("server started", {
    port: config.port,
    dbType: config.dbType,
    aiEnabled: config.ai.enabled,
    aiProvider: config.ai.enabled ? config.ai.provider : "none",
  });
});

function shutdown(): void {
  logger.info("shutting down");
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
