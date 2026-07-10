import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";
import type { Database } from "./executor.js";
import { runMigrations } from "./migrate.js";
import { repositoryFactory } from "../repositories/factory.js";
import { logger } from "../logging/logger.js";

interface DoctorSeed {
  name: string;
  rules: [number, string, string, number][]; // weekday, start, end, slotMinutes
}

const DATA: Record<string, DoctorSeed[]> = {
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

const SLOT_PRESETS: [string, number][] = [
  ["Quick (15 min)", 15],
  ["Standard (30 min)", 30],
  ["Extended (60 min)", 60],
];
const SHIFTS: [string, string, string][] = [
  ["Morning", "08:00", "12:00"],
  ["Afternoon", "13:00", "17:00"],
];

/** Idempotent seed via the repository layer — works on sqlite and postgres. */
export async function seed(db: Database): Promise<void> {
  await db.tx(async (ex) => {
    const r = repositoryFactory(db.type)(ex);

    const existingSpecialties = await r.specialties.listAll();
    const specialtyId = new Map(existingSpecialties.map((s) => [s.name, s.id]));
    const existingDoctors = await r.doctors.listAll();
    const doctorNames = new Set(existingDoctors.map((d) => d.fullName));

    for (const [specialtyName, doctors] of Object.entries(DATA)) {
      let sid = specialtyId.get(specialtyName);
      if (sid === undefined) {
        sid = (await r.specialties.create(specialtyName)).id;
        specialtyId.set(specialtyName, sid);
      }
      for (const doctor of doctors) {
        if (doctorNames.has(doctor.name)) continue;
        const created = await r.doctors.create({ fullName: doctor.name, specialtyId: sid });
        for (const [weekday, start, end, slotMinutes] of doctor.rules) {
          await r.schedules.createRule({
            doctorId: created.id,
            weekday,
            startTime: start,
            endTime: end,
            slotMinutes,
          });
        }
      }
    }

    const presetLabels = new Set((await r.slotPresets.listAll()).map((p) => p.label));
    for (const [label, minutes] of SLOT_PRESETS) {
      if (!presetLabels.has(label)) await r.slotPresets.create(label, minutes);
    }

    const shiftNames = new Set((await r.shifts.listShifts()).map((s) => s.name));
    for (const [name, start, end] of SHIFTS) {
      if (!shiftNames.has(name)) await r.shifts.createShift(name, start, end);
    }

    const clinic = await r.clinic.get();
    if (clinic.name === "") await r.clinic.update({ name: "Sandbox Clinic" });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  await runMigrations(db);
  await seed(db);
  const doctors = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM doctors");
  logger.info("seed complete", { dbType: config.dbType, doctors: doctors[0]?.n });
  await db.close();
}
