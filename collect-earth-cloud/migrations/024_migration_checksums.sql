-- Collect Earth Cloud — the final review (Task 22, B4): the sha256 each migration file ran with,
-- so a boot skips the files applied and unchanged (runMigrations) and runs again one edited since.
-- Global, no project data. Idempotent.

ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
