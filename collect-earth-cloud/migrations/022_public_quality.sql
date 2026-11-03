-- Collect Earth Cloud — the progress link's quality figure (Task 18 review, Decision 9). Whenever the
-- quality figures are worked out for a project, the server stores every check so far compared with its
-- first assessment ({ compared, agreeing, rate, computedAt }), so a progress link reads it from the
-- database on any instance, after a restart too, and never makes the server compute for someone outside
-- the project. Null until the figures were first worked out. Under the projects policy as the rest of
-- the row. Idempotent.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS public_quality JSONB;
