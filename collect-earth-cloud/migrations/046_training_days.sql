-- Collect Earth Cloud — training the team before the work (docs/plans/2026-11-17-training-the-team.md):
-- a training set given to everyone in the project (and whoever joins), finished with its results kept and its records
-- deleted, and the plot ids of deleted sets retired, so that a record of them sent later never becomes the project's.
-- Idempotent.
ALTER TABLE training_sets ADD COLUMN IF NOT EXISTS everyone BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE training_sets ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE training_sets ADD COLUMN IF NOT EXISTS finished_by UUID REFERENCES users(id) ON DELETE SET NULL;
-- What is kept of a finished set (its figures and scores as they were), shown once its records are gone.
ALTER TABLE training_sets ADD COLUMN IF NOT EXISTS results JSONB;

CREATE TABLE IF NOT EXISTS training_retired_plots (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plot_key   TEXT NOT NULL,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, plot_key)
);

ALTER TABLE training_retired_plots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_retired_plots_isolation ON training_retired_plots;
CREATE POLICY training_retired_plots_isolation ON training_retired_plots
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
