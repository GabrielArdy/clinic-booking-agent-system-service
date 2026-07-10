-- CMS console tables (postgres). Mirrors migrations/sqlite/003_cms.sql.

CREATE TABLE clinic_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    phone TEXT,
    email TEXT,
    permission_letter_url TEXT,
    emblem_url TEXT,
    extra_json TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO clinic_settings (id) VALUES (1);

CREATE TABLE theme_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    primary_color TEXT NOT NULL DEFAULT '#2563eb',
    secondary_color TEXT NOT NULL DEFAULT '#1e293b',
    accent_color TEXT NOT NULL DEFAULT '#10b981',
    logo_url TEXT,
    font_family TEXT NOT NULL DEFAULT 'Inter',
    dark_mode BOOLEAN NOT NULL DEFAULT false,
    extra_json TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO theme_settings (id) VALUES (1);

CREATE TABLE staff (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    email TEXT,
    phone TEXT,
    photo_url TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE slot_presets (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE shifts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE shift_assignments (
    id SERIAL PRIMARY KEY,
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    doctor_id INTEGER REFERENCES doctors(id),
    staff_id INTEGER REFERENCES staff(id),
    date TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((doctor_id IS NOT NULL) <> (staff_id IS NOT NULL))
);
CREATE INDEX idx_shift_assignments_date ON shift_assignments(date);
CREATE INDEX idx_shift_assignments_shift ON shift_assignments(shift_id);

ALTER TABLE specialties ADD COLUMN description TEXT;
ALTER TABLE doctors ADD COLUMN email TEXT;
ALTER TABLE doctors ADD COLUMN phone TEXT;
ALTER TABLE doctors ADD COLUMN bio TEXT;
