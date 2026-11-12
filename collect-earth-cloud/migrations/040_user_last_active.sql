-- Collect Earth Cloud — when each account last used the server: a sign-in, or a session used (the dashboard or Collect
-- Earth), for the server page's accounts (GET /v1/admin/users). Written with the session's use, at most once per
-- SESSION_TOUCH_MS (src/auth.ts). Idempotent (migrations run on every boot): filled once from the sessions there are.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

UPDATE users u SET last_active_at = s.at
  FROM (SELECT user_id, MAX(COALESCE(last_used_at, created_at)) AS at FROM sessions GROUP BY user_id) s
 WHERE s.user_id = u.id AND (u.last_active_at IS NULL OR u.last_active_at < s.at);
