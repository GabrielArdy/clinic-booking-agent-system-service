-- CMS console tables. Managed via /api/cms/* (x-admin-token gated), separate
-- from the operational admin console. Singletons use a CHECK (id = 1) guard.

-- Clinic identity + location + legal docs. Single row.
CREATE TABLE clinic_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    phone TEXT,
    email TEXT,
    permission_letter_url TEXT, -- surat izin / operating permit document
    emblem_url TEXT,            -- custom clinic emblem/logo
    extra_json TEXT NOT NULL DEFAULT '{}', -- free-form additional fields
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO clinic_settings (id) VALUES (1);

-- Visual theme for any front-end. Single row.
CREATE TABLE theme_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    primary_color TEXT NOT NULL DEFAULT '#2563eb',
    secondary_color TEXT NOT NULL DEFAULT '#1e293b',
    accent_color TEXT NOT NULL DEFAULT '#10b981',
    logo_url TEXT,
    font_family TEXT NOT NULL DEFAULT 'Inter',
    dark_mode INTEGER NOT NULL DEFAULT 0 CHECK (dark_mode IN (0, 1)),
    extra_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO theme_settings (id) VALUES (1);

-- Non-doctor personnel (receptionist, nurse, admin, ...). Doctors stay in
-- their own table; both can receive shift assignments.
CREATE TABLE staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    email TEXT,
    phone TEXT,
    photo_url TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Named slot-duration presets (TimeSlot CMS), reusable when authoring schedules.
CREATE TABLE slot_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- Named shifts (Schedule CMS) e.g. 'Morning' 08:00-12:00.
CREATE TABLE shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL, -- 'HH:MM'
    end_time TEXT NOT NULL,   -- 'HH:MM'
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- On-duty roster: a shift assigned to exactly one doctor OR one staff on a date.
CREATE TABLE shift_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    doctor_id INTEGER REFERENCES doctors(id),
    staff_id INTEGER REFERENCES staff(id),
    date TEXT NOT NULL, -- 'YYYY-MM-DD'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Exactly one of doctor_id / staff_id must be set.
    CHECK ((doctor_id IS NOT NULL) <> (staff_id IS NOT NULL))
);
CREATE INDEX idx_shift_assignments_date ON shift_assignments(date);
CREATE INDEX idx_shift_assignments_shift ON shift_assignments(shift_id);

-- Extend existing CMS-managed entities.
ALTER TABLE specialties ADD COLUMN description TEXT;
ALTER TABLE doctors ADD COLUMN email TEXT;
ALTER TABLE doctors ADD COLUMN phone TEXT;
ALTER TABLE doctors ADD COLUMN bio TEXT;
