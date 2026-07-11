import { Router, type Request, type Router as RouterT } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/types.js";
import type { Repositories } from "../repositories/ports.js";
import { ROLES, type AuthService } from "../services/auth-service.js";
import type { BookingService } from "../services/booking-service.js";
import { authenticate, currentUser, requireRoles } from "./guard.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const rangeSchema = z.object({
  from: z.string().regex(datePattern),
  to: z.string().regex(datePattern),
});

const exceptionCreate = z.object({
  date: z.string().regex(datePattern),
  startTime: z.string().regex(timePattern).nullable().default(null),
  endTime: z.string().regex(timePattern).nullable().default(null),
  reason: z.string().max(200).nullable().default(null),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The logged-in user's linked doctor id; doctor accounts must have one. */
function ownDoctorId(req: Request): number {
  const user = currentUser(req);
  if (user.doctorId === null) {
    throw new DomainError("FORBIDDEN", "Account is not linked to a doctor");
  }
  return user.doctorId;
}

/**
 * Doctor console. Everything is scoped to the doctor linked to the logged-in
 * account — no doctorId parameter is accepted from the client.
 */
export function doctorRouter(
  config: AppConfig,
  auth: AuthService,
  booking: BookingService,
  repos: Repositories,
): RouterT {
  const router = Router();
  router.use(authenticate(config, auth));

  // Dashboard / schedule page: planner feed (appointments + exceptions + days).
  router.get("/schedule", requireRoles(ROLES.DOC_DASHBOARD), async (req, res, next) => {
    try {
      const { from, to } = rangeSchema.parse(req.query);
      res.json(await booking.listAppointments(ownDoctorId(req), from, to));
    } catch (err) {
      next(err);
    }
  });

  // Today's shift info for the dashboard header.
  router.get("/shift-today", requireRoles(ROLES.DOC_DASHBOARD), async (req, res, next) => {
    try {
      const doctorId = ownDoctorId(req);
      const date = today();
      const [assignments, shifts] = await Promise.all([
        repos.shifts.listAssignments(date),
        repos.shifts.listShifts(),
      ]);
      const shiftById = new Map(shifts.map((s) => [s.id, s]));
      const own = assignments
        .filter((a) => a.doctorId === doctorId)
        .map((a) => ({ assignment: a, shift: shiftById.get(a.shiftId) ?? null }));
      res.json({ date, shifts: own });
    } catch (err) {
      next(err);
    }
  });

  // Exception (blocking time) page — own schedule only.
  router.get("/exceptions", requireRoles(ROLES.DOC_EXCEPTION), async (req, res, next) => {
    try {
      const { from, to } = rangeSchema.parse(req.query);
      res.json({
        exceptions: await repos.schedules.exceptionsForDoctorRange(ownDoctorId(req), from, to),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/exceptions", requireRoles(ROLES.DOC_EXCEPTION), async (req, res, next) => {
    try {
      const input = exceptionCreate.parse(req.body);
      const id = await repos.schedules.createException({
        doctorId: ownDoctorId(req),
        ...input,
      });
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  });

  // Appointment list (same planner feed shape) + per-appointment detail.
  router.get("/appointments", requireRoles(ROLES.DOC_APPOINTMENT), async (req, res, next) => {
    try {
      const { from, to } = rangeSchema.parse(req.query);
      res.json(await booking.listAppointments(ownDoctorId(req), from, to));
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/appointments/:reference",
    requireRoles(ROLES.DOC_APPOINTMENT),
    async (req, res, next) => {
      try {
        const doctorId = ownDoctorId(req);
        const reference = z.string().min(4).max(20).parse(req.params.reference);
        const bookingRow = await repos.bookings.findByReference(reference.toUpperCase());
        if (!bookingRow || bookingRow.doctorId !== doctorId) {
          throw new DomainError("NOT_FOUND", "Appointment not found");
        }
        const patient = await repos.patients.findById(bookingRow.patientId);
        res.json({ appointment: bookingRow, patient });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
