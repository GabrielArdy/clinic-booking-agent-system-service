import { SqliteDatabase } from "../src/db/sqlite.js";
import type { Database } from "../src/db/executor.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { repositoryFactory } from "../src/repositories/factory.js";
import type { Repositories } from "../src/repositories/ports.js";
import { BookingService } from "../src/services/booking-service.js";
import type { SlotLock } from "../src/services/slot-lock.js";

/** Fresh in-memory sqlite database, migrated and seeded. */
export async function testDb(): Promise<Database> {
  const db = SqliteDatabase.open(":memory:");
  await runMigrations(db);
  await seed(db);
  return db;
}

export function testRepos(db: Database): Repositories {
  return repositoryFactory(db.type)(db);
}

export function bookingService(db: Database, now?: () => Date, slotLock?: SlotLock): BookingService {
  return new BookingService(db, repositoryFactory(db.type), now, slotLock);
}

/** Next date (from tomorrow) falling on the given weekday, as YYYY-MM-DD. */
export function nextDateForWeekday(weekday: number): string {
  const d = new Date();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== weekday);
  return d.toISOString().slice(0, 10);
}
