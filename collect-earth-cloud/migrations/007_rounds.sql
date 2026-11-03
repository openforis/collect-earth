-- Collect Earth Cloud — the project file the server serves, and the one uploaded.
-- When the server adds the round key to an id-only survey, project_ceps.data holds
-- the served file and cep_original the upload (NULL when the two are the same).
-- round_info is what the server did about round (RoundInfo, src/cep.ts). Same row,
-- so the existing RLS policy on project_ceps covers both. Idempotent.

ALTER TABLE project_ceps ADD COLUMN IF NOT EXISTS cep_original BYTEA;
ALTER TABLE project_ceps ADD COLUMN IF NOT EXISTS round_info JSONB;
