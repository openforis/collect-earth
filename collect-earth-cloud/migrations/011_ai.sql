-- Collect Earth Cloud — the AI assistant: each project's switch (off by default; it
-- also needs the server to be set up for Vertex AI and switched on by the server
-- owner), and a record of every run: who started it, when, the tools it called (names
-- and checked arguments only), the tokens it spent, and its checked result. Refused
-- questions are runs too (status 'refused'). Project data, RLS-fenced on
-- app.current_project like quality_decisions (008). Idempotent.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS ai_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('report', 'follow_up', 'question')),
  started_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'refused')),
  model          TEXT NOT NULL,
  input_tokens   BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens  BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  tool_calls     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{"name": "get_confusions", "args": {"question": "..."}}]
  result         JSONB,
  error          TEXT,
  parent_run     UUID REFERENCES ai_runs(id) ON DELETE CASCADE,
  finding_index  INT CHECK (finding_index IS NULL OR finding_index >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_project_started ON ai_runs(project_id, started_at);

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_runs_isolation ON ai_runs;
CREATE POLICY ai_runs_isolation ON ai_runs
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
