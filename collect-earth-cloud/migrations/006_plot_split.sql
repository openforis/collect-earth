-- Collect Earth Cloud — dividing one plot file's plots between people.
-- A file is whole (distribution IS NULL: the assignments table applies) or divided
-- (distribution = the rule last applied: plot_assignments applies). Project data,
-- RLS-fenced on app.current_project like assignments. Idempotent.

ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS distribution JSONB;

CREATE TABLE IF NOT EXISTS plot_assignments (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  csv_file_id UUID NOT NULL REFERENCES csv_files(id) ON DELETE CASCADE,
  plot_key    TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overlap     BOOLEAN NOT NULL DEFAULT false,   -- given as a quality-check copy
  PRIMARY KEY (project_id, csv_file_id, plot_key, user_id)
);
CREATE INDEX IF NOT EXISTS idx_plot_assignments_user ON plot_assignments(project_id, user_id);

ALTER TABLE plot_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plot_assignments_isolation ON plot_assignments;
CREATE POLICY plot_assignments_isolation ON plot_assignments
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
