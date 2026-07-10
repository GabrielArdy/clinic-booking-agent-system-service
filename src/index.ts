import { loadConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./logging/logger.js";
import { BookingService } from "./services/booking-service.js";
import { SessionRepository } from "./repositories/session-repository.js";
import { ConversationRouter } from "./conversation/router.js";
import { DisabledAIProvider, type AIProviderAdapter } from "./ai/provider.js";
import { OpenRouterAdapter } from "./ai/openrouter-adapter.js";
import { AgentRouterAdapter } from "./ai/agentrouter-adapter.js";
import { createApp } from "./api/app.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
runMigrations(db);

const booking = new BookingService(db);
const sessions = new SessionRepository(db);
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
const conversation = new ConversationRouter(booking, sessions, ai);

const app = createApp({ config, conversation, booking });
app.set("db", db);

const server = app.listen(config.port, () => {
  logger.info("server started", {
    port: config.port,
    database: config.databasePath,
    aiEnabled: config.ai.enabled,
    aiProvider: config.ai.enabled ? config.ai.provider : "none",
  });
});

function shutdown(): void {
  logger.info("shutting down");
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
