-- Collect Earth Cloud — two-step sign-in (src/twoFactor.ts): an authenticator app's code after the password. One row per
-- account that set it up: the secret encrypted (AES-256-GCM, with a key from LINK_SECRET or DATABASE_URL), the secret
-- being set up until its first code is confirmed, the last time step used (a code is used once) and the recovery codes,
-- hashed and single-use. Not per project (accounts are global, as users and sessions are). Idempotent.

CREATE TABLE IF NOT EXISTS user_two_factor (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc      TEXT,
  pending_enc     TEXT,
  enabled_at      TIMESTAMPTZ,
  last_step       BIGINT,
  recovery_hashes TEXT[] NOT NULL DEFAULT '{}'
);
