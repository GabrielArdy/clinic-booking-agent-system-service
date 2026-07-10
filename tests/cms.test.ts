import { describe, expect, it } from "vitest";
import { testDb } from "./helpers.js";
import { ClinicSettingsRepository } from "../src/repositories/clinic-settings-repository.js";
import { ThemeRepository } from "../src/repositories/theme-repository.js";
import { SpecialtyRepository } from "../src/repositories/specialty-repository.js";
import { DoctorRepository } from "../src/repositories/doctor-repository.js";
import { StaffRepository } from "../src/repositories/staff-repository.js";
import { SlotPresetRepository } from "../src/repositories/slot-preset-repository.js";
import { ShiftRepository } from "../src/repositories/shift-repository.js";

describe("CMS: clinic settings (singleton)", () => {
  it("seeds one row and merges partial updates", () => {
    const repo = new ClinicSettingsRepository(testDb());
    expect(repo.get().name).toBe("Sandbox Clinic");
    const updated = repo.update({ address: "Jl. Merdeka 1", latitude: -6.2, longitude: 106.8 });
    expect(updated.address).toBe("Jl. Merdeka 1");
    expect(updated.latitude).toBe(-6.2);
    // Untouched field retained.
    expect(updated.name).toBe("Sandbox Clinic");
  });

  it("round-trips custom extra fields as JSON", () => {
    const repo = new ClinicSettingsRepository(testDb());
    repo.update({ extra: { license: "SIP-123", beds: 12 } });
    expect(repo.get().extra).toEqual({ license: "SIP-123", beds: 12 });
  });
});

describe("CMS: theme settings (singleton)", () => {
  it("has defaults and updates color + darkMode", () => {
    const repo = new ThemeRepository(testDb());
    expect(repo.get().primaryColor).toBe("#2563eb");
    const updated = repo.update({ primaryColor: "#ff0000", darkMode: true });
    expect(updated.primaryColor).toBe("#ff0000");
    expect(updated.darkMode).toBe(true);
  });
});

describe("CMS: specialty CRUD", () => {
  it("creates, updates, and soft-deletes", () => {
    const repo = new SpecialtyRepository(testDb());
    const created = repo.create("Neurology", "Brain & nerves");
    expect(created.description).toBe("Brain & nerves");
    const updated = repo.update(created.id, { active: false });
    expect(updated?.active).toBe(false);
    // Soft delete keeps the row out of the active list but findById still works.
    expect(repo.listActive().find((s) => s.id === created.id)).toBeUndefined();
    expect(repo.findById(created.id)).not.toBeNull();
  });
});

describe("CMS: doctor management", () => {
  it("creates with extended fields and updates them", () => {
    const repo = new DoctorRepository(testDb());
    const created = repo.create({
      fullName: "Dr. Test",
      specialtyId: 1,
      email: "t@clinic.test",
      phone: "0811",
      bio: "hello",
    });
    expect(created.email).toBe("t@clinic.test");
    const updated = repo.update(created.id, { bio: "updated bio" });
    expect(updated?.bio).toBe("updated bio");
    expect(repo.deactivate(created.id)).toBe(true);
    expect(repo.findById(created.id)?.active).toBe(false);
  });
});

describe("CMS: staff CRUD", () => {
  it("creates and deactivates staff", () => {
    const repo = new StaffRepository(testDb());
    const created = repo.create({ fullName: "Reception A", role: "receptionist" });
    expect(created.role).toBe("receptionist");
    expect(created.active).toBe(true);
    expect(repo.deactivate(created.id)).toBe(true);
    expect(repo.findById(created.id)?.active).toBe(false);
  });
});

describe("CMS: slot presets (seeded)", () => {
  it("lists seeded presets ordered by minutes", () => {
    const repo = new SlotPresetRepository(testDb());
    const presets = repo.listAll();
    expect(presets.map((p) => p.minutes)).toEqual([15, 30, 60]);
  });
});

describe("CMS: shifts + assignments", () => {
  it("assigns a seeded shift to a doctor", () => {
    const db = testDb();
    const shifts = new ShiftRepository(db);
    const morning = shifts.listShifts().find((s) => s.name === "Morning")!;
    const assignment = shifts.createAssignment({
      shiftId: morning.id,
      doctorId: 1,
      date: "2026-08-01",
    });
    expect(assignment.doctorId).toBe(1);
    expect(shifts.listAssignments("2026-08-01")).toHaveLength(1);
  });

  it("rejects an assignment with both doctor and staff (XOR CHECK)", () => {
    const db = testDb();
    const shifts = new ShiftRepository(db);
    const morning = shifts.listShifts().find((s) => s.name === "Morning")!;
    expect(() =>
      shifts.createAssignment({ shiftId: morning.id, doctorId: 1, staffId: 1, date: "2026-08-01" }),
    ).toThrow();
  });

  it("rejects an assignment with neither doctor nor staff", () => {
    const db = testDb();
    const shifts = new ShiftRepository(db);
    const morning = shifts.listShifts().find((s) => s.name === "Morning")!;
    expect(() =>
      shifts.createAssignment({ shiftId: morning.id, date: "2026-08-01" }),
    ).toThrow();
  });
});
