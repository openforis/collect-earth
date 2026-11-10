-- Collect Earth Cloud — the shapes of a project made from a Collect Earth Online project, copied from CEO in steps
-- (src/ceo/shapes.ts, CeoShapesJob): the plots still to read and the shapes read so far, until the plot files have them.
-- Idempotent (migrations run on every boot).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS ceo_shapes JSONB;
