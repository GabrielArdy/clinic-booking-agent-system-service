import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { openDatabase, type DB } from "./connection.js";
import { runMigrations } from "./migrate.js";
import { logger } from "../logging/logger.js";

export function seed(db: DB): void {
  const insertSpecialty = db.prepare(
    "INSERT INTO specialties (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
  );
  const specialtyId = db.prepare("SELECT id FROM specialties WHERE name = ?");
  const insertDoctor = db.prepare(
    `INSERT INTO doctors (full_name, specialty_id)
     SELECT ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE full_name = ?)`,
  );
  const doctorId = db.prepare("SELECT id FROM doctors WHERE full_name = ?");
  const insertRule = db.prepare(
    `INSERT INTO doctor_schedule_rules (doctor_id, weekday, start_time, end_time, slot_minutes)
     SELECT ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM doctor_schedule_rules WHERE doctor_id = ? AND weekday = ? AND start_time = ?
     )`,
  );

  const data: Record<string, { name: string; rules: [number, string, string, number][] }[]> = {
    "General Medicine": [
      {
        name: "Dr. Amanda Putri",
        rules: [
          [1, "09:00", "12:00", 30],
          [2, "09:00", "12:00", 30],
          [3, "09:00", "12:00", 30],
          [4, "09:00", "12:00", 30],
          [5, "09:00", "12:00", 30],
        ],
      },
      {
        name: "Dr. Budi Santoso",
        rules: [
          [1, "13:00", "17:00", 30],
          [3, "13:00", "17:00", 30],
          [5, "13:00", "17:00", 30],
        ],
      },
    ],
    Dermatology: [
      {
        name: "Dr. Citra Lestari",
        rules: [
          [2, "10:00", "14:00", 30],
          [4, "10:00", "14:00", 30],
        ],
      },
    ],
    Pediatrics: [
      {
        name: "Dr. Dewi Anggraini",
        rules: [
          [1, "08:00", "12:00", 30],
          [2, "08:00", "12:00", 30],
          [5, "08:00", "12:00", 30],
        ],
      },
    ],
    Cardiology: [
      {
        name: "Dr. Eko Prasetyo",
        rules: [
          [3, "14:00", "18:00", 60],
          [6, "09:00", "13:00", 60],
        ],
      },
    ],
  };

  const run = db.transaction(() => {
    for (const [specialty, doctors] of Object.entries(data)) {
      insertSpecialty.run(specialty);
      const sid = (specialtyId.get(specialty) as { id: number }).id;
      for (const doctor of doctors) {
        insertDoctor.run(doctor.name, sid, doctor.name);
        const did = (doctorId.get(doctor.name) as { id: number }).id;
        for (const [weekday, start, end, slotMinutes] of doctor.rules) {
          insertRule.run(did, weekday, start, end, slotMinutes, did, weekday, start);
        }
      }
    }
  });
  run();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  seed(db);
  const counts = {
    specialties: (db.prepare("SELECT COUNT(*) AS n FROM specialties").get() as { n: number }).n,
    doctors: (db.prepare("SELECT COUNT(*) AS n FROM doctors").get() as { n: number }).n,
    rules: (db.prepare("SELECT COUNT(*) AS n FROM doctor_schedule_rules").get() as { n: number }).n,
  };
  logger.info("seed complete", counts);
  db.close();
}
