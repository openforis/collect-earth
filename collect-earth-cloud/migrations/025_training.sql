-- Collect Earth Cloud — training: calibration and learning plots
-- (docs/plans/2026-11-04-calibration-and-learning-plots.md). A training set is its own plot file,
-- given whole to its participants; the records of its plots are kept in training_records, apart
-- from the project's records, so no production figure, export or check ever reads them. Project
-- data, RLS-fenced on app.current_project like records (001); deleteProject deletes the rows.
-- Idempotent (migrations run on every boot).

CREATE TABLE IF NOT EXISTS training_sets (
  id          UUID PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('calibration', 'learning')),
  name        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  data        BYTEA NOT NULL,
  checksum    TEXT NOT NULL,
  -- Its plot ids (units, as plot_assignments.plot_key), in file order.
  plot_keys   TEXT[] NOT NULL,
  pass_mark   INTEGER CHECK (pass_mark IS NULL OR (pass_mark BETWEEN 0 AND 100)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_sets_project ON training_sets(project_id);

-- Participants: each gets the whole set as a plot file.
CREATE TABLE IF NOT EXISTS training_members (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  set_id      UUID NOT NULL REFERENCES training_sets(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, user_id)
);

-- The golden interpretation of a plot: question key -> answer, and the coordinator's explanation.
CREATE TABLE IF NOT EXISTS training_golden (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  set_id      UUID NOT NULL REFERENCES training_sets(id) ON DELETE CASCADE,
  plot_key    TEXT NOT NULL,
  answers     JSONB NOT NULL DEFAULT '{}'::jsonb,
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (set_id, plot_key)
);

-- Attempts: a record counts for the open one (results NULL) when submitted at or after started_at;
-- a closed one keeps a snapshot of its scores and answers.
CREATE TABLE IF NOT EXISTS training_attempts (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  set_id      UUID NOT NULL REFERENCES training_sets(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL CHECK (number >= 1),
  started_at  TIMESTAMPTZ NOT NULL,
  results     JSONB,
  PRIMARY KEY (set_id, user_id, number)
);

-- The records of training plots, as records (001) without events.
CREATE TABLE IF NOT EXISTS training_records (
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  record_key     TEXT NOT NULL,
  operator       TEXT NOT NULL DEFAULT '',
  modified_on    TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL,
  actively_saved BOOLEAN NOT NULL DEFAULT false,
  step           INTEGER NOT NULL DEFAULT 0,
  xml            TEXT,
  summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted        BOOLEAN NOT NULL DEFAULT false,
  deleted_on     TIMESTAMPTZ,
  PRIMARY KEY (project_id, record_key, operator)
);

ALTER TABLE training_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_golden ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_sets_isolation ON training_sets;
CREATE POLICY training_sets_isolation ON training_sets
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
DROP POLICY IF EXISTS training_members_isolation ON training_members;
CREATE POLICY training_members_isolation ON training_members
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
DROP POLICY IF EXISTS training_golden_isolation ON training_golden;
CREATE POLICY training_golden_isolation ON training_golden
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
DROP POLICY IF EXISTS training_attempts_isolation ON training_attempts;
CREATE POLICY training_attempts_isolation ON training_attempts
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
DROP POLICY IF EXISTS training_records_isolation ON training_records;
CREATE POLICY training_records_isolation ON training_records
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
