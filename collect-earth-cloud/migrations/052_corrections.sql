-- Collect Earth Cloud — corrections (docs/plans/2026-11-20-review-at-scale.md, B1-B3). Idempotent.
-- 1. A fourth decision, 'correct' ("Correct it in Collect Earth"): the plot is corrected by someone a coordinator
--    assigns, in their own Collect Earth.
-- 2. quality_corrections: per plot unit decided 'correct', who it is assigned to (and by whom, when), and once
--    corrected the corrected record (its XML and summary, as records:batch takes them), by whom and when, and which
--    answer the form started from. Kept apart from records: a correction is no interpretation, so it never counts in
--    the agreement, the people's figures, the progress or anyone's plots; it is the plot's final answer (the export).

ALTER TABLE quality_decisions DROP CONSTRAINT IF EXISTS quality_decisions_decision_check;
ALTER TABLE quality_decisions ADD CONSTRAINT quality_decisions_decision_check CHECK (decision IN ('first', 'check', 'recheck', 'correct'));

CREATE TABLE IF NOT EXISTS quality_corrections (
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plot           TEXT NOT NULL CHECK (char_length(plot) BETWEEN 1 AND 1000),
  assigned_to    UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  corrected_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  corrected_at   TIMESTAMPTZ,
  -- the record the form started from (its operator), null when it started empty
  base_operator  TEXT,
  -- the corrected record's key (the plot's, as the record it started from)
  record_key     TEXT,
  xml            TEXT,
  summary        JSONB,
  PRIMARY KEY (project_id, plot),
  CHECK ((corrected_at IS NULL) = (xml IS NULL) AND (corrected_at IS NULL) = (record_key IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_quality_corrections_assigned ON quality_corrections(project_id, assigned_to);

ALTER TABLE quality_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_corrections_isolation ON quality_corrections;
CREATE POLICY quality_corrections_isolation ON quality_corrections
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
