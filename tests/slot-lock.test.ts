import { describe, expect, it } from "vitest";
import { InMemorySlotLock, slotLockKey } from "../src/services/slot-lock.js";

const KEY = slotLockKey(1, "2026-07-13", "09:00");

describe("InMemorySlotLock", () => {
  it("caps holders at maxHolders", async () => {
    const lock = new InMemorySlotLock(300_000);
    expect(await lock.acquire(KEY, "a", 2)).toBe(true);
    expect(await lock.acquire(KEY, "b", 2)).toBe(true);
    expect(await lock.acquire(KEY, "c", 2)).toBe(false);
    expect(await lock.countOthers(KEY)).toBe(2);
    expect(await lock.countOthers(KEY, "a")).toBe(1);
  });

  it("refreshes an existing hold without consuming another seat", async () => {
    const lock = new InMemorySlotLock(300_000);
    expect(await lock.acquire(KEY, "a", 1)).toBe(true);
    expect(await lock.acquire(KEY, "a", 1)).toBe(true); // refresh, not a new seat
    expect(await lock.countOthers(KEY)).toBe(1);
  });

  it("releases a hold explicitly", async () => {
    const lock = new InMemorySlotLock(300_000);
    await lock.acquire(KEY, "a", 1);
    await lock.release(KEY, "a");
    expect(await lock.countOthers(KEY)).toBe(0);
    expect(await lock.acquire(KEY, "b", 1)).toBe(true);
  });

  it("auto-releases after the TTL (idle flow)", async () => {
    let t = 1_000_000;
    const lock = new InMemorySlotLock(300_000, () => t);
    expect(await lock.acquire(KEY, "a", 1)).toBe(true);
    expect(await lock.acquire(KEY, "b", 1)).toBe(false);

    t += 300_001; // 5 minutes of idle: hold expires
    expect(await lock.countOthers(KEY)).toBe(0);
    expect(await lock.acquire(KEY, "b", 1)).toBe(true);
  });
});
