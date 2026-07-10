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

  // 30-min slots -> capacity 2 per slot (floor(30 / 15)).
  it("creates a booking and counts it against slot capacity", async () => {
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
    const slot = (await service.getAvailableSlots(1, MONDAY)).find((s) => s.startTime === "09:00");
    expect(slot).toMatchObject({ capacity: 2, bookedCount: 1, available: true });
  });

  it("flags the slot as full at capacity and rejects further bookings", async () => {
    const service = bookingService(await testDb());
    const input = {
      doctorId: 1,
      date: MONDAY,
      startTime: "09:30",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    };
    await service.createBooking(input);
    await service.createBooking({ ...input, patientName: "John Roe", patientPhone: "081298765432" });

    const slot = (await service.getAvailableSlots(1, MONDAY)).find((s) => s.startTime === "09:30");
    expect(slot).toMatchObject({ capacity: 2, bookedCount: 2, available: false });

    try {
      await service.createBooking({ ...input, patientPhone: "081211112222" });
      expect.unreachable("third booking must be rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("SLOT_TAKEN");
    }
  });

  it("frees a seat again after cancellation", async () => {
    const service = bookingService(await testDb());
    const input = {
      doctorId: 1,
      date: MONDAY,
      startTime: "10:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    };
    const first = await service.createBooking(input);
    await service.createBooking({ ...input, patientName: "John Roe", patientPhone: "081298765432" });

    // Cancel the FIRST booking: seat 0 frees while seat 1 stays active,
    // so rebooking must reuse the gap without colliding.
    const cancelled = await service.cancelBooking(first.booking.reference, "081234567890");
    expect(cancelled.status).toBe("cancelled");

    let slot = (await service.getAvailableSlots(1, MONDAY)).find((s) => s.startTime === "10:00");
    expect(slot).toMatchObject({ bookedCount: 1, available: true });

    await service.createBooking({ ...input, patientName: "Third P.", patientPhone: "081233334444" });
    slot = (await service.getAvailableSlots(1, MONDAY)).find((s) => s.startTime === "10:00");
    expect(slot).toMatchObject({ bookedCount: 2, available: false });
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

  it("rejects bookings made less than 6 hours before the slot", async () => {
    // Clock fixed at 05:00 on MONDAY: the 09:00 slot is only 4h away.
    const service = bookingService(await testDb(), () => new Date(`${MONDAY}T05:00:00`));
    try {
      await service.createBooking({
        doctorId: 1,
        date: MONDAY,
        startTime: "09:00",
        patientName: "Jane Doe",
        patientPhone: "081234567890",
      });
      expect.unreachable("booking inside the 6h lead must be rejected");
    } catch (err) {
      expect((err as DomainError).code).toBe("TOO_LATE_TO_BOOK");
    }
  });

  it("flags slots inside the 6h lead as lead_time unavailable", async () => {
    // 05:00 + 6h = 11:00 cutoff: 09:00-10:30 closed, 11:00+ still bookable.
    const service = bookingService(await testDb(), () => new Date(`${MONDAY}T05:00:00`));
    const slots = await service.getAvailableSlots(1, MONDAY);
    const closed = slots.filter((s) => s.unavailableReason === "lead_time");
    expect(closed.map((s) => s.startTime)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(slots.find((s) => s.startTime === "11:00")?.available).toBe(true);
  });

  it("blocks cancellation within 2 hours of the appointment", async () => {
    const db = await testDb();
    // Booked well in advance...
    const early = bookingService(db, () => new Date(`${MONDAY}T00:00:00`));
    const result = await early.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    // ...but cancelled 1h before the appointment.
    const late = bookingService(db, () => new Date(`${MONDAY}T08:00:00`));
    try {
      await late.cancelBooking(result.booking.reference, "081234567890");
      expect.unreachable("cancellation inside the 2h cutoff must be rejected");
    } catch (err) {
      expect((err as DomainError).code).toBe("TOO_LATE_TO_CANCEL");
    }
    // 3h before is still fine.
    const ok = bookingService(db, () => new Date(`${MONDAY}T06:00:00`));
    const cancelled = await ok.cancelBooking(result.booking.reference, "081234567890");
    expect(cancelled.status).toBe("cancelled");
  });

  it("looks up a booking by reference and phone with cancellability", async () => {
    const db = await testDb();
    const service = bookingService(db, () => new Date(`${MONDAY}T00:00:00`));
    const result = await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });

    const lookup = await service.findBookingForPatient(result.booking.reference, "081234567890");
    expect(lookup.booking.reference).toBe(result.booking.reference);
    expect(lookup.doctor.id).toBe(1);
    expect(lookup.canCancel).toBe(true);

    // Inside the 2h cutoff the same booking is no longer cancellable.
    const late = bookingService(db, () => new Date(`${MONDAY}T08:00:00`));
    const lateLookup = await late.findBookingForPatient(result.booking.reference, "081234567890");
    expect(lateLookup.canCancel).toBe(false);

    await expect(
      service.findBookingForPatient(result.booking.reference, "081298765432"),
    ).rejects.toThrowError(/does not match/);
  });
});
