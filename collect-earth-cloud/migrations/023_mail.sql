-- Collect Earth Cloud — email digests (Task 19).
-- 1. An account's email is confirmed by a link sent to it (email_confirmed_at, cleared whenever the
--    email changes), and the mails are written in the language and time zone the person chose when
--    they asked for them (the dashboard's language lives only in their browser otherwise).
-- 2. digest_subscriptions: who asked for which weekly mail ('coordinator': the weekly summary of the
--    projects they coordinate; 'collector': their own week). Off unless a row exists. last_sent_week
--    is the ISO week (YYYY-Www) last sent, so a retried job never sends a week twice.
-- Both are account data, global as users (002/018): not under RLS, read by the account's id or, by
-- the digest job, as the list of subscriptions; no project data here. Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mail_language TEXT CHECK (mail_language IN ('en', 'es', 'fr', 'pt'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS mail_time_zone TEXT CHECK (char_length(mail_time_zone) <= 100);

CREATE TABLE IF NOT EXISTS digest_subscriptions (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('coordinator', 'collector')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_week TEXT CHECK (last_sent_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  last_sent_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, kind)
);
