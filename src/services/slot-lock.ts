import { Redis } from "ioredis";

/** Default hold TTL: an idle booking flow releases its slot after 5 minutes. */
export const SLOT_HOLD_TTL_SECONDS = 300;

/**
 * Soft lock on a slot while a booking conversation is in progress. A hold
 * reserves one seat for the holder (session); it expires automatically after
 * the TTL so abandoned flows release the seat without any cleanup job.
 */
export interface SlotLock {
  /**
   * Takes (or refreshes) a hold for `holder`. `maxHolders` = seats still
   * free in the slot; fails when that many other holders already hold it.
   */
  acquire(slotKey: string, holder: string, maxHolders: number): Promise<boolean>;
  /** Releases the holder's hold (no-op when absent). */
  release(slotKey: string, holder: string): Promise<void>;
  /** Live holds on the slot, excluding `excludeHolder` when given. */
  countOthers(slotKey: string, excludeHolder?: string): Promise<number>;
  close?(): Promise<void>;
}

export function slotLockKey(doctorId: number, date: string, startTime: string): string {
  return `slothold:${doctorId}:${date}:${startTime}`;
}

/**
 * Single-process fallback used when no REDIS_URL is configured (dev, tests).
 * Same semantics as the Redis implementation, including TTL expiry.
 */
export class InMemorySlotLock implements SlotLock {
  private readonly holds = new Map<string, Map<string, number>>();

  constructor(
    private readonly ttlMs: number = SLOT_HOLD_TTL_SECONDS * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private liveHolders(slotKey: string): Map<string, number> {
    const holders = this.holds.get(slotKey) ?? new Map<string, number>();
    const nowMs = this.now();
    for (const [holder, expiresAt] of holders) {
      if (expiresAt <= nowMs) holders.delete(holder);
    }
    if (holders.size === 0) this.holds.delete(slotKey);
    else this.holds.set(slotKey, holders);
    return holders;
  }

  async acquire(slotKey: string, holder: string, maxHolders: number): Promise<boolean> {
    const holders = this.liveHolders(slotKey);
    if (!holders.has(holder) && holders.size >= maxHolders) return false;
    holders.set(holder, this.now() + this.ttlMs);
    this.holds.set(slotKey, holders);
    return true;
  }

  async release(slotKey: string, holder: string): Promise<void> {
    this.liveHolders(slotKey).delete(holder);
  }

  async countOthers(slotKey: string, excludeHolder?: string): Promise<number> {
    const holders = this.liveHolders(slotKey);
    return holders.size - (excludeHolder !== undefined && holders.has(excludeHolder) ? 1 : 0);
  }
}

/**
 * Redis-backed hold: one ZSET per slot, member = holder, score = expiry (ms).
 * Acquire is atomic (Lua) so concurrent sessions cannot over-hold a slot.
 * Key-level PEXPIRE keeps Redis clean even if all holders go idle.
 */
const ACQUIRE_LUA = `
local key = KEYS[1]
local holder = ARGV[1]
local nowMs = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])
local maxHolders = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', nowMs)
if not redis.call('ZSCORE', key, holder) then
  if redis.call('ZCARD', key) >= maxHolders then return 0 end
end
redis.call('ZADD', key, nowMs + ttlMs, holder)
redis.call('PEXPIRE', key, ttlMs)
return 1
`;

export class RedisSlotLock implements SlotLock {
  private readonly redis: Redis;
  private readonly ttlMs: number;

  constructor(redisUrl: string, ttlSeconds: number = SLOT_HOLD_TTL_SECONDS) {
    this.redis = new Redis(redisUrl);
    this.ttlMs = ttlSeconds * 1000;
    this.redis.defineCommand("acquireSlotHold", { numberOfKeys: 1, lua: ACQUIRE_LUA });
  }

  async acquire(slotKey: string, holder: string, maxHolders: number): Promise<boolean> {
    const result = await (
      this.redis as Redis & {
        acquireSlotHold(key: string, ...args: (string | number)[]): Promise<number>;
      }
    ).acquireSlotHold(slotKey, holder, Date.now(), this.ttlMs, maxHolders);
    return result === 1;
  }

  async release(slotKey: string, holder: string): Promise<void> {
    await this.redis.zrem(slotKey, holder);
  }

  async countOthers(slotKey: string, excludeHolder?: string): Promise<number> {
    await this.redis.zremrangebyscore(slotKey, "-inf", Date.now());
    const [count, ownScore] = await Promise.all([
      this.redis.zcard(slotKey),
      excludeHolder !== undefined ? this.redis.zscore(slotKey, excludeHolder) : null,
    ]);
    return count - (ownScore !== null ? 1 : 0);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
