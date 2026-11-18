-- Collect Earth Cloud — the survey designer (docs/plans/2026-11-18-survey-designer.md, stage 2): each change made in
-- the dashboard keeps the survey as it was before, so that it can be brought back. The served project file's survey
-- and, when the server serves a changed copy, the uploaded file's, gzipped. Kept for the project file of the moment
-- (a new upload deletes them) and the last 20 only (SURVEY_VERSIONS_KEPT, src/types.ts). Idempotent.
CREATE TABLE IF NOT EXISTS survey_versions (
  id           UUID PRIMARY KEY,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  changes      INTEGER NOT NULL,
  restored_from UUID,
  survey_gz    BYTEA NOT NULL,
  original_gz  BYTEA
);
CREATE INDEX IF NOT EXISTS survey_versions_project ON survey_versions (project_id, created_at DESC);

ALTER TABLE survey_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS survey_versions_isolation ON survey_versions;
CREATE POLICY survey_versions_isolation ON survey_versions
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
