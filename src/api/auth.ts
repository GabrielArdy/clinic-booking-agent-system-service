import { Router, type Request } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { AuthService } from "../services/auth-service.js";
import { authenticate, currentUser, type AuthedRequest } from "./guard.js";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

function bearerToken(req: Request): string {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function authRouter(config: AppConfig, auth: AuthService): Router {
  const router = Router();

  router.post("/login", async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      res.json(await auth.login(input.email, input.password));
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", authenticate(config, auth), async (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (token) await auth.logout(token);
      res.json({ loggedOut: true });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", authenticate(config, auth), (req, res, next) => {
    try {
      // Legacy x-admin-token has no user profile; /me requires a real login.
      if ((req as AuthedRequest).legacyAdmin) {
        res.json({ user: null, legacyAdmin: true });
        return;
      }
      res.json({ user: currentUser(req) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
