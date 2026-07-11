import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppConfig } from "../config.js";
import { DomainError, type AuthUser } from "../domain/types.js";
import type { AuthService } from "../services/auth-service.js";

/** Request augmented by `authenticate`. */
export interface AuthedRequest extends Request {
  authUser?: AuthUser;
  /** true = legacy x-admin-token used; passes every role check. */
  legacyAdmin?: boolean;
}

/**
 * Authentication middleware: accepts `Authorization: Bearer <token>` (RBAC)
 * or the legacy `x-admin-token` header (full access, kept for the transition
 * period). 401 when neither is valid.
 */
export function authenticate(config: AppConfig, auth: AuthService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const r = req as AuthedRequest;
      const legacy = req.header("x-admin-token");
      if (legacy && config.adminToken && legacy === config.adminToken) {
        r.legacyAdmin = true;
        return next();
      }
      const header = req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const user = await auth.authenticate(token);
      if (!user) throw new DomainError("UNAUTHORIZED", "Missing or invalid token");
      r.authUser = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Role check (any-of). Must run after `authenticate`. */
export function requireRoles(...roleCodes: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = req as AuthedRequest;
    if (r.legacyAdmin) return next();
    const roles = r.authUser?.roles ?? [];
    if (roleCodes.length > 0 && !roleCodes.some((code) => roles.includes(code))) {
      return next(new DomainError("FORBIDDEN", "Insufficient role"));
    }
    next();
  };
}

/** Authenticated user; throws when the route is hit via the legacy token. */
export function currentUser(req: Request): AuthUser {
  const r = req as AuthedRequest;
  if (!r.authUser) {
    throw new DomainError("UNAUTHORIZED", "This endpoint requires a user login (Bearer token)");
  }
  return r.authUser;
}
