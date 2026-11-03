-- Collect Earth Cloud — the server owner's panel (Task 11).
-- 1. Disabled accounts: users is a global table (002), not under RLS, read by exact key or,
--    for the platform admin, as counts and the account list; no project data here. A disabled
--    account cannot log in; its sessions and reset links are deleted when it is disabled.
--    disabled_by is the platform admin who did it (gone with that account: SET NULL).
-- 2. Records received per day: record_events read by received_at, project by project under
--    each project's RLS setting; this index keeps that from reading every event of a project.
-- 3. schema_migrations: which migration files ran (runMigrations records them after running
--    them all; the files are idempotent and run on every boot). Global, no project data.
-- Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_record_events_project_received ON record_events(project_id, received_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name             TEXT PRIMARY KEY,
  first_applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
