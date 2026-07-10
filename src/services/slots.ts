import type { ScheduleException, ScheduleRule, Slot } from "../domain/types.js";

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
 * Derives bookable slots for one date: schedule rules minus exceptions
 * minus already-booked start times.
 */
export function computeSlots(
  date: string,
  rules: ScheduleRule[],
  exceptions: ScheduleException[],
  bookedStartTimes: Set<string>,
): Slot[] {
  const slots: Slot[] = [];
  for (const rule of rules) {
    const ruleStart = timeToMinutes(rule.startTime);
    const ruleEnd = timeToMinutes(rule.endTime);
    for (let start = ruleStart; start + rule.slotMinutes <= ruleEnd; start += rule.slotMinutes) {
      const end = start + rule.slotMinutes;
      const startTime = minutesToTime(start);
      if (bookedStartTimes.has(startTime)) continue;
      if (blockedByException(start, end, exceptions)) continue;
      slots.push({ date, startTime, endTime: minutesToTime(end) });
    }
  }
  slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return slots;
}
