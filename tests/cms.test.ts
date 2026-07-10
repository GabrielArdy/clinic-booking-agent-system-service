import { describe, expect, it } from "vitest";
import { testDb, testRepos } from "./helpers.js";

describe("CMS: clinic settings (singleton)", () => {
  it("seeds one row and merges partial updates", async () => {
    const repo = testRepos(await testDb()).clinic;
    expect((await repo.get()).name).toBe("Sandbox Clinic");
    const updated = await repo.update({ address: "Jl. Merdeka 1", latitude: -6.2, longitude: 106.8 });
    expect(updated.address).toBe("Jl. Merdeka 1");
    expect(updated.latitude).toBe(-6.2);
    expect(updated.name).toBe("Sandbox Clinic");
  });

  it("round-trips custom extra fields as JSON", async () => {
    const repo = testRepos(await testDb()).clinic;
    await repo.update({ extra: { license: "SIP-123", beds: 12 } });
    expect((await repo.get()).extra).toEqual({ license: "SIP-123", beds: 12 });
  });
});

describe("CMS: theme settings (singleton)", () => {
  it("has defaults and updates color + darkMode", async () => {
    const repo = testRepos(await testDb()).theme;
    expect((await repo.get()).primaryColor).toBe("#2563eb");
    const updated = await repo.update({ primaryColor: "#ff0000", darkMode: true });
    expect(updated.primaryColor).toBe("#ff0000");
    expect(updated.darkMode).toBe(true);
  });
});

describe("CMS: specialty CRUD", () => {
  it("creates, updates, and soft-deletes", async () => {
    const repo = testRepos(await testDb()).specialties;
    const created = await repo.create("Neurology", "Brain & nerves");
    expect(created.description).toBe("Brain & nerves");
    const updated = await repo.update(created.id, { active: false });
    expect(updated?.active).toBe(false);
    expect((await repo.listActive()).find((s) => s.id === created.id)).toBeUndefined();
    expect(await repo.findById(created.id)).not.toBeNull();
  });
});

describe("CMS: doctor management", () => {
  it("creates with extended fields and updates them", async () => {
    const repo = testRepos(await testDb()).doctors;
    const created = await repo.create({
      fullName: "Dr. Test",
      specialtyId: 1,
      email: "t@clinic.test",
      phone: "0811",
      bio: "hello",
    });
    expect(created.email).toBe("t@clinic.test");
    const updated = await repo.update(created.id, { bio: "updated bio" });
    expect(updated?.bio).toBe("updated bio");
    expect(await repo.deactivate(created.id)).toBe(true);
    expect((await repo.findById(created.id))?.active).toBe(false);
  });
});

describe("CMS: staff CRUD", () => {
  it("creates and deactivates staff", async () => {
    const repo = testRepos(await testDb()).staff;
    const created = await repo.create({ fullName: "Reception A", role: "receptionist" });
    expect(created.role).toBe("receptionist");
    expect(created.active).toBe(true);
    expect(await repo.deactivate(created.id)).toBe(true);
    expect((await repo.findById(created.id))?.active).toBe(false);
  });
});

describe("CMS: slot presets (seeded)", () => {
  it("lists seeded presets ordered by minutes", async () => {
    const repo = testRepos(await testDb()).slotPresets;
    const presets = await repo.listAll();
    expect(presets.map((p) => p.minutes)).toEqual([15, 30, 60]);
  });
});

describe("CMS: shifts + assignments", () => {
  it("assigns a seeded shift to a doctor", async () => {
    const shifts = testRepos(await testDb()).shifts;
    const morning = (await shifts.listShifts()).find((s) => s.name === "Morning")!;
    const assignment = await shifts.createAssignment({
      shiftId: morning.id,
      doctorId: 1,
      date: "2026-08-01",
    });
    expect(assignment.doctorId).toBe(1);
    expect(await shifts.listAssignments("2026-08-01")).toHaveLength(1);
  });

  it("rejects an assignment with both doctor and staff (XOR CHECK)", async () => {
    const shifts = testRepos(await testDb()).shifts;
    const morning = (await shifts.listShifts()).find((s) => s.name === "Morning")!;
    await expect(
      shifts.createAssignment({ shiftId: morning.id, doctorId: 1, staffId: 1, date: "2026-08-01" }),
    ).rejects.toThrow();
  });

  it("rejects an assignment with neither doctor nor staff", async () => {
    const shifts = testRepos(await testDb()).shifts;
    const morning = (await shifts.listShifts()).find((s) => s.name === "Morning")!;
    await expect(
      shifts.createAssignment({ shiftId: morning.id, date: "2026-08-01" }),
    ).rejects.toThrow();
  });
});
