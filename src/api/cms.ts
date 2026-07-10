import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DB } from "../db/connection.js";
import { DomainError } from "../domain/types.js";
import { ClinicSettingsRepository } from "../repositories/clinic-settings-repository.js";
import { ThemeRepository } from "../repositories/theme-repository.js";
import { SpecialtyRepository } from "../repositories/specialty-repository.js";
import { DoctorRepository } from "../repositories/doctor-repository.js";
import { StaffRepository } from "../repositories/staff-repository.js";
import { SlotPresetRepository } from "../repositories/slot-preset-repository.js";
import { ShiftRepository } from "../repositories/shift-repository.js";

const hex = /^#[0-9a-fA-F]{6}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idParam = z.coerce.number().int().positive();

function db(req: Request): DB {
  return req.app.get("db") as DB;
}

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

export function cmsRouter(config: AppConfig): Router {
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
  router.get("/clinic", (req, res) => {
    res.json({ clinic: new ClinicSettingsRepository(db(req)).get() });
  });
  router.put("/clinic", (req, res, next) => {
    try {
      const input = clinicSchema.parse(req.body);
      res.json({ clinic: new ClinicSettingsRepository(db(req)).update(input) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Theme (singleton) ----
  router.get("/theme", (req, res) => {
    res.json({ theme: new ThemeRepository(db(req)).get() });
  });
  router.put("/theme", (req, res, next) => {
    try {
      const input = themeSchema.parse(req.body);
      res.json({ theme: new ThemeRepository(db(req)).update(input) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Specialties ----
  router.get("/specialties", (req, res) => {
    res.json({ specialties: new SpecialtyRepository(db(req)).listAll() });
  });
  router.post("/specialties", (req, res, next) => {
    try {
      const input = specialtyCreate.parse(req.body);
      const specialty = new SpecialtyRepository(db(req)).create(input.name, input.description);
      res.status(201).json({ specialty });
    } catch (err) {
      next(err);
    }
  });
  router.put("/specialties/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = specialtyUpdate.parse(req.body);
      const specialty = new SpecialtyRepository(db(req)).update(id, input);
      if (!specialty) notFound("Specialty");
      res.json({ specialty });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/specialties/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!new SpecialtyRepository(db(req)).deactivate(id)) notFound("Specialty");
      res.json({ id, active: false });
    } catch (err) {
      next(err);
    }
  });

  // ---- Doctors (+ Staff = Doctor and Staff Management) ----
  router.get("/doctors", (req, res) => {
    res.json({ doctors: new DoctorRepository(db(req)).listAll() });
  });
  router.post("/doctors", (req, res, next) => {
    try {
      const input = doctorCreate.parse(req.body);
      const specialties = new SpecialtyRepository(db(req));
      if (!specialties.findById(input.specialtyId)) notFound("Specialty");
      const doctor = new DoctorRepository(db(req)).create(input);
      res.status(201).json({ doctor });
    } catch (err) {
      next(err);
    }
  });
  router.put("/doctors/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = doctorUpdate.parse(req.body);
      const doctor = new DoctorRepository(db(req)).update(id, input);
      if (!doctor) notFound("Doctor");
      res.json({ doctor });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/doctors/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!new DoctorRepository(db(req)).deactivate(id)) notFound("Doctor");
      res.json({ id, active: false });
    } catch (err) {
      next(err);
    }
  });

  // ---- Staff ----
  router.get("/staff", (req, res) => {
    res.json({ staff: new StaffRepository(db(req)).listAll() });
  });
  router.post("/staff", (req, res, next) => {
    try {
      const input = staffCreate.parse(req.body);
      res.status(201).json({ staff: new StaffRepository(db(req)).create(input) });
    } catch (err) {
      next(err);
    }
  });
  router.put("/staff/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = staffUpdate.parse(req.body);
      const staff = new StaffRepository(db(req)).update(id, input);
      if (!staff) notFound("Staff");
      res.json({ staff });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/staff/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!new StaffRepository(db(req)).deactivate(id)) notFound("Staff");
      res.json({ id, active: false });
    } catch (err) {
      next(err);
    }
  });

  // ---- Slot presets (TimeSlot CMS) ----
  router.get("/slot-presets", (req, res) => {
    res.json({ slotPresets: new SlotPresetRepository(db(req)).listAll() });
  });
  router.post("/slot-presets", (req, res, next) => {
    try {
      const input = presetCreate.parse(req.body);
      const preset = new SlotPresetRepository(db(req)).create(input.label, input.minutes);
      res.status(201).json({ slotPreset: preset });
    } catch (err) {
      next(err);
    }
  });
  router.put("/slot-presets/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = presetUpdate.parse(req.body);
      const preset = new SlotPresetRepository(db(req)).update(id, input);
      if (!preset) notFound("Slot preset");
      res.json({ slotPreset: preset });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/slot-presets/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!new SlotPresetRepository(db(req)).delete(id)) notFound("Slot preset");
      res.json({ id, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Shifts + on-duty assignments (Schedule CMS) ----
  router.get("/shifts", (req, res) => {
    res.json({ shifts: new ShiftRepository(db(req)).listShifts() });
  });
  router.post("/shifts", (req, res, next) => {
    try {
      const input = shiftCreate.parse(req.body);
      const shift = new ShiftRepository(db(req)).createShift(
        input.name,
        input.startTime,
        input.endTime,
      );
      res.status(201).json({ shift });
    } catch (err) {
      next(err);
    }
  });
  router.put("/shifts/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = shiftUpdate.parse(req.body);
      const shift = new ShiftRepository(db(req)).updateShift(id, input);
      if (!shift) notFound("Shift");
      res.json({ shift });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/shifts/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!new ShiftRepository(db(req)).deleteShift(id)) notFound("Shift");
      res.json({ id, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  router.get("/shift-assignments", (req, res, next) => {
    try {
      const date = req.query.date
        ? z.string().regex(datePattern).parse(req.query.date)
        : undefined;
      res.json({ assignments: new ShiftRepository(db(req)).listAssignments(date) });
    } catch (err) {
      next(err);
    }
  });
  router.post("/shift-assignments", (req, res, next) => {
    try {
      const input = assignmentCreate.parse(req.body);
      const repo = new ShiftRepository(db(req));
      if (!repo.findShift(input.shiftId)) notFound("Shift");
      if (input.doctorId !== null && !new DoctorRepository(db(req)).findById(input.doctorId)) {
        notFound("Doctor");
      }
      if (input.staffId !== null && !new StaffRepository(db(req)).findById(input.staffId)) {
        notFound("Staff");
      }
      res.status(201).json({ assignment: repo.createAssignment(input) });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/shift-assignments/:id", (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      if (!new ShiftRepository(db(req)).deleteAssignment(id)) notFound("Assignment");
      res.json({ id, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
