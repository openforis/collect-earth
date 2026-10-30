-- Collect Earth Cloud — quality review: the coordinator's number margins, which
-- answer is right for a plot that differs (by plot unit, as the quality figures
-- pair records), and guidance notes for collectors. Project data, RLS-fenced on
-- app.current_project like plot_assignments. Idempotent.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS quality_settings JSONB;   -- {"margins": {"collect_real_x": 10}}

CREATE TABLE IF NOT EXISTS quality_decisions (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plot        TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('first', 'check', 'recheck')),
  comment     TEXT CHECK (comment IS NULL OR length(comment) <= 2000),
  decided_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, plot)
);

CREATE TABLE IF NOT EXISTS guidance_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question_key  TEXT NOT NULL,
  first_value   TEXT,
  check_value   TEXT,
  text          TEXT NOT NULL CHECK (length(text) <= 2000),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guidance_notes_project ON guidance_notes(project_id);

ALTER TABLE quality_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guidance_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quality_decisions_isolation ON quality_decisions;
CREATE POLICY quality_decisions_isolation ON quality_decisions
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

DROP POLICY IF EXISTS guidance_notes_isolation ON guidance_notes;
CREATE POLICY guidance_notes_isolation ON guidance_notes
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
