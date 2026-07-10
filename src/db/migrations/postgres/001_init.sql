CREATE TABLE specialties (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE doctors (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    specialty_id INTEGER NOT NULL REFERENCES specialties(id),
    active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_doctors_specialty ON doctors(specialty_id);

-- Recurring weekly availability. weekday: 0 = Sunday .. 6 = Saturday.
CREATE TABLE doctor_schedule_rules (
    id SERIAL PRIMARY KEY,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes > 0)
);

CREATE INDEX idx_schedule_rules_doctor ON doctor_schedule_rules(doctor_id, weekday);

-- Date-specific unavailability. NULL start/end = whole day blocked.
CREATE TABLE doctor_schedule_exceptions (
    id SERIAL PRIMARY KEY,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    reason TEXT
);

CREATE INDEX idx_schedule_exceptions_doctor_date ON doctor_schedule_exceptions(doctor_id, date);

CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ
);

-- Anti-double-booking: only one ACTIVE booking per doctor/date/start slot.
CREATE UNIQUE INDEX idx_bookings_unique_active_slot
    ON bookings(doctor_id, date, start_time)
    WHERE status = 'active';

CREATE INDEX idx_bookings_patient ON bookings(patient_id);
CREATE INDEX idx_bookings_doctor_date ON bookings(doctor_id, date);

CREATE TABLE conversation_sessions (
    id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    state_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES conversation_sessions(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_session ON conversation_messages(session_id);

CREATE TABLE audit_events (
    id SERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_type ON audit_events(event_type);
