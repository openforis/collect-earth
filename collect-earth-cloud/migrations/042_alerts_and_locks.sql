-- Collect Earth Cloud — the server page's safety (stage D of docs/plans/2026-11-12-server-admin.md). Idempotent.
-- 1. owner_alerts: the alerts raised for the server's administrators (src/ownerAlerts.ts), kept so the page shows their
--    history across restarts and instances, and which were seen (and by whom). A project by its id only. Global as users.
-- 2. users.failed_logins / users.locked_until: failed sign-ins in a row, and the lock they set when the server's
--    loginLockFailures is reached (sign-up rules). A right password, a reset link or an administrator clears both.

CREATE TABLE IF NOT EXISTS owner_alerts (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT NOT NULL CHECK (kind ~ '^[a-z_]+$' AND char_length(kind) <= 40),
  count       INTEGER NOT NULL CHECK (count >= 0),
  project_id  UUID,
  seen_at     TIMESTAMPTZ,
  seen_by     UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_at ON owner_alerts(at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_unseen ON owner_alerts(at DESC) WHERE seen_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0 CHECK (failed_logins >= 0);
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
