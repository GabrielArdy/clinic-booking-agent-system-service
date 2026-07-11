-- Auth module: groups / roles / positions masters, user accounts,
-- role assignments, and opaque bearer sessions.

CREATE TABLE master_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name TEXT NOT NULL, -- varchar(100) e.g. 'Admin', 'Doctor', 'Staff'
    group_code TEXT NOT NULL, -- varchar(50) e.g. 'AD100', 'DOC100', 'STF100'
    group_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (group_status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);
CREATE UNIQUE INDEX idx_master_groups_code ON master_groups(group_code);

-- App-level permissions. Endpoints are guarded by role_code; group_code marks
-- which group the role is granted to by default when creating a user.
CREATE TABLE master_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_code TEXT NOT NULL, -- varchar(50) e.g. 'CMS_CLINIC', 'DOC_APPOINTMENT'
    role_name TEXT NOT NULL, -- varchar(100)
    description TEXT,
    group_code TEXT NOT NULL REFERENCES master_groups(group_code),
    role_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (role_status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);
CREATE UNIQUE INDEX idx_master_roles_code ON master_roles(role_code);

CREATE TABLE master_position (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_code TEXT NOT NULL, -- varchar(50) e.g. 'A001', 'D001', 'D012', 'P001'
    position_name TEXT NOT NULL, -- varchar(100) e.g. 'IT Head Clinic', 'General Doctor'
    group_code TEXT NOT NULL REFERENCES master_groups(group_code),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);
CREATE UNIQUE INDEX idx_master_position_code ON master_position(position_code);
CREATE INDEX idx_master_position_group ON master_position(group_code);

-- Login accounts. doctor_id / staff_id link the account to its clinic entity
-- (used for data scoping, e.g. a doctor only sees their own appointments).
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    position_code TEXT NOT NULL REFERENCES master_position(position_code),
    doctor_id INTEGER REFERENCES doctors(id),
    staff_id INTEGER REFERENCES staff(id),
    user_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (user_status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_doctor ON users(doctor_id);
CREATE INDEX idx_users_staff ON users(staff_id);

-- Transactional: role assignments per user.
CREATE TABLE user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role_code TEXT NOT NULL REFERENCES master_roles(role_code),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_user_roles_unique ON user_roles(user_id, role_code);

-- Opaque bearer tokens (server-side sessions).
CREATE TABLE auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL, -- ISO datetime
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
);
CREATE UNIQUE INDEX idx_auth_sessions_token ON auth_sessions(token);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
