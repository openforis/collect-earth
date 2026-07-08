-- Collect Earth Cloud — Phase B: plot CSV files and per-operator assignments.
-- Both tables are project data and RLS-fenced on app.current_project.

CREATE TABLE IF NOT EXISTS csv_files (
  id          UUID PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  plot_count  INTEGER NOT NULL DEFAULT 0,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, filename)
);
CREATE INDEX IF NOT EXISTS idx_csv_files_project ON csv_files(project_id);

CREATE TABLE IF NOT EXISTS assignments (
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  csv_file_id  UUID NOT NULL REFERENCES csv_files(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, csv_file_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments(project_id, user_id);

ALTER TABLE csv_files   ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csv_files_isolation ON csv_files;
CREATE POLICY csv_files_isolation ON csv_files
  USING (project_id = current_setting('app.current_project', true)::uuid)
  WITH CHECK (project_id = current_setting('app.current_project', true)::uuid);

DROP POLICY IF EXISTS assignments_isolation ON assignments;
CREATE POLICY assignments_isolation ON assignments
  USING (project_id = current_setting('app.current_project', true)::uuid)
  WITH CHECK (project_id = current_setting('app.current_project', true)::uuid);
