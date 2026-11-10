-- Collect Earth Cloud — the analysis page's views proposed by the AI assistant (POST
-- /v1/projects/:pid/analysis/proposals): each request is a run of its own kind, 'views', so it
-- counts against the project's AI limits (one run at a time, the day's follow-ups and questions,
-- the month's tokens) as the other runs do. The model is sent the survey's structure only, never
-- the data. Idempotent (migrations run on every boot).

ALTER TABLE ai_runs DROP CONSTRAINT IF EXISTS ai_runs_kind_check;
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_kind_check CHECK (kind IN ('report', 'follow_up', 'question', 'views'));
