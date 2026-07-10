import type { ScheduleException, ScheduleRule, Slot } from "../domain/types.js";

/** Assumed duration of one consultation within a slot. */
export const CONSULTATION_MINUTES = 15;

/**
 * How many patients fit in one slot: floor(slotMinutes / 15), min 1.
 * e.g. 60 min -> 4, 45 min -> 3, 30 min -> 2, 15 min -> 1.
 */
export function slotCapacity(slotMinutes: number): number {
  return Math.max(1, Math.floor(slotMinutes / CONSULTATION_MINUTES));
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function weekdayOf(date: string): number {
  // Parse as UTC noon to avoid timezone day-shift.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Slot start as a Date in server-local (clinic) time. */
export function slotStartDate(date: string, startTime: string): Date {
  return new Date(`${date}T${startTime}:00`);
}

function blockedByException(
  slotStart: number,
  slotEnd: number,
  exceptions: ScheduleException[],
): boolean {
  return exceptions.some((ex) => {
    if (ex.startTime === null || ex.endTime === null) return true; // whole day
    const exStart = timeToMinutes(ex.startTime);
    const exEnd = timeToMinutes(ex.endTime);
    return slotStart < exEnd && slotEnd > exStart; // overlap
  });
}

/**
 * Derives slots for one date: schedule rules minus exceptions. Slots at
 * capacity are kept but flagged unavailable so the UI can show them as full.
 */
export function computeSlots(
  date: string,
  rules: ScheduleRule[],
  exceptions: ScheduleException[],
  bookedCounts: ReadonlyMap<string, number>,
): Slot[] {
  const slots: Slot[] = [];
  for (const rule of rules) {
    const ruleStart = timeToMinutes(rule.startTime);
    const ruleEnd = timeToMinutes(rule.endTime);
    const capacity = slotCapacity(rule.slotMinutes);
    for (let start = ruleStart; start + rule.slotMinutes <= ruleEnd; start += rule.slotMinutes) {
      const end = start + rule.slotMinutes;
      const startTime = minutesToTime(start);
      if (blockedByException(start, end, exceptions)) continue;
      const bookedCount = bookedCounts.get(startTime) ?? 0;
      const full = bookedCount >= capacity;
      slots.push({
        date,
        startTime,
        endTime: minutesToTime(end),
        capacity,
        bookedCount,
        available: !full,
        ...(full ? { unavailableReason: "full" as const } : {}),
      });
    }
  }
  slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return slots;
}
