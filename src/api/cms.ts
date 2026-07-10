import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/types.js";
import type { Repositories } from "../repositories/ports.js";

const hex = /^#[0-9a-fA-F]{6}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idParam = z.coerce.number().int().positive();

function notFound(entity: string): never {
  throw new DomainError("NOT_FOUND", `${entity} not found`);
}

// ---- validation schemas ----
const clinicSchema = z.object({
  name: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  permissionLetterUrl: z.string().url().max(500).nullable().optional(),
  emblemUrl: z.string().url().max(500).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const themeSchema = z.object({
  primaryColor: z.string().regex(hex).optional(),
  secondaryColor: z.string().regex(hex).optional(),
  accentColor: z.string().regex(hex).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  fontFamily: z.string().max(100).optional(),
  darkMode: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const specialtyCreate = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(1000).nullable().default(null),
});
const specialtyUpdate = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

const doctorCreate = z.object({
  fullName: z.string().min(2).max(100),
  specialtyId: z.number().int().positive(),
  photoUrl: z.string().url().max(500).nullable().default(null),
  email: z.string().email().max(200).nullable().default(null),
  phone: z.string().max(30).nullable().default(null),
  bio: z.string().max(2000).nullable().default(null),
});
const doctorUpdate = z.object({
  fullName: z.string().min(2).max(100).optional(),
  specialtyId: z.number().int().positive().optional(),
  photoUrl: z.string().url().max(500).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

const staffCreate = z.object({
  fullName: z.string().min(2).max(100),
  role: z.string().max(50).default("staff"),
  email: z.string().email().max(200).nullable().default(null),
  phone: z.string().max(30).nullable().default(null),
  photoUrl: z.string().url().max(500).nullable().default(null),
});
const staffUpdate = z.object({
  fullName: z.string().min(2).max(100).optional(),
  role: z.string().max(50).optional(),
  email: z.string().email().max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  photoUrl: z.string().url().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

const presetCreate = z.object({
  label: z.string().min(1).max(50),
  minutes: z.number().int().min(5).max(240),
});
const presetUpdate = z.object({
  label: z.string().min(1).max(50).optional(),
  minutes: z.number().int().min(5).max(240).optional(),
  active: z.boolean().optional(),
});

const shiftCreate = z.object({
  name: z.string().min(1).max(50),
  startTime: z.string().regex(timePattern),
  endTime: z.string().regex(timePattern),
});
const shiftUpdate = z.object({
  name: z.string().min(1).max(50).optional(),
  startTime: z.string().regex(timePattern).optional(),
  endTime: z.string().regex(timePattern).optional(),
  active: z.boolean().optional(),
});

const assignmentCreate = z
  .object({
    shiftId: z.number().int().positive(),
    doctorId: z.number().int().positive().nullable().default(null),
    staffId: z.number().int().positive().nullable().default(null),
    date: z.string().regex(datePattern),
  })
  .refine((v) => (v.doctorId === null) !== (v.staffId === null), {
    message: "Provide exactly one of doctorId or staffId",
  });

export function cmsRouter(config: AppConfig, repos: Repositories): Router {
  const router = Router();

  // Reuses the admin secret, mounted separately at /api/cms.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!config.adminToken || req.header("x-admin-token") !== config.adminToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // ---- Clinic Setting (singleton) ----
  router.get("/clinic", async (_req, res, next) => {
    try {
      res.json({ clinic: await repos.clinic.get() });
    } catch (err) {
      next(err);
    }
  });
  router.put("/clinic", async (req, res, next) => {
    try {
      res.json({ clinic: await repos.clinic.update(clinicSchema.parse(req.body)) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Theme (singleton) ----
  router.get("/theme", async (_req, res, next) => {
    try {
      res.json({ theme: await repos.theme.get() });
    } catch (err) {
      next(err);
    }
  });
  router.put("/theme", async (req, res, next) => {
    try {
      res.json({ theme: await repos.theme.update(themeSchema.parse(req.body)) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Specialties ----
  router.get("/specialties", async (_req, res, next) => {
    try {
      res.json({ specialties: await repos.specialties.listAll() });
    } catch (err) {
      next(err);
    }
  });
  router.post("/specialties", async (req, res, next) => {
    try {
      const input = specialtyCreate.parse(req.body);
      res.status(201).json({ specialty: await repos.specialties.create(input.name, input.description) });
    } catch (err) {
      next(err);
    }
  });
  router.put("/specialties/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const specialty = await repos.specialties.update(id, specialtyUpdate.parse(req.body));
      if (!specialty) notFound("Specialty");
      res.json({ specialty });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/specialties/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!(await repos.specialties.deactivate(id))) notFound("Specialty");
      res.json({ id, active: false });
    } catch (err) {
      next(err);
    }
  });

  // ---- Doctors (Doctor & Staff Management) ----
  router.get("/doctors", async (_req, res, next) => {
    try {
      res.json({ doctors: await repos.doctors.listAll() });
    } catch (err) {
      next(err);
    }
  });
  router.post("/doctors", async (req, res, next) => {
    try {
      const input = doctorCreate.parse(req.body);
      if (!(await repos.specialties.findById(input.specialtyId))) notFound("Specialty");
      res.status(201).json({ doctor: await repos.doctors.create(input) });
    } catch (err) {
      next(err);
    }
  });
  router.put("/doctors/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const doctor = await repos.doctors.update(id, doctorUpdate.parse(req.body));
      if (!doctor) notFound("Doctor");
      res.json({ doctor });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/doctors/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!(await repos.doctors.deactivate(id))) notFound("Doctor");
      res.json({ id, active: false });
    } catch (err) {
      next(err);
    }
  });

  // ---- Staff ----
  router.get("/staff", async (_req, res, next) => {
    try {
      res.json({ staff: await repos.staff.listAll() });
    } catch (err) {
      next(err);
    }
  });
  router.post("/staff", async (req, res, next) => {
    try {
      res.status(201).json({ staff: await repos.staff.create(staffCreate.parse(req.body)) });
    } catch (err) {
      next(err);
    }
  });
  router.put("/staff/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const staff = await repos.staff.update(id, staffUpdate.parse(req.body));
      if (!staff) notFound("Staff");
      res.json({ staff });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/staff/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!(await repos.staff.deactivate(id))) notFound("Staff");
      res.json({ id, active: false });
    } catch (err) {
      next(err);
    }
  });

  // ---- Slot presets (TimeSlot CMS) ----
  router.get("/slot-presets", async (_req, res, next) => {
    try {
      res.json({ slotPresets: await repos.slotPresets.listAll() });
    } catch (err) {
      next(err);
    }
  });
  router.post("/slot-presets", async (req, res, next) => {
    try {
      const input = presetCreate.parse(req.body);
      res.status(201).json({ slotPreset: await repos.slotPresets.create(input.label, input.minutes) });
    } catch (err) {
      next(err);
    }
  });
  router.put("/slot-presets/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const preset = await repos.slotPresets.update(id, presetUpdate.parse(req.body));
      if (!preset) notFound("Slot preset");
      res.json({ slotPreset: preset });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/slot-presets/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!(await repos.slotPresets.delete(id))) notFound("Slot preset");
      res.json({ id, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Shifts + on-duty assignments (Schedule CMS) ----
  router.get("/shifts", async (_req, res, next) => {
    try {
      res.json({ shifts: await repos.shifts.listShifts() });
    } catch (err) {
      next(err);
    }
  });
  router.post("/shifts", async (req, res, next) => {
    try {
      const input = shiftCreate.parse(req.body);
      res.status(201).json({ shift: await repos.shifts.createShift(input.name, input.startTime, input.endTime) });
    } catch (err) {
      next(err);
    }
  });
  router.put("/shifts/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const shift = await repos.shifts.updateShift(id, shiftUpdate.parse(req.body));
      if (!shift) notFound("Shift");
      res.json({ shift });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/shifts/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!(await repos.shifts.deleteShift(id))) notFound("Shift");
      res.json({ id, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  router.get("/shift-assignments", async (req, res, next) => {
    try {
      const date = req.query.date ? z.string().regex(datePattern).parse(req.query.date) : undefined;
      res.json({ assignments: await repos.shifts.listAssignments(date) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/shift-assignments", async (req, res, next) => {
    try {
      const input = assignmentCreate.parse(req.body);
      if (!(await repos.shifts.findShift(input.shiftId))) notFound("Shift");
      if (input.doctorId !== null && !(await repos.doctors.findById(input.doctorId))) {
        notFound("Doctor");
      }
      if (input.staffId !== null && !(await repos.staff.findById(input.staffId))) {
        notFound("Staff");
      }
      res.status(201).json({ assignment: await repos.shifts.createAssignment(input) });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/shift-assignments/:id", async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!(await repos.shifts.deleteAssignment(id))) notFound("Assignment");
      res.json({ id, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
