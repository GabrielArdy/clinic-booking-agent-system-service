-- Auth module: groups / roles / positions masters, user accounts,
-- role assignments, and opaque bearer sessions.

CREATE TABLE IF NOT EXISTS master_groups (
    id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) NOT NULL,
    group_code VARCHAR(50) NOT NULL,
    group_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (group_status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_groups_code ON master_groups(group_code);

-- App-level permissions. Endpoints are guarded by role_code; group_code marks
-- which group the role is granted to by default when creating a user.
CREATE TABLE IF NOT EXISTS master_roles (
    id SERIAL PRIMARY KEY,
    role_code VARCHAR(50) NOT NULL,
    role_name VARCHAR(100) NOT NULL,
    description TEXT,
    group_code VARCHAR(50) NOT NULL REFERENCES master_groups(group_code),
    role_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (role_status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_roles_code ON master_roles(role_code);

CREATE TABLE IF NOT EXISTS master_position (
    id SERIAL PRIMARY KEY,
    position_code VARCHAR(50) NOT NULL,
    position_name VARCHAR(100) NOT NULL,
    group_code VARCHAR(50) NOT NULL REFERENCES master_groups(group_code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_position_code ON master_position(position_code);
CREATE INDEX IF NOT EXISTS idx_master_position_group ON master_position(group_code);

-- Login accounts. doctor_id / staff_id link the account to its clinic entity
-- (used for data scoping, e.g. a doctor only sees their own appointments).
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    position_code VARCHAR(50) NOT NULL REFERENCES master_position(position_code),
    doctor_id INTEGER REFERENCES doctors(id),
    staff_id INTEGER REFERENCES staff(id),
    user_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (user_status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_doctor ON users(doctor_id);
CREATE INDEX IF NOT EXISTS idx_users_staff ON users(staff_id);

-- Transactional: role assignments per user.
CREATE TABLE IF NOT EXISTS user_roles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role_code VARCHAR(50) NOT NULL REFERENCES master_roles(role_code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique ON user_roles(user_id, role_code);

-- Opaque bearer tokens (server-side sessions).
CREATE TABLE IF NOT EXISTS auth_sessions (
    id SERIAL PRIMARY KEY,
    token TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
