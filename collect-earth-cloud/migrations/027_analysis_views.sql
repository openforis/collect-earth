-- Collect Earth Cloud — the analysis page's views a coordinator shares with the team (web/src/analysisView.ts):
-- [{"name", "table", "language", "config", "savedBy", "savedAt"}], the config being Perspective's, as the page saves
-- it. Idempotent (migrations run on every boot).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS analysis_views JSONB;
