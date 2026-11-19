-- Collect Earth Cloud — the survey designer (docs/plans/2026-11-18-survey-designer.md, "After the review"): each kept
-- version records the revision of the survey its change wrote, so that the designer can tell a survey last written by
-- a save of its own (another coordinator's) from one replaced by a new project file (whose upload drops the versions)
-- or changed by the server. Null for the versions kept before. Idempotent.
ALTER TABLE survey_versions ADD COLUMN IF NOT EXISTS revision_after TEXT;
