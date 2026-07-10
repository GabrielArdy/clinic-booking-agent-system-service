import { openDatabase, type DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

export function testDb(): DB {
  const db = openDatabase(":memory:");
  runMigrations(db);
  seed(db);
  return db;
}

/** Next date (from tomorrow) falling on the given weekday, as YYYY-MM-DD. */
export function nextDateForWeekday(weekday: number): string {
  const d = new Date();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== weekday);
  return d.toISOString().slice(0, 10);
}
