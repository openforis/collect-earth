-- Collect Earth Cloud — reference answers from a file: a coordinator uploads a reference set (a CSV
-- or JSON of answers keyed by plot id, columns named as the survey's questions, as Collect Earth
-- Online's reference data), and every collector's latest record of those plots is measured against
-- it ("disagreement with the reference", src/reference.ts externalReferenceFigures). One set per
-- project: an upload replaces it, and it can be deleted. Project data, RLS-fenced on
-- app.current_project like records (001); deleteProject deletes the rows. Idempotent.

CREATE TABLE IF NOT EXISTS reference_answers (
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The plot unit, as plot_assignments.plot_key.
  plot_key     TEXT NOT NULL,
  -- Summary key -> answer (a choice's code, a number as text).
  answers      JSONB NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, plot_key)
);

ALTER TABLE reference_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_answers_isolation ON reference_answers;
CREATE POLICY reference_answers_isolation ON reference_answers
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

-- The quality figures' version (009) follows the set: the figures against it are worked out again.
DROP TRIGGER IF EXISTS reference_answers_version_insert ON reference_answers;
CREATE TRIGGER reference_answers_version_insert AFTER INSERT ON reference_answers
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS reference_answers_version_update ON reference_answers;
CREATE TRIGGER reference_answers_version_update AFTER UPDATE ON reference_answers
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS reference_answers_version_delete ON reference_answers;
CREATE TRIGGER reference_answers_version_delete AFTER DELETE ON reference_answers
  REFERENCING OLD TABLE AS removed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_old();
