-- Live chat: patient <-> staff in-app chat sessions + message history.
-- Patient enters from the "Connect with Staff" purpose in the bot flow.

CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    -- Secret key returned to the patient at creation; authenticates the
    -- patient's WebSocket connection (patients have no login account).
    patient_key TEXT NOT NULL,
    -- Bot conversation the request came from (nullable: future direct entry).
    conversation_session_id TEXT,
    patient_title TEXT NOT NULL CHECK (patient_title IN ('Mr', 'Mrs', 'Ms')),
    patient_name TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
    -- Login account (users.id) of the staff member handling the session.
    staff_user_id INTEGER REFERENCES users(id),
    staff_name TEXT,
    closed_reason TEXT CHECK (closed_reason IN ('completed_by_staff', 'completed_by_patient', 'timeout')),
    last_patient_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_key ON chat_sessions(patient_key);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
-- One staff member handles at most one active session at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_staff_active
    ON chat_sessions(staff_user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS chat_session_messages (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES chat_sessions(id),
    sender TEXT NOT NULL CHECK (sender IN ('patient', 'staff', 'system')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_session_messages_session ON chat_session_messages(session_id);
