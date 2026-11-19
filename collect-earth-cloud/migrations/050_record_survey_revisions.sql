-- Collect Earth Cloud — the survey a record was made with (docs/plans/2026-11-18-survey-designer.md, stage 6): Collect
-- Earth 2.0 sends the revision of its survey with each record (RecordEnvelope.surveyRevision), so that the designer can
-- say how many plots were last saved with an earlier version of the survey. Kept apart from the records (their rows
-- and statements stay as they are); a record's row is read through a join, a deleted one is not counted. Idempotent.
CREATE TABLE IF NOT EXISTS record_survey_revisions (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  record_key  TEXT NOT NULL,
  operator    TEXT NOT NULL,
  revision    TEXT NOT NULL,
  PRIMARY KEY (project_id, record_key, operator)
);

ALTER TABLE record_survey_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS record_survey_revisions_isolation ON record_survey_revisions;
CREATE POLICY record_survey_revisions_isolation ON record_survey_revisions
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
