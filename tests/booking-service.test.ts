import { describe, expect, it } from "vitest";
import { testDb, nextDateForWeekday } from "./helpers.js";
import { BookingService } from "../src/services/booking-service.js";
import { DomainError } from "../src/domain/types.js";

// Dr. Amanda Putri (doctor 1, General Medicine): Mon-Fri 09:00-12:00, 30 min.
const MONDAY = nextDateForWeekday(1);

describe("BookingService", () => {
  it("computes available slots for a scheduled day", () => {
    const service = new BookingService(testDb());
    const slots = service.getAvailableSlots(1, MONDAY);
    expect(slots.length).toBe(6);
    expect(slots[0]?.startTime).toBe("09:00");
  });

  it("returns no slots on an unscheduled day", () => {
    const service = new BookingService(testDb());
    const sunday = nextDateForWeekday(0);
    expect(service.getAvailableSlots(1, sunday)).toEqual([]);
  });

  it("creates a booking and removes the slot", () => {
    const service = new BookingService(testDb());
    const result = service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    expect(result.booking.reference).toMatch(/^BK-[A-Z2-9]{6}$/);
    expect(result.patient.phone).toBe("6281234567890");
    const slots = service.getAvailableSlots(1, MONDAY);
    expect(slots.find((s) => s.startTime === "09:00")).toBeUndefined();
  });

  it("prevents double-booking the same slot", () => {
    const service = new BookingService(testDb());
    const input = {
      doctorId: 1,
      date: MONDAY,
      startTime: "09:30",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    };
    service.createBooking(input);
    expect(() =>
      service.createBooking({ ...input, patientName: "John Roe", patientPhone: "081298765432" }),
    ).toThrowError(DomainError);
    try {
      service.createBooking({ ...input, patientPhone: "081298765432" });
    } catch (err) {
      expect((err as DomainError).code).toBe("SLOT_TAKEN");
    }
  });

  it("frees the slot again after cancellation", () => {
    const service = new BookingService(testDb());
    const result = service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "10:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    const cancelled = service.cancelBooking(result.booking.reference, "081234567890");
    expect(cancelled.status).toBe("cancelled");
    const slots = service.getAvailableSlots(1, MONDAY);
    expect(slots.find((s) => s.startTime === "10:00")).toBeDefined();
  });

  it("rejects cancellation with a mismatched phone", () => {
    const service = new BookingService(testDb());
    const result = service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "10:30",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    expect(() => service.cancelBooking(result.booking.reference, "081298765432")).toThrowError(
      /does not match/,
    );
  });

  it("rejects cancellation of an unknown reference", () => {
    const service = new BookingService(testDb());
    expect(() => service.cancelBooking("BK-ZZZZZZ", "081234567890")).toThrowError(/not found/);
  });

  it("deduplicates patients by normalized phone", () => {
    const service = new BookingService(testDb());
    const a = service.createOrFindPatient("Jane Doe", "081234567890");
    const b = service.createOrFindPatient("Jane D.", "+62 812-3456-7890");
    expect(b.id).toBe(a.id);
  });
});
