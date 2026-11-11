-- Collect Earth Cloud — a repeat survey (docs/plans/2026-11-11-repeat-survey.md): a project made to collect the plots
-- of an earlier one again, years later, keeps that project's answers as an earlier period ("2020"), one record's
-- answers per plot, written once when the project is made and read-only after. They are not the project's records:
-- no progress, quality figure, export of its own data or sync counts them. Project data, RLS-fenced on
-- app.current_project like records (001); deleteProject deletes the rows. Idempotent.

CREATE TABLE IF NOT EXISTS period_answers (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The earlier period's label ("2020")
  label       TEXT NOT NULL,
  -- The plot, without its round (as the plot files' ids)
  plot_key    TEXT NOT NULL,
  -- Who collected it then (a username, or the name typed in Collect Earth)
  operator    TEXT NOT NULL,
  -- Summary key -> answer, as the record's summary, matched to this project's survey
  answers     JSONB NOT NULL,
  saved_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, label, plot_key)
);

ALTER TABLE period_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS period_answers_isolation ON period_answers;
CREATE POLICY period_answers_isolation ON period_answers
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

-- The repeat survey's settings: this period's label, the earlier periods (label, source project, plots), and the
-- questions the form's header shows of the earlier period (RepeatSettings, src/types.ts)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repeat_settings JSONB;
