-- Collect Earth Cloud — the strata and their areas, or one total area, set on the dashboard (src/areas.ts,
-- AreaSettings): what the plots' expansion factors are worked out from. NULL: the project file's areas file is read.
-- Idempotent (migrations run on every boot).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS area_settings JSONB;
