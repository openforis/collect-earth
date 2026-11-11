-- Collect Earth Cloud — Turkish ('tr') joins the mail languages (MAIL_LANGUAGES, src/types.ts) of 023.
-- Idempotent (migrations run on every boot): the constraint is replaced as a whole.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_mail_language_check;
ALTER TABLE users ADD CONSTRAINT users_mail_language_check CHECK (mail_language IN ('en', 'es', 'fr', 'pt', 'tr'));
