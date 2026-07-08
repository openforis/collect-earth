-- Collect Earth Cloud — Phase A: accounts, sessions, memberships, invites, CEP storage.
-- These auth/metadata tables are global (not project-scoped): they are consulted
-- before any project context is known (login, invite lookup) or span projects for
-- a single user (a user's memberships). They are therefore NOT under RLS and are
-- only ever queried by exact key or by the caller's own user_id. The project DATA
-- tables (projects, records, project_ceps) remain RLS-fenced.

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'operator')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

CREATE TABLE IF NOT EXISTS invites (
  token_hash  TEXT PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'operator')),
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invites_project ON invites(project_id);

-- CEP zip (project bundle) stored as a blob; small enough for Postgres in Phase A.
-- Production may move this to GCS behind the same GET endpoint.
CREATE TABLE IF NOT EXISTS project_ceps (
  project_id  UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  data        BYTEA NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_ceps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_ceps_isolation ON project_ceps;
CREATE POLICY project_ceps_isolation ON project_ceps
  USING (project_id = current_setting('app.current_project', true)::uuid)
  WITH CHECK (project_id = current_setting('app.current_project', true)::uuid);
