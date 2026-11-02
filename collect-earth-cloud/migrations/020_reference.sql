-- Collect Earth Cloud — reference plots (Task 14). Plots of a divided file that a reference
-- assessor (a coordinator or reviewer the coordinator picks) assesses and every collector
-- checks blind: each collector holds a copy (plot_assignments, overlap) of each one, so a copy
-- of a plot listed here is a reference copy (told apart from the division's copies and the
-- drawn ones, sampled_at, by this table). Their checks are measured against the reference
-- assessment ("accuracy against the reference") and left out of the agreement figures.
-- Project data, RLS-fenced on app.current_project like records (001); deleteProject deletes
-- the rows. Idempotent (migrations run on every boot).

CREATE TABLE IF NOT EXISTS reference_plots (
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  csv_file_id       UUID NOT NULL REFERENCES csv_files(id) ON DELETE CASCADE,
  -- The plot unit, as plot_assignments.plot_key.
  plot_key          TEXT NOT NULL,
  -- Whose first assessment is the reference: they hold the plot as main in the file.
  assessor_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (project_id, csv_file_id, plot_key)
);

ALTER TABLE reference_plots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_plots_isolation ON reference_plots;
CREATE POLICY reference_plots_isolation ON reference_plots
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

-- The quality figures' version (009) follows the reference set too: marking a plot changes
-- what the figures leave out and measure, even when no holding changed.
DROP TRIGGER IF EXISTS reference_plots_version_insert ON reference_plots;
CREATE TRIGGER reference_plots_version_insert AFTER INSERT ON reference_plots
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS reference_plots_version_update ON reference_plots;
CREATE TRIGGER reference_plots_version_update AFTER UPDATE ON reference_plots
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS reference_plots_version_delete ON reference_plots;
CREATE TRIGGER reference_plots_version_delete AFTER DELETE ON reference_plots
  REFERENCING OLD TABLE AS removed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_old();
