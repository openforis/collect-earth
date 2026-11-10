-- Collect Earth Cloud — a sign-in unused for months stops working (src/auth.ts, SESSION_IDLE_MS; recommendation 1 of
-- the data review). last_used_at is written at most once an hour as the session is used; a session never used since
-- this migration counts from when it was made. Idempotent (migrations run on every boot).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
