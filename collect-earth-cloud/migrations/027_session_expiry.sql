-- Collect Earth Cloud — sessions end after SESSION_IDLE_DAYS (60) days unused (security review, 2026-11).
-- They used to last until logout, a password change or the account being disabled, so a token copied from
-- a browser or a desktop's settings worked for good. A session in use is extended once a day
-- (resolveSession), so Collect Earth's background sync never has to log in again while it is used.
-- The sessions made before this get the 60 days from now. Idempotent (migrations run on every boot).

UPDATE sessions SET expires_at = now() + interval '60 days' WHERE expires_at IS NULL;
