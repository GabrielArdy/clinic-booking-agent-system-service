import { Router, type Request, type Router as RouterT } from "express";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/types.js";
import type { Repositories } from "../repositories/ports.js";
import { ROLES, type AuthService } from "../services/auth-service.js";
import { authenticate, currentUser, requireRoles } from "./guard.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ownStaffId(req: Request): number {
  const user = currentUser(req);
  if (user.staffId === null) {
    throw new DomainError("FORBIDDEN", "Account is not linked to a staff member");
  }
  return user.staffId;
}

/** Staff console: today's shift info (more staff features to come). */
export function staffRouter(
  config: AppConfig,
  auth: AuthService,
  repos: Repositories,
): RouterT {
  const router = Router();
  router.use(authenticate(config, auth));

  router.get("/shift-today", requireRoles(ROLES.STF_DASHBOARD), async (req, res, next) => {
    try {
      const staffId = ownStaffId(req);
      const date = today();
      const [assignments, shifts] = await Promise.all([
        repos.shifts.listAssignments(date),
        repos.shifts.listShifts(),
      ]);
      const shiftById = new Map(shifts.map((s) => [s.id, s]));
      const own = assignments
        .filter((a) => a.staffId === staffId)
        .map((a) => ({ assignment: a, shift: shiftById.get(a.shiftId) ?? null }));
      res.json({ date, shifts: own });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
