-- Collect Earth Cloud — the uncertainty analysis's setup (src/uncertainty.ts, UncertaintySettings): which questions
-- give the land use at the start and at the end, the two years, each code's IPCC category, and the total area when the
-- project file has no areas file. Idempotent (migrations run on every boot).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS uncertainty_settings JSONB;
