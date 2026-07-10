import { describe, expect, it } from "vitest";
import { testDb, nextDateForWeekday } from "./helpers.js";
import { BookingService } from "../src/services/booking-service.js";
import { SessionRepository } from "../src/repositories/session-repository.js";
import { ConversationRouter } from "../src/conversation/router.js";
import { DisabledAIProvider } from "../src/ai/provider.js";

function setup() {
  const db = testDb();
  const booking = new BookingService(db);
  const sessions = new SessionRepository(db);
  const router = new ConversationRouter(booking, sessions, new DisabledAIProvider());
  return { db, booking, sessions, router };
}

const MONDAY = nextDateForWeekday(1);

describe("ConversationRouter", () => {
  it("completes a full booking without AI", async () => {
    const { router } = setup();

    let turn = await router.handle(undefined, "hi");
    expect(turn.stage).toBe("select_specialty");
    expect(turn.quickReplies.length).toBeGreaterThan(0);
    const sessionId = turn.sessionId;

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
    const { router, sessions } = setup();
    const first = await router.handle(undefined, "hello");
    const stored = sessions.find(first.sessionId);
    expect(stored?.stage).toBe("select_specialty");

    const second = await router.handle(first.sessionId, "1");
    expect(second.stage).toBe("select_doctor");
  });

  it("cancels from any stage", async () => {
    const { router } = setup();
    const first = await router.handle(undefined, "hi");
    const second = await router.handle(first.sessionId, "1");
    const third = await router.handle(second.sessionId, "cancel");
    expect(third.stage).toBe("cancelled");
  });

  it("hands off after repeated invalid input", async () => {
    const { router } = setup();
    const first = await router.handle(undefined, "hi");
    await router.handle(first.sessionId, "gibberish xyz");
    await router.handle(first.sessionId, "more gibberish");
    const turn = await router.handle(first.sessionId, "still gibberish");
    expect(turn.stage).toBe("handoff_pending");
  });

  it("recovers when the chosen slot is taken mid-conversation", async () => {
    const { router, booking } = setup();
    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;
    await router.handle(sessionId, "General Medicine");
    await router.handle(sessionId, "1");
    await router.handle(sessionId, MONDAY);
    await router.handle(sessionId, "1"); // picks 09:00
    await router.handle(sessionId, "Jane Doe");
    await router.handle(sessionId, "081234567890");

    // Someone else books 09:00 before confirmation.
    booking.createBooking({
      doctorId: 1,
      date: MONDAY,
      startTime: "09:00",
      patientName: "Rival Patient",
      patientPhone: "081298765432",
    });

    const turn = await router.handle(sessionId, "yes");
    expect(turn.stage).toBe("select_slot");
    expect(turn.message).toContain("just taken");
  });

  it("restarts after completion", async () => {
    const { router } = setup();
    const first = await router.handle(undefined, "hi");
    const sessionId = first.sessionId;
    await router.handle(sessionId, "Dermatology");
    const turn = await router.handle(sessionId, "restart");
    expect(turn.stage).toBe("select_specialty");
    expect(turn.collectedEntities.specialtyId).toBeUndefined();
  });
});
