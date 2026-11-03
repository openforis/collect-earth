-- Collect Earth Cloud — the username of a deleted account with records in one of its
-- projects is never given out again. Records keep their operator name after the
-- account is deleted, and the quality figures and the personal report go by that
-- name: a new account under the same username would see the old account's figures
-- as its own. A name without records is free again. A global table, like
-- users (002): not under RLS, queried only by exact key, no project data. Idempotent.

CREATE TABLE IF NOT EXISTS retired_usernames (
  username    TEXT PRIMARY KEY,
  retired_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deleting an account asks each of its projects whether it has records under the
-- username: without this index, a project's whole records table is read when it has
-- none (a sequential scan of 100k records, about 8 ms, per project).
CREATE INDEX IF NOT EXISTS idx_records_project_operator ON records(project_id, operator);
