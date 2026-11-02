-- Collect Earth Cloud — pattern flags (Task 5): what a quality decision saw of the records
-- of its plot when it was made (each record's person and a hash of its answers, from the
-- quality figures at hand), so that "saved again after a decision" is only said of a
-- record whose answers changed since. Null: nothing kept (no figures at hand, or a
-- decision made before this). Idempotent.

ALTER TABLE quality_decisions ADD COLUMN IF NOT EXISTS seen JSONB;   -- [{"operator": "ana", "hash": 123456789}]
