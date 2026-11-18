-- Collect Earth Cloud — the survey designer's help from the AI assistant (POST
-- /v1/projects/:pid/survey/help, docs/plans/2026-11-18-survey-designer.md stage 4b): each request
-- is a run of its own kind, 'survey', counted against the project's AI limits as the analysis
-- views are. The model is sent the survey's structure only, never the data. Idempotent.

ALTER TABLE ai_runs DROP CONSTRAINT IF EXISTS ai_runs_kind_check;
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_kind_check CHECK (kind IN ('report', 'follow_up', 'question', 'views', 'survey'));
