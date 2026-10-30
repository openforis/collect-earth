-- Collect Earth Cloud — the project policies of 001-003 read an empty
-- app.current_project as "no project" instead of failing. A transaction-local
-- set_config leaves the setting as '' (not unset) on that pooled connection
-- afterwards, and ''::uuid is an error: any statement that reaches these tables
-- under RLS without setting the project (a cascade, a trigger that touches no
-- rows) failed instead of seeing nothing. 001-003 are on master and may already
-- be in a database, so the policies are replaced here; the later ones (006, 008,
-- 011) are written this way. Same rules, same names. Idempotent.

DROP POLICY IF EXISTS projects_isolation ON projects;
CREATE POLICY projects_isolation ON projects
  USING (id = NULLIF(current_setting('app.current_project', true), '')::uuid);

DROP POLICY IF EXISTS records_isolation ON records;
CREATE POLICY records_isolation ON records
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

DROP POLICY IF EXISTS project_ceps_isolation ON project_ceps;
CREATE POLICY project_ceps_isolation ON project_ceps
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

DROP POLICY IF EXISTS csv_files_isolation ON csv_files;
CREATE POLICY csv_files_isolation ON csv_files
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

DROP POLICY IF EXISTS assignments_isolation ON assignments;
CREATE POLICY assignments_isolation ON assignments
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
