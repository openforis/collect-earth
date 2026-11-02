-- Collect Earth Cloud — the review queue (Task 7, after review): the bulk run that made a
-- decision (the id in its decision.bulk audit entry), so a bulk run can be found, and later
-- undone, as a whole. Null for a decision made alone (a later single decision clears it).
-- Idempotent.

ALTER TABLE quality_decisions ADD COLUMN IF NOT EXISTS decided_batch UUID;
CREATE INDEX IF NOT EXISTS idx_quality_decisions_batch ON quality_decisions(project_id, decided_batch) WHERE decided_batch IS NOT NULL;
