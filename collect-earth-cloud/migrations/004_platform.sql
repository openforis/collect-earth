-- Collect Earth Cloud — platform administration for the web dashboard.
-- Platform admins, server settings, password resets and invite revocation.
-- Like 002, these are global auth/metadata tables (consulted before any project
-- context is known, or spanning users), so they are NOT under RLS and are only
-- ever queried by exact key. No project DATA lives here.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Key/value server settings edited by the platform admin (signupOpen,
-- projectCreation). A missing key means "use the default".
CREATE TABLE IF NOT EXISTS server_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Single-use password-reset links issued by a platform admin. Only the token hash
-- is stored, as for sessions and invites.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- Invites get a stable public id (the token itself is shown only at creation, and
-- its hash is the primary key) so an admin can list and revoke them.
ALTER TABLE invites ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_id ON invites(id);
ALTER TABLE invites ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
