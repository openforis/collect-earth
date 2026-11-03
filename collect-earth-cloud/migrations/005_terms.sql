-- Collect Earth Cloud — terms of use. The account limits and the terms / contact /
-- server name settings are key/value rows of server_settings (004); only the moment
-- a user accepted the terms at sign-up needs a column. Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
