import { describe, expect, it } from "vitest";
import { computeSlots } from "../src/services/slots.js";
import type { ScheduleRule } from "../src/domain/types.js";

const rule: ScheduleRule = {
  id: 1,
  doctorId: 1,
  weekday: 1,
  startTime: "09:00",
  endTime: "11:00",
  slotMinutes: 30,
};

describe("computeSlots", () => {
  it("generates slots from a rule", () => {
    const slots = computeSlots("2026-07-06", [rule], [], new Set());
    expect(slots.map((s) => s.startTime)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(slots[0]).toEqual({ date: "2026-07-06", startTime: "09:00", endTime: "09:30" });
  });

  it("excludes booked start times", () => {
    const slots = computeSlots("2026-07-06", [rule], [], new Set(["09:30"]));
    expect(slots.map((s) => s.startTime)).toEqual(["09:00", "10:00", "10:30"]);
  });

  it("blocks whole day on a full-day exception", () => {
    const slots = computeSlots(
      "2026-07-06",
      [rule],
      [{ id: 1, doctorId: 1, date: "2026-07-06", startTime: null, endTime: null, reason: null }],
      new Set(),
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
      new Set(),
    );
    expect(slots.map((s) => s.startTime)).toEqual(["10:00", "10:30"]);
  });

  it("does not emit a slot that would overrun the rule end", () => {
    const shortRule = { ...rule, endTime: "09:45" };
    const slots = computeSlots("2026-07-06", [shortRule], [], new Set());
    expect(slots.map((s) => s.startTime)).toEqual(["09:00"]);
  });
});
