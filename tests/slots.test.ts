import { describe, expect, it } from "vitest";
import { computeSlots, slotCapacity } from "../src/services/slots.js";
import type { ScheduleRule } from "../src/domain/types.js";

// 30-min slots -> capacity 2 (floor(30 / 15)).
const rule: ScheduleRule = {
  id: 1,
  doctorId: 1,
  weekday: 1,
  startTime: "09:00",
  endTime: "11:00",
  slotMinutes: 30,
};

describe("slotCapacity", () => {
  it("is floor(slotMinutes / 15)", () => {
    expect(slotCapacity(60)).toBe(4);
    expect(slotCapacity(45)).toBe(3);
    expect(slotCapacity(30)).toBe(2);
    expect(slotCapacity(15)).toBe(1);
  });

  it("never drops below 1", () => {
    expect(slotCapacity(10)).toBe(1);
    expect(slotCapacity(5)).toBe(1);
  });
});

describe("computeSlots", () => {
  it("generates slots from a rule", () => {
    const slots = computeSlots("2026-07-06", [rule], [], new Map());
    expect(slots.map((s) => s.startTime)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(slots[0]).toEqual({
      date: "2026-07-06",
      startTime: "09:00",
      endTime: "09:30",
      capacity: 2,
      bookedCount: 0,
      available: true,
    });
  });

  it("keeps partially booked slots available", () => {
    const slots = computeSlots("2026-07-06", [rule], [], new Map([["09:30", 1]]));
    const slot = slots.find((s) => s.startTime === "09:30");
    expect(slot?.bookedCount).toBe(1);
    expect(slot?.available).toBe(true);
  });

  it("flags slots at capacity as full instead of hiding them", () => {
    const slots = computeSlots("2026-07-06", [rule], [], new Map([["09:30", 2]]));
    expect(slots.map((s) => s.startTime)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    const full = slots.find((s) => s.startTime === "09:30");
    expect(full?.available).toBe(false);
    expect(full?.bookedCount).toBe(2);
  });

  it("blocks whole day on a full-day exception", () => {
    const slots = computeSlots(
      "2026-07-06",
      [rule],
      [{ id: 1, doctorId: 1, date: "2026-07-06", startTime: null, endTime: null, reason: null }],
      new Map(),
    );
    expect(slots).toEqual([]);
  });

  it("blocks only overlapping slots on a partial exception", () => {
    const slots = computeSlots(
      "2026-07-06",
      [rule],
      [
        {
          id: 1,
          doctorId: 1,
          date: "2026-07-06",
          startTime: "09:15",
          endTime: "10:00",
          reason: "meeting",
        },
      ],
      new Map(),
    );
    expect(slots.map((s) => s.startTime)).toEqual(["10:00", "10:30"]);
  });

  it("does not emit a slot that would overrun the rule end", () => {
    const shortRule = { ...rule, endTime: "09:45" };
    const slots = computeSlots("2026-07-06", [shortRule], [], new Map());
    expect(slots.map((s) => s.startTime)).toEqual(["09:00"]);
  });
});
