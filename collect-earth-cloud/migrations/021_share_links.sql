-- Collect Earth Cloud — read-only progress links for funders (Task 18). A coordinator makes a
-- link (/p/<token>) that shows the project's name, totals, progress chart, forecast and one
-- quality figure, with no login. Only the sha256 of the token is kept (as sessions and
-- invites); a link works until it is revoked. Project data, RLS-fenced on app.current_project
-- like records (001); deleteProject deletes the rows. Idempotent (migrations run on every boot).

CREATE TABLE IF NOT EXISTS share_links (
  id           UUID PRIMARY KEY,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- sha256 of the 32-byte random token, in hex.
  token_hash   TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- The coordinator's note to tell links apart ("For the donor"); never shown on the page.
  label        TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 100),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_share_links_project ON share_links(project_id, created_at);

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS share_links_isolation ON share_links;
CREATE POLICY share_links_isolation ON share_links
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

-- The page opens a link before any project is known, so the app role (bound by RLS) cannot
-- find it by its hash. This function, owned by the tables' owner (who runs the migrations and is
-- not bound by RLS, the tables not being FORCE ROW LEVEL SECURITY), answers one question: which
-- link and project a hash of a link not revoked belongs to. It returns those two ids and nothing
-- else; an unknown hash and a revoked one both give no row. Everything the page then reads is read
-- under that project's app.current_project, as any other request. search_path is fixed, so no
-- object of another schema can stand in for share_links.
CREATE OR REPLACE FUNCTION share_link_lookup(hash TEXT)
RETURNS TABLE (link_id UUID, link_project UUID)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT l.id, l.project_id FROM public.share_links l WHERE l.token_hash = hash AND l.revoked_at IS NULL
$$;

-- Only the server may call it: no right for PUBLIC (functions get EXECUTE for PUBLIC by default);
-- prepareAppRole grants EXECUTE to the app role on every boot. Repeating the REVOKE is harmless.
REVOKE ALL ON FUNCTION share_link_lookup(TEXT) FROM PUBLIC;
