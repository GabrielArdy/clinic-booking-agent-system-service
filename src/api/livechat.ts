import { Router, type Router as RouterT } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { LiveChatService } from "../services/live-chat-service.js";
import { ROLES, type AuthService } from "../services/auth-service.js";
import { authenticate, currentUser, requireRoles } from "./guard.js";

const listQuerySchema = z.object({
  status: z.enum(["waiting", "active", "closed"]).optional(),
});

/**
 * Live chat console for staff + admin dashboards. Messages flow over the
 * WebSocket (/ws); this router serves the chat list page, room hydration,
 * and the claim/complete actions. Bearer login required for claim (needs a
 * user identity) — the legacy x-admin-token can only read.
 */
export function liveChatRouter(
  config: AppConfig,
  auth: AuthService,
  chat: LiveChatService,
): RouterT {
  const router = Router();
  router.use(authenticate(config, auth));
  router.use(requireRoles(ROLES.STF_CHAT, ROLES.ADM_DASHBOARD));

  // Chat list page. ?status=waiting|active|closed
  router.get("/sessions", async (req, res, next) => {
    try {
      const q = listQuerySchema.parse(req.query);
      res.json({ sessions: await chat.listSessions(q.status ? { status: q.status } : undefined) });
    } catch (err) {
      next(err);
    }
  });

  // Chat room hydration: session + full message history.
  router.get("/sessions/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const [session, messages] = await Promise.all([chat.getSession(id), chat.messages(id)]);
      res.json({ session, messages });
    } catch (err) {
      next(err);
    }
  });

  // Staff takes the session (409 STAFF_BUSY while handling another one).
  router.post("/sessions/:id/claim", async (req, res, next) => {
    try {
      const user = currentUser(req);
      res.json({ session: await chat.claim(Number(req.params.id), user) });
    } catch (err) {
      next(err);
    }
  });

  // "Complete chat" trigger from the staff side; closes the room for both.
  router.post("/sessions/:id/complete", async (req, res, next) => {
    try {
      currentUser(req); // identity required; legacy token cannot complete
      res.json({ session: await chat.complete(Number(req.params.id), "staff") });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
