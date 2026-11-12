-- Collect Earth Cloud — the server activity log: what server administrators did (settings changed, accounts made,
-- disabled, deleted, signed out, given a reset link, projects archived or handed to a coordinator, a test mail), for the
-- server page's System section (GET /v1/admin/activity). Global as users: no project data, a project by its id only.
-- The actor's and the target's usernames are kept as they were, so an entry still reads after the account is deleted.
-- Idempotent.

CREATE TABLE IF NOT EXISTS server_activity (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name     TEXT CHECK (char_length(actor_name) <= 100),
  action         TEXT NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$' AND char_length(action) <= 60),
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_name    TEXT CHECK (char_length(target_name) <= 100),
  project_id     UUID,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_server_activity_at ON server_activity(at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_server_activity_actor ON server_activity(actor_name, at DESC);
