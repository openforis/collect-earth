-- Collect Earth Cloud — Phase 0 schema.
-- Tenant boundary = project. Every domain table carries project_id and is guarded
-- by Row-Level Security keyed on the per-request GUC `app.current_project`, set by
-- PostgresStore.withProject(). RLS is defence-in-depth on top of app-level scoping.

CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY,
  name         TEXT NOT NULL,
  survey_uri   TEXT,
  survey_name  TEXT,
  idml_base64  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phase 0 uses project-scoped tokens (admin + operator). Phase 1 replaces these
-- with per-user login tokens joined through project_members; the resolve-by-hash
-- contract stays identical, so the auth middleware does not change.
CREATE TABLE IF NOT EXISTS project_tokens (
  token_hash  TEXT PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'operator')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_tokens_project ON project_tokens(project_id);

CREATE TABLE IF NOT EXISTS records (
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  record_key     TEXT NOT NULL,
  operator       TEXT NOT NULL DEFAULT '',
  modified_on    TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL,
  actively_saved BOOLEAN NOT NULL DEFAULT false,
  step           INTEGER NOT NULL DEFAULT 0,
  xml            TEXT,
  summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted        BOOLEAN NOT NULL DEFAULT false,
  deleted_on     TIMESTAMPTZ,
  PRIMARY KEY (project_id, record_key, operator)
);
CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id) WHERE NOT deleted;

-- Row-Level Security: a session may only touch rows of the project named in
-- app.current_project. projects.id is compared to the GUC; child tables to their
-- project_id. project_tokens is intentionally NOT under RLS — it is the auth index
-- consulted before any project is known, and only ever queried by exact hash.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE records  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_isolation ON projects;
CREATE POLICY projects_isolation ON projects
  USING (id = current_setting('app.current_project', true)::uuid);

DROP POLICY IF EXISTS records_isolation ON records;
CREATE POLICY records_isolation ON records
  USING (project_id = current_setting('app.current_project', true)::uuid)
  WITH CHECK (project_id = current_setting('app.current_project', true)::uuid);
