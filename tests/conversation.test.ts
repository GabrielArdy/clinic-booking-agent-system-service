import { describe, expect, it } from "vitest";
import { bookingService, testDb, testRepos, nextDateForWeekday } from "./helpers.js";
import { ConversationRouter } from "../src/conversation/router.js";
import { DisabledAIProvider } from "../src/ai/provider.js";
import type { SlotLock } from "../src/services/slot-lock.js";

async function setup(slotLock?: SlotLock) {
  const db = await testDb();
  const booking = bookingService(db, undefined, slotLock);
  const sessions = testRepos(db).sessions;
  const router = new ConversationRouter(booking, sessions, new DisabledAIProvider());
  return { db, booking, sessions, router };
}

const MONDAY = nextDateForWeekday(1);

describe("ConversationRouter", () => {
  it("completes a full booking without AI", async () => {
    const { router } = await setup();

    let turn = await router.handle(undefined, "hi");
    expect(turn.stage).toBe("select_purpose");
    expect(turn.quickReplies.map((q) => q.label)).toEqual([
      "Book an appointment",
      "Check or cancel an appointment",
    ]);
    const sessionId = turn.sessionId;

    turn = await router.handle(sessionId, "1");
    expect(turn.stage).toBe("select_specialty");
    expect(turn.quickReplies.length).toBeGreaterThan(0);

    turn = await router.handle(sessionId, "General Medicine");
    expect(turn.stage).toBe("select_doctor");

    turn = await router.handle(sessionId, "1"); // Dr. Amanda Putri
    expect(turn.stage).toBe("select_date");

    turn = await router.handle(sessionId, MONDAY);
    expect(turn.stage).toBe("select_slot");

    turn = await router.handle(sessionId, "1"); // 09:00
    expect(turn.stage).toBe("collect_patient_name");

    turn = await router.handle(sessionId, "Jane Doe");
    expect(turn.stage).toBe("collect_patient_phone");

    turn = await router.handle(sessionId, "081234567890");
    expect(turn.stage).toBe("confirm_booking");
    expect(turn.message).toContain("Jane Doe");

    turn = await router.handle(sessionId, "yes");
    expect(turn.stage).toBe("booking_complete");
    expect(turn.collectedEntities.bookingReference).toMatch(/^BK-/);
  });

  it("survives session reload between turns", async () => {
    const { router, sessions } = await setup();
    const first = await router.handle(undefined, "hello");
    const stored = await sessions.find(first.sessionId);
    expect(stored?.stage).toBe("select_purpose");

    const second = await router.handle(first.sessionId, "1");
    expect(second.stage).toBe("select_specialty");
  });

  it("cancels from any stage", async () => {
    const { router } = await setup();
    const first = await router.handle(undefined, "hi");
    const second = await router.handle(first.sessionId, "1");
    const third = await router.handle(second.sessionId, "cancel");
    expect(third.stage).toBe("cancelled");
  });

  it("hands off after repeated invalid input", async () => {
    const { router } = await setup();
    const first = await router.handle(undefined, "hi");
    await router.handle(first.sessionId, "gibberish xyz");
    await router.handle(first.sessionId, "more gibberish");
    const turn = await router.handle(first.sessionId, "still gibberish");
    expect(turn.stage).toBe("handoff_pending");
  });

  it("recovers when the chosen slot is taken after the hold expires", async () => {
    // Controllable clock: picking a slot holds a seat, so rivals can only
    // steal it after the 5-minute hold has expired (idle session).
    let t = Date.now();
    const { InMemorySlotLock } = await import("../src/services/slot-lock.js");
    const { router, booking } = await setup(new InMemorySlotLock(300_000, () => t));

    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;
    await router.handle(sessionId, "1"); // Book an appointment
    await router.handle(sessionId, "General Medicine");
    await router.handle(sessionId, "1");
    await router.handle(sessionId, MONDAY);
    await router.handle(sessionId, "1"); // picks 09:00 -> seat held
    await router.handle(sessionId, "Jane Doe");
    await router.handle(sessionId, "081234567890");

    t += 300_001; // session idles past the hold TTL: seat auto-released

    // Rivals fill the 09:00 slot (capacity 2 at 30 min) before confirmation.
    await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Rival Patient",
      patientPhone: "081298765432",
    });
    await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Second Rival",
      patientPhone: "081211112222",
    });

    const turn = await router.handle(sessionId, "yes");
    expect(turn.stage).toBe("select_slot");
    expect(turn.message).toContain("just taken");
  });

  it("holds the picked slot so another session sees it as being booked", async () => {
    const { router, booking } = await setup();
    // Fill one of the two 09:00 seats with a real booking.
    await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Existing Patient",
      patientPhone: "081298765432",
    });

    // Session A picks 09:00 -> holds the last seat.
    const a = await router.handle(undefined, "hi");
    await router.handle(a.sessionId, "1");
    await router.handle(a.sessionId, "General Medicine");
    await router.handle(a.sessionId, "1");
    await router.handle(a.sessionId, MONDAY);
    const aTurn = await router.handle(a.sessionId, "1");
    expect(aTurn.stage).toBe("collect_patient_name");

    // Session B sees 09:00 as being booked and cannot pick it.
    const b = await router.handle(undefined, "hi");
    await router.handle(b.sessionId, "1");
    await router.handle(b.sessionId, "General Medicine");
    await router.handle(b.sessionId, "1");
    const bSlots = await router.handle(b.sessionId, MONDAY);
    const heldReply = bSlots.quickReplies.find((q) => q.label.startsWith("09:00"));
    expect(heldReply?.label).toContain("(Being booked)");
    expect(heldReply?.disabled).toBe(true);

    const rejected = await router.handle(b.sessionId, "1");
    expect(rejected.stage).toBe("select_slot");
    expect(rejected.message).toContain("currently being booked");

    // Session A finishes: hold consumed, slot now genuinely full for B.
    await router.handle(a.sessionId, "Jane Doe");
    await router.handle(a.sessionId, "081234567890");
    const done = await router.handle(a.sessionId, "yes");
    expect(done.stage).toBe("booking_complete");

    const bAfter = await router.handle(b.sessionId, "menu"); // restart to purpose
    expect(bAfter.stage).toBe("select_purpose");
  });

  it("releases the hold when the user changes slot at confirmation", async () => {
    const { router, booking } = await setup();
    await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Existing Patient",
      patientPhone: "081298765432",
    });

    // Session A holds the last 09:00 seat and reaches confirmation.
    const a = await router.handle(undefined, "hi");
    await router.handle(a.sessionId, "1");
    await router.handle(a.sessionId, "General Medicine");
    await router.handle(a.sessionId, "1");
    await router.handle(a.sessionId, MONDAY);
    await router.handle(a.sessionId, "1"); // 09:00
    await router.handle(a.sessionId, "Jane Doe");
    await router.handle(a.sessionId, "081234567890");

    // "Change slot" releases the held seat...
    const changed = await router.handle(a.sessionId, "2");
    expect(changed.stage).toBe("select_slot");

    // ...so another session can now book 09:00.
    await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Second Patient",
      patientPhone: "081211112222",
      holderId: "other-session",
    });
  });

  it("flags full slots and rejects selecting them", async () => {
    const { router, booking } = await setup();
    // Fill 09:00 (capacity 2 at 30 min).
    for (const phone of ["081298765432", "081211112222"]) {
      await booking.createBooking({
        doctorId: 1,
        date: MONDAY,
        startTime: "09:00",
        patientName: "Filler Patient",
        patientPhone: phone,
      });
    }

    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;
    await router.handle(sessionId, "1"); // Book an appointment
    await router.handle(sessionId, "General Medicine");
    await router.handle(sessionId, "1");
    const slotTurn = await router.handle(sessionId, MONDAY);
    expect(slotTurn.stage).toBe("select_slot");

    const fullReply = slotTurn.quickReplies.find((q) => q.label.startsWith("09:00"));
    expect(fullReply?.label).toContain("(Full)");
    expect(fullReply?.disabled).toBe(true);
    const openReply = slotTurn.quickReplies.find((q) => q.label.startsWith("09:30"));
    expect(openReply?.disabled).toBeUndefined();

    // Picking the full slot anyway is rejected and stays on select_slot.
    const rejected = await router.handle(sessionId, "1");
    expect(rejected.stage).toBe("select_slot");
    expect(rejected.message).toContain("already full");
  });

  it("restarts after completion", async () => {
    const { router } = await setup();
    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;
    await router.handle(sessionId, "1");
    await router.handle(sessionId, "Dermatology");
    const turn = await router.handle(sessionId, "restart");
    expect(turn.stage).toBe("select_purpose");
    expect(turn.collectedEntities.specialtyId).toBeUndefined();
  });

  it("checks an appointment and cancels it, releasing the slot", async () => {
    const { router, booking } = await setup();
    const created = await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });

    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;

    let turn = await router.handle(sessionId, "2"); // Check or cancel
    expect(turn.stage).toBe("check_collect_reference");

    turn = await router.handle(sessionId, created.booking.reference);
    expect(turn.stage).toBe("check_collect_phone");

    turn = await router.handle(sessionId, "081234567890");
    expect(turn.stage).toBe("check_result");
    expect(turn.message).toContain(created.booking.reference);
    expect(turn.message).toContain("active");
    expect(turn.quickReplies[0]?.label).toBe("Cancel this appointment");

    turn = await router.handle(sessionId, "1"); // Cancel this appointment
    expect(turn.stage).toBe("confirm_cancellation");

    turn = await router.handle(sessionId, "1"); // Yes, cancel it
    expect(turn.stage).toBe("cancellation_complete");
    expect(turn.message).toContain("released");

    // Seat released: slot bookable again.
    const slot = (await booking.getAvailableSlots(1, MONDAY)).find(
      (s) => s.startTime === "09:00",
    );
    expect(slot?.bookedCount).toBe(0);
    expect(slot?.available).toBe(true);
  });

  it("rejects a lookup with the wrong phone and retries", async () => {
    const { router, booking } = await setup();
    const created = await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });

    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;
    await router.handle(sessionId, "2");
    await router.handle(sessionId, created.booking.reference);

    const turn = await router.handle(sessionId, "081298765432"); // wrong phone
    expect(turn.stage).toBe("check_collect_reference");
    expect(turn.message).toContain("couldn't find");
  });

  it("offers no cancel option for an already cancelled booking", async () => {
    const { router, booking } = await setup();
    const created = await booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Jane Doe",
      patientPhone: "081234567890",
    });
    await booking.cancelBooking(created.booking.reference, "081234567890");

    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;
    await router.handle(sessionId, "2");
    await router.handle(sessionId, created.booking.reference);
    const turn = await router.handle(sessionId, "081234567890");

    expect(turn.stage).toBe("check_result");
    expect(turn.message).toContain("cancelled");
    expect(turn.quickReplies.map((q) => q.label)).toEqual(["Main menu"]);
  });
});
