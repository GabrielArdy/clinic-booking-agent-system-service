import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/types.js";
import { logger } from "../logging/logger.js";
import type { ConversationRouter } from "../conversation/router.js";
import type { BookingService } from "../services/booking-service.js";
import type { Repositories } from "../repositories/ports.js";
import { adminRouter } from "./admin.js";
import { cmsRouter } from "./cms.js";

const chatSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().max(2000).default(""),
});

const cancelSchema = z.object({
  reference: z.string().min(4).max(20),
  phone: z.string().min(6).max(30),
});

const DOMAIN_STATUS: Record<DomainError["code"], number> = {
  NOT_FOUND: 404,
  SLOT_TAKEN: 409,
  INVALID_INPUT: 400,
  PHONE_MISMATCH: 403,
  ALREADY_CANCELLED: 409,
};

export function createApp(params: {
  config: AppConfig;
  conversation: ConversationRouter;
  booking: BookingService;
  repos: Repositories;
}): express.Express {
  const { config, conversation, booking, repos } = params;
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  // Minimal fixed-window rate limit for the public chat endpoint.
  const hits = new Map<string, { count: number; windowStart: number }>();
  app.use("/api/chat", (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > 60_000) {
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > 60) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/chat", async (req, res, next) => {
    try {
      const input = chatSchema.parse(req.body);
      const turn = await conversation.handle(input.sessionId, input.message);
      res.json(turn);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/chat/:sessionId/history", async (req, res, next) => {
    try {
      res.json({ messages: await conversation.getHistory(req.params.sessionId) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/booking/cancel", async (req, res, next) => {
    try {
      const input = cancelSchema.parse(req.body);
      const booking_ = await booking.cancelBooking(input.reference, input.phone);
      res.json({ reference: booking_.reference, status: booking_.status });
    } catch (err) {
      next(err);
    }
  });

  app.use("/api/admin", adminRouter(config, booking, repos));
  app.use("/api/cms", cmsRouter(config, repos));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: err.issues });
      return;
    }
    if (err instanceof DomainError) {
      res.status(DOMAIN_STATUS[err.code]).json({ error: err.message, code: err.code });
      return;
    }
    logger.error("unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
