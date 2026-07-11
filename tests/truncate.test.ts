import { describe, expect, it } from "vitest";
import { testDb, bookingService, nextDateForWeekday } from "./helpers.js";
import { truncateAll } from "../src/db/truncate.js";
import { seed } from "../src/db/seed.js";

describe("truncateAll", () => {
  it("empties every table but keeps schema and migration history", async () => {
    const db = await testDb();
    // Some transactional data on top of the seed.
    await bookingService(db).createBooking({
      doctorId: 1,
      date: nextDateForWeekday(1),
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });

    const tables = await truncateAll(db);
    expect(tables.length).toBeGreaterThan(10);
    expect(tables).not.toContain("schema_migrations");

    for (const t of ["doctors", "bookings", "patients", "users", "master_groups", "audit_events"]) {
      const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
      expect(row?.n, t).toBe(0);
    }
    // Singleton settings rows restored (migration-created, seed relies on them).
    const clinic = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM clinic_settings");
    expect(clinic?.n).toBe(1);
    // Migration history intact -> migrations don't re-run.
    const mig = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM schema_migrations");
    expect(mig?.n).toBeGreaterThan(0);

    // Fresh seed works on the emptied schema (ids restart at 1).
    await seed(db);
    const doc = await db.get<{ id: number }>("SELECT MIN(id) AS id FROM doctors");
    expect(doc?.id).toBe(1);
    await db.close();
  });
});
