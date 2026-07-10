CREATE TABLE specialties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    specialty_id INTEGER NOT NULL REFERENCES specialties(id),
    active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_doctors_specialty ON doctors(specialty_id);

-- Recurring weekly availability. weekday: 0 = Sunday .. 6 = Saturday.
-- Times are 'HH:MM' 24h strings; slot_minutes defines slot granularity.
CREATE TABLE doctor_schedule_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes > 0)
);

CREATE INDEX idx_schedule_rules_doctor ON doctor_schedule_rules(doctor_id, weekday);

-- Date-specific unavailability. NULL start/end = whole day blocked.
CREATE TABLE doctor_schedule_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    date TEXT NOT NULL, -- 'YYYY-MM-DD'
    start_time TEXT,
    end_time TEXT,
    reason TEXT
);

CREATE INDEX idx_schedule_exceptions_doctor_date ON doctor_schedule_exceptions(doctor_id, date);

CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE, -- normalized digits, e.g. '6281234567890'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    date TEXT NOT NULL, -- 'YYYY-MM-DD'
    start_time TEXT NOT NULL, -- 'HH:MM'
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT
);

-- Anti-double-booking: only one ACTIVE booking per doctor/date/start slot.
CREATE UNIQUE INDEX idx_bookings_unique_active_slot
    ON bookings(doctor_id, date, start_time)
    WHERE status = 'active';

CREATE INDEX idx_bookings_patient ON bookings(patient_id);
CREATE INDEX idx_bookings_doctor_date ON bookings(doctor_id, date);

CREATE TABLE conversation_sessions (
    id TEXT PRIMARY KEY, -- uuid
    stage TEXT NOT NULL,
    state_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES conversation_sessions(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_session ON conversation_messages(session_id);

CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_type ON audit_events(event_type);
