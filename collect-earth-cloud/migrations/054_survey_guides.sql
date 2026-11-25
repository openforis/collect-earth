-- Collect Earth Cloud — a project's survey guide, kept apart from its project file (docs/plans/2026-11-25-survey-guide.md).
-- The guide (a PDF of how to interpret the plots: the IPCC demo survey's is 8 MB) travelled inside the project file,
-- which every person downloads and the server keeps twice. It is now a row here: the PDF itself, or a link to one kept
-- elsewhere; the project file carries only its address (survey_guide_url in project_definition.properties). A PDF is
-- served at /guide/<project>/<token>, with no login (Collect Earth opens it in a browser): the token is what guards it,
-- and it is kept as it is, since the address is written again into each project file. Project data, RLS-fenced on
-- app.current_project like records (001); ON DELETE CASCADE removes it with its project. Idempotent.

CREATE TABLE IF NOT EXISTS survey_guides (
  project_id  UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  -- the address people open: the server's own for a file, the coordinator's link otherwise
  url         TEXT NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2100),
  filename    TEXT NOT NULL DEFAULT '' CHECK (char_length(filename) <= 200),
  data        BYTEA,
  token       TEXT NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{20,}$'),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'file') = (data IS NOT NULL))
);

ALTER TABLE survey_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS survey_guides_isolation ON survey_guides;
CREATE POLICY survey_guides_isolation ON survey_guides
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
