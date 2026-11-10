-- Collect Earth Cloud — a project's lifecycle: draft (set up, collectors cannot sync yet), active,
-- closed (read-only: no syncs, no changes; reading and exports work) and archived (closed, out of
-- the normal project list, restorable). Existing projects are active. Idempotent (migrations run
-- on every boot).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('draft', 'active', 'closed', 'archived'));
