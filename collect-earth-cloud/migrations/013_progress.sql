-- Collect Earth Cloud — the Progress tab: each project's progress settings (an optional
-- deadline and target, and after how many days someone counts as quiet), next to the
-- quality settings (008), and an index for "old unsent work" (the record events
-- received lately, per project). Idempotent.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress_settings JSONB;   -- {"deadline": "2026-12-31", "targetPlots": 1200, "quietDays": 3}

CREATE INDEX IF NOT EXISTS idx_record_events_project_received ON record_events(project_id, received_at);
