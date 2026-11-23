-- Collect Earth Cloud — a large file sent in parts (docs/plans/2026-11-11-backup-import.md, "70 MB").
-- A backup of a country's data is larger than one request may be (32 MB, and 23 MB of file once in
-- base64): the dashboard sends it in parts, each a request of its own, and the import reads them
-- together. Like sessions and password resets these are an account's, not a project's: they are NOT
-- under RLS, are only ever queried by their id together with their user, and hold no project DATA
-- until an import reads them. An upload lives a few hours at most: the next upload of anyone deletes
-- the expired ones, an import deletes its own, and each account keeps one.

CREATE TABLE IF NOT EXISTS uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bytes       BIGINT NOT NULL CHECK (bytes > 0),
  part_bytes  INTEGER NOT NULL CHECK (part_bytes > 0),
  name        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at);

CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id  UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  n          INTEGER NOT NULL CHECK (n >= 0),
  data       BYTEA NOT NULL,
  PRIMARY KEY (upload_id, n)
);
