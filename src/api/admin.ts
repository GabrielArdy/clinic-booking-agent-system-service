import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { BookingService } from "../services/booking-service.js";
import type { Repositories } from "../repositories/ports.js";

const createDoctorSchema = z.object({
  fullName: z.string().min(2).max(100),
  specialtyId: z.number().int().positive(),
  photoUrl: z.string().url().max(500).nullable().default(null),
});

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const createRuleSchema = z.object({
  doctorId: z.number().int().positive(),
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(timePattern),
  endTime: z.string().regex(timePattern),
  slotMinutes: z.number().int().min(5).max(240).default(30),
});

const createExceptionSchema = z.object({
  doctorId: z.number().int().positive(),
  date: z.string().regex(datePattern),
  startTime: z.string().regex(timePattern).nullable().default(null),
  endTime: z.string().regex(timePattern).nullable().default(null),
  reason: z.string().max(200).nullable().default(null),
});

export function adminRouter(config: AppConfig, booking: BookingService, repos: Repositories): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!config.adminToken || req.header("x-admin-token") !== config.adminToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  router.get("/doctors", async (_req, res, next) => {
    try {
      res.json({ doctors: await repos.doctors.listAll() });
    } catch (err) {
      next(err);
    }
  });

  router.post("/doctors", async (req, res, next) => {
    try {
      const input = createDoctorSchema.parse(req.body);
      const doctor = await repos.doctors.create({
        fullName: input.fullName,
        specialtyId: input.specialtyId,
        photoUrl: input.photoUrl,
      });
      res.status(201).json({ doctor });
    } catch (err) {
      next(err);
    }
  });

  router.get("/schedules", async (req, res, next) => {
    try {
      const doctorId = z.coerce.number().int().positive().parse(req.query.doctorId);
      res.json({ rules: await repos.schedules.rulesForDoctor(doctorId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/schedules", async (req, res, next) => {
    try {
      const input = createRuleSchema.parse(req.body);
      const id = await repos.schedules.createRule(input);
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  });

  router.post("/schedule-exceptions", async (req, res, next) => {
    try {
      const input = createExceptionSchema.parse(req.body);
      const id = await repos.schedules.createException(input);
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  });

  router.get("/bookings", async (req, res, next) => {
    try {
      const doctorId = z.coerce.number().int().positive().parse(req.query.doctorId);
      const date = z.string().regex(datePattern).parse(req.query.date);
      res.json({ bookings: await booking.listBookings(doctorId, date) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
