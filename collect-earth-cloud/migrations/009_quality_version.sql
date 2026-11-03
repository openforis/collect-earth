-- Collect Earth Cloud — the quality figures' version: a counter per project, bumped
-- by triggers on every INSERT, UPDATE and DELETE statement on records and
-- plot_assignments, whatever wrote it (the server, a script, a direct SQL fix). The
-- server reads it in one indexed lookup instead of hashing every record.
--
-- Statement-level triggers with transition tables: one UPDATE of projects per
-- statement and project, not one per row (a division writes up to 100k holdings in
-- a few statements).
--
-- The functions are SECURITY INVOKER (the default) on purpose: the trigger updates
-- projects as the role that changed the rows, under the same RLS. The app's
-- statements run with app.current_project set and RLS lets them touch only that
-- project's records and holdings, so the projects row they bump is the same one
-- the projects policy lets them update; nothing is run with more rights than the
-- statement had. (SECURITY DEFINER would bypass RLS for any project id that appears
-- in the changed rows, a needless widening.) A role that bypasses RLS (the owner, a
-- superuser) bumps whatever it changed. Idempotent.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS records_version BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_records_version_new() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A statement that changed no rows (a cascade from a deleted account in no project)
  -- touches no project: without this, the UPDATE still runs under the projects policy.
  IF NOT EXISTS (SELECT 1 FROM changed_rows) THEN
    RETURN NULL;
  END IF;
  UPDATE projects SET records_version = records_version + 1
   WHERE id IN (SELECT DISTINCT project_id FROM changed_rows);
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION bump_records_version_old() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A statement that changed no rows (a cascade from a deleted account in no project)
  -- touches no project: without this, the UPDATE still runs under the projects policy.
  IF NOT EXISTS (SELECT 1 FROM removed_rows) THEN
    RETURN NULL;
  END IF;
  UPDATE projects SET records_version = records_version + 1
   WHERE id IN (SELECT DISTINCT project_id FROM removed_rows);
  RETURN NULL;
END
$$;

-- A table's transition tables can name one event per trigger: three triggers each.
DROP TRIGGER IF EXISTS records_version_insert ON records;
CREATE TRIGGER records_version_insert AFTER INSERT ON records
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS records_version_update ON records;
CREATE TRIGGER records_version_update AFTER UPDATE ON records
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS records_version_delete ON records;
CREATE TRIGGER records_version_delete AFTER DELETE ON records
  REFERENCING OLD TABLE AS removed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_old();

DROP TRIGGER IF EXISTS plot_assignments_version_insert ON plot_assignments;
CREATE TRIGGER plot_assignments_version_insert AFTER INSERT ON plot_assignments
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS plot_assignments_version_update ON plot_assignments;
CREATE TRIGGER plot_assignments_version_update AFTER UPDATE ON plot_assignments
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_new();
DROP TRIGGER IF EXISTS plot_assignments_version_delete ON plot_assignments;
CREATE TRIGGER plot_assignments_version_delete AFTER DELETE ON plot_assignments
  REFERENCING OLD TABLE AS removed_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_records_version_old();
