import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";
import type { Database } from "./executor.js";
import { runMigrations } from "./migrate.js";
import { repositoryFactory } from "../repositories/factory.js";
import { logger } from "../logging/logger.js";
import { hashPassword } from "../services/password.js";
import { GROUPS, GROUP_DEFAULT_ROLES, ROLES } from "../services/auth-service.js";

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

// ---- auth / RBAC masters ----

const GROUP_SEED: [string, string][] = [
  // [group_code, group_name]
  [GROUPS.ADMIN, "Admin"],
  [GROUPS.DOCTOR, "Doctor"],
  [GROUPS.STAFF, "Staff"],
];

const ROLE_SEED: [string, string, string, string][] = [
  // [role_code, role_name, group_code, description]
  [ROLES.ADM_DASHBOARD, "Admin Dashboard", GROUPS.ADMIN, "Admin dashboard + operational admin endpoints"],
  [ROLES.CMS_CLINIC, "CMS Clinic", GROUPS.ADMIN, "Clinic profile settings"],
  [ROLES.CMS_STAFF_DOCTOR, "Staff & Doctor CMS", GROUPS.ADMIN, "Doctors, staff, specialties management"],
  [ROLES.CMS_THEME, "Theme CMS", GROUPS.ADMIN, "Theme / branding settings"],
  [ROLES.AUDIT_LOG, "Audit Log", GROUPS.ADMIN, "Read audit trail"],
  [ROLES.CMS_SLOT, "Slot CMS", GROUPS.ADMIN, "Slot presets management"],
  [ROLES.CMS_ROSTER, "Roster / Shift CMS", GROUPS.ADMIN, "Shifts + shift assignments"],
  [ROLES.CMS_POSITION, "Position CMS", GROUPS.ADMIN, "Positions, groups, roles, user accounts"],
  [ROLES.DOC_DASHBOARD, "Doctor Dashboard", GROUPS.DOCTOR, "Schedule page + today's shift"],
  [ROLES.DOC_EXCEPTION, "Doctor Exceptions", GROUPS.DOCTOR, "Own blocking time management"],
  [ROLES.DOC_APPOINTMENT, "Doctor Appointments", GROUPS.DOCTOR, "Own appointment list + detail"],
  [ROLES.STF_DASHBOARD, "Staff Dashboard", GROUPS.STAFF, "Today's shift info"],
  [ROLES.STF_CHAT, "Staff Live Chat", GROUPS.STAFF, "Handle patient live chat sessions"],
];

const POSITION_SEED: [string, string, string][] = [
  // [position_code, position_name, group_code]
  ["A001", "IT Head Clinic", GROUPS.ADMIN],
  ["D001", "General Doctor", GROUPS.DOCTOR],
  ["D012", "Specialist Doctor", GROUPS.DOCTOR],
  ["N001", "Nurse", GROUPS.STAFF],
  ["P001", "Pharmacist", GROUPS.STAFF],
  ["DA01", "Dental Assistant", GROUPS.STAFF],
];

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

    // ---- auth / RBAC masters (idempotent upserts) ----
    for (const [code, name] of GROUP_SEED) await r.auth.upsertGroup(code, name);
    for (const [code, name, groupCode, description] of ROLE_SEED) {
      await r.auth.upsertRole(code, name, groupCode, description);
    }
    for (const [code, name, groupCode] of POSITION_SEED) {
      await r.auth.upsertPosition(code, name, groupCode);
    }

    // Demo staff entity for the staff demo account.
    let nurse = (await r.staff.listAll()).find((s) => s.fullName === "Sari Wulandari");
    if (!nurse) {
      nurse = await r.staff.create({ fullName: "Sari Wulandari", role: "nurse" });
    }
    const amanda = (await r.doctors.listAll()).find((d) => d.fullName === "Dr. Amanda Putri");

    // Demo login accounts, one per group. CHANGE PASSWORDS OUTSIDE DEV.
    const demoUsers: {
      email: string;
      password: string;
      fullName: string;
      positionCode: string;
      groupCode: string;
      doctorId?: number;
      staffId?: number;
    }[] = [
      {
        email: "admin@clinic.test",
        password: "Admin123!",
        fullName: "Clinic IT Admin",
        positionCode: "A001",
        groupCode: GROUPS.ADMIN,
      },
      {
        email: "doctor@clinic.test",
        password: "Doctor123!",
        fullName: "Dr. Amanda Putri",
        positionCode: "D001",
        groupCode: GROUPS.DOCTOR,
        ...(amanda ? { doctorId: amanda.id } : {}),
      },
      {
        email: "staff@clinic.test",
        password: "Staff123!",
        fullName: "Sari Wulandari",
        positionCode: "N001",
        groupCode: GROUPS.STAFF,
        staffId: nurse.id,
      },
    ];
    for (const u of demoUsers) {
      const bundle = GROUP_DEFAULT_ROLES[u.groupCode] ?? [];
      const existing = await r.auth.findUserByEmail(u.email);
      if (existing) {
        // Top-up: grant bundle roles added after the account was first seeded
        // (e.g. STF_CHAT) without dropping any manually assigned roles.
        const current = await r.auth.rolesForUser(existing.id);
        const merged = [...new Set([...current, ...bundle])];
        if (merged.length !== current.length) await r.auth.setUserRoles(existing.id, merged);
        continue;
      }
      const created = await r.auth.createUser({
        email: u.email,
        passwordHash: hashPassword(u.password),
        fullName: u.fullName,
        positionCode: u.positionCode,
        doctorId: u.doctorId ?? null,
        staffId: u.staffId ?? null,
      });
      await r.auth.setUserRoles(created.id, bundle);
    }
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
