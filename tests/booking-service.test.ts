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

  it("marks a slot as held for others while a session holds the last seat", async () => {
    const db = await testDb();
    const service = bookingService(db);
    // Capacity 2 at 09:00: one real booking + one hold by session-A.
    await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    await service.holdSlot(1, MONDAY, "09:00", "session-A");

    const forOthers = (await service.getAvailableSlots(1, MONDAY, "session-B")).find(
      (s) => s.startTime === "09:00",
    );
    expect(forOthers).toMatchObject({ available: false, unavailableReason: "held" });

    // The holder's own hold never blocks itself.
    const forHolder = (await service.getAvailableSlots(1, MONDAY, "session-A")).find(
      (s) => s.startTime === "09:00",
    );
    expect(forHolder?.available).toBe(true);

    // Booking the held seat as someone else fails; as the holder it succeeds.
    await expect(
      service.createBooking({
        doctorId: 1,
        date: MONDAY,
        startTime: "09:00",
        patientName: "John Roe",
        patientPhone: "081298765432",
        holderId: "session-B",
      }),
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });

    await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Holder Patient",
      patientPhone: "081211112222",
      holderId: "session-A",
    });
    // Success released the hold; the slot is now genuinely full.
    const after = (await service.getAvailableSlots(1, MONDAY, "session-B")).find(
      (s) => s.startTime === "09:00",
    );
    expect(after).toMatchObject({ available: false, unavailableReason: "full" });
  });

  it("rejects holding a slot whose seats are all held or booked", async () => {
    const service = bookingService(await testDb());
    await service.holdSlot(1, MONDAY, "09:00", "session-A");
    await service.holdSlot(1, MONDAY, "09:00", "session-B");
    await expect(service.holdSlot(1, MONDAY, "09:00", "session-C")).rejects.toMatchObject({
      code: "SLOT_TAKEN",
    });
    // Release frees a seat for the next session.
    await service.releaseHold(1, MONDAY, "09:00", "session-A");
    await expect(service.holdSlot(1, MONDAY, "09:00", "session-C")).resolves.toBeUndefined();
  });

  it("lists appointments with patient info and per-day summaries", async () => {
    const db = await testDb();
    const service = bookingService(db);
    const first = await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:30",
      patientName: "John Roe",
      patientPhone: "081298765432",
    });
    await service.cancelBooking(first.booking.reference, "081234567890");

    const result = await service.listAppointments(1, MONDAY, MONDAY);
    expect(result.doctor.id).toBe(1);
    expect(result.appointments.map((a) => a.startTime)).toEqual(["09:00", "09:30"]);
    expect(result.appointments[0]).toMatchObject({
      status: "cancelled",
      patient: { fullName: "Jane Doe", phone: "6281234567890" },
    });
    expect(result.exceptions).toEqual([]);
    expect(result.days).toEqual([
      { date: MONDAY, total: 2, active: 1, cancelled: 1, exceptions: 0, blocked: false },
    ]);
  });

  it("aggregates schedule exceptions into the planner response", async () => {
    const db = await testDb();
    const service = bookingService(db);
    const repos = testRepos(db);
    const TUESDAY = nextDateForWeekday(2);
    // Partial block on Monday, whole day off on Tuesday.
    await repos.schedules.createException({
      doctorId: 1,
      date: MONDAY,
      startTime: "11:00",
      endTime: "12:00",
      reason: "meeting",
    });
    await repos.schedules.createException({
      doctorId: 1,
      date: TUESDAY,
      startTime: null,
      endTime: null,
      reason: "leave",
    });
    await service.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });

    const fromTo = [MONDAY, TUESDAY].sort() as [string, string];
    const result = await service.listAppointments(1, fromTo[0], fromTo[1]);
    expect(result.exceptions).toHaveLength(2);
    expect(result.exceptions.map((e) => e.reason).sort()).toEqual(["leave", "meeting"]);

    const monday = result.days.find((d) => d.date === MONDAY);
    expect(monday).toMatchObject({ total: 1, active: 1, exceptions: 1, blocked: false });
    // Exception-only date still appears in days, flagged blocked.
    const tuesday = result.days.find((d) => d.date === TUESDAY);
    expect(tuesday).toMatchObject({ total: 0, active: 0, exceptions: 1, blocked: true });
  });

  it("validates the appointment range", async () => {
    const service = bookingService(await testDb());
    await expect(service.listAppointments(1, "2026-07-20", "2026-07-10")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(service.listAppointments(1, "2026-01-01", "2026-12-31")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(service.listAppointments(999, MONDAY, MONDAY)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Empty range on a valid doctor returns empty collections.
    const empty = await service.listAppointments(1, "2026-01-01", "2026-01-02");
    expect(empty.appointments).toEqual([]);
    expect(empty.days).toEqual([]);
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
