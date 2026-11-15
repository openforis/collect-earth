-- Collect Earth Cloud — "someone joined your project": the mail each coordinator gets when a person joins one of
-- their projects with an invitation link (src/joinMail.ts). On unless the coordinator turns it off (Account page, or
-- the mail's unsubscribe link): join_mail_off. Account data, global as users (023): not under RLS. Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS join_mail_off BOOLEAN NOT NULL DEFAULT false;
