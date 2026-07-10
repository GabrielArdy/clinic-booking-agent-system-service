import { describe, expect, it } from "vitest";
import { bookingService, testDb, testRepos, nextDateForWeekday } from "./helpers.js";
import { DomainError } from "../src/domain/types.js";

// Dr. Amanda Putri (doctor 1, General Medicine): Mon-Fri 09:00-12:00, 30 min.
const MONDAY = nextDateForWeekday(1);

describe("BookingService", () => {
  it("computes available slots for a scheduled day", async () => {
    const service = bookingService(await testDb());
    const slots = await service.getAvailableSlots(1, MONDAY);
    expect(slots.length).toBe(6);
    expect(slots[0]?.startTime).toBe("09:00");
  });

  it("returns no slots on an unscheduled day", async () => {
    const service = bookingService(await testDb());
    const sunday = nextDateForWeekday(0);
    expect(await service.getAvailableSlots(1, sunday)).toEqual([]);
  });

  it("creates a booking and removes the slot", async () => {
    const service = bookingService(await testDb());
    const result = await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    expect(result.booking.reference).toMatch(/^BK-[A-Z2-9]{6}$/);
    expect(result.patient.phone).toBe("6281234567890");
    const slots = await service.getAvailableSlots(1, MONDAY);
    expect(slots.find((s) => s.startTime === "09:00")).toBeUndefined();
  });

  it("prevents double-booking the same slot", async () => {
    const service = bookingService(await testDb());
    const input = {
      doctorId: 1,
      date: MONDAY,
      startTime: "09:30",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    };
    await service.createBooking(input);
    await expect(
      service.createBooking({ ...input, patientName: "John Roe", patientPhone: "081298765432" }),
    ).rejects.toBeInstanceOf(DomainError);
    try {
      await service.createBooking({ ...input, patientPhone: "081298765432" });
    } catch (err) {
      expect((err as DomainError).code).toBe("SLOT_TAKEN");
    }
  });

  it("frees the slot again after cancellation", async () => {
    const service = bookingService(await testDb());
    const result = await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "10:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    const cancelled = await service.cancelBooking(result.booking.reference, "081234567890");
    expect(cancelled.status).toBe("cancelled");
    const slots = await service.getAvailableSlots(1, MONDAY);
    expect(slots.find((s) => s.startTime === "10:00")).toBeDefined();
  });

  it("rejects cancellation with a mismatched phone", async () => {
    const service = bookingService(await testDb());
    const result = await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "10:30",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    await expect(
      service.cancelBooking(result.booking.reference, "081298765432"),
    ).rejects.toThrowError(/does not match/);
  });

  it("rejects cancellation of an unknown reference", async () => {
    const service = bookingService(await testDb());
    await expect(service.cancelBooking("BK-ZZZZZZ", "081234567890")).rejects.toThrowError(
      /not found/,
    );
  });

  it("deduplicates patients by normalized phone", async () => {
    const db = await testDb();
    const service = bookingService(db);
    const repos = testRepos(db);
    const a = await service.createOrFindPatient(repos, "Jane Doe", "081234567890");
    const b = await service.createOrFindPatient(repos, "Jane D.", "+62 812-3456-7890");
    expect(b.id).toBe(a.id);
  });
});
