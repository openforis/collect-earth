-- Collect Earth Cloud — the mails "someone joined your project" grouped (src/joinMail.ts): for each coordinator and
-- project, the first join is mailed at once (last_sent_at); the joins in the hour after it wait in `pending` and go
-- in one mail when the hour is over. `pending` holds ids and counts only ({ userId, role, given: { csvFileId, mode,
-- plots } | null, at }), never a name: the mail reads the names under the project when it is written. Kept with the
-- account data (023's digest_subscriptions), read by the coordinator's id; not under RLS. Idempotent.
CREATE TABLE IF NOT EXISTS join_mail_queue (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL,
  pending      JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_join_mail_queue_due ON join_mail_queue(last_sent_at) WHERE pending <> '[]'::jsonb;
