-- Collect Earth Cloud — activity data, for following the work: every stored upload of
-- a record (record_events), when and how much each member uses the project
-- (member_activity), and the coordinators' actions (audit_log). No XML and no
-- answers, except the summary of a `submitted` event (what changed, in a review).
-- Project data, RLS-fenced on app.current_project like records (001). Kept for the
-- life of the project. Idempotent.

-- One row per stored upload of a record, written in the same transaction as the record;
-- stale uploads (last-write-wins) and the same save sent again are not logged. `change`
-- is derived from the row before, the new one and whether the record was submitted
-- before (recordChange, src/lww.ts): `submitted` is a record's first submission.
CREATE TABLE IF NOT EXISTS record_events (
  id             BIGSERIAL PRIMARY KEY,
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  record_key     TEXT NOT NULL,
  operator       TEXT NOT NULL DEFAULT '',
  modified_on    TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL,
  actively_saved BOOLEAN NOT NULL DEFAULT false,
  step           INTEGER NOT NULL DEFAULT 0,
  deleted        BOOLEAN NOT NULL DEFAULT false,
  change         TEXT NOT NULL CHECK (change IN ('created', 'updated', 'submitted', 'resubmitted', 'unsubmitted', 'deleted')),
  summary        JSONB CHECK (summary IS NULL OR change IN ('submitted', 'resubmitted'))
);
CREATE INDEX IF NOT EXISTS idx_record_events_project_modified ON record_events(project_id, modified_on);
CREATE INDEX IF NOT EXISTS idx_record_events_project_operator_modified ON record_events(project_id, operator, modified_on);
-- Was the record submitted before (each upload asks).
CREATE INDEX IF NOT EXISTS idx_record_events_record ON record_events(project_id, record_key, operator);

-- Backfill: one event per record stored before this table, at its modified_on, with
-- the change a first upload of it would have had (so a submitted plot counts as
-- submitted). Only while the table is empty: migrations run on every boot, and once
-- the server logs uploads the table is never empty again. Run as the tables' owner,
-- which RLS does not bind, so every project's records are read.
INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change, summary)
SELECT r.project_id, r.record_key, r.operator, r.modified_on, r.received_at, r.actively_saved, r.step, r.deleted,
       CASE WHEN r.deleted THEN 'deleted' WHEN r.actively_saved THEN 'submitted' ELSE 'created' END,
       CASE WHEN NOT r.deleted AND r.actively_saved THEN r.summary END
  FROM records r
 WHERE NOT EXISTS (SELECT 1 FROM record_events);

-- Per member of a project. Written coalesced (src/activity.ts: at most once a minute
-- per member and server instance); the times only move forward and the counters add
-- up. client_agent is the raw User-Agent of the member's last Collect Earth call. The
-- row goes with the membership.
CREATE TABLE IF NOT EXISTS member_activity (
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at           TIMESTAMPTZ,
  last_sync_at           TIMESTAMPTZ,
  last_plots_download_at TIMESTAMPTZ,
  last_cep_download_at   TIMESTAMPTZ,
  syncs_count            BIGINT NOT NULL DEFAULT 0 CHECK (syncs_count >= 0),
  records_received       BIGINT NOT NULL DEFAULT 0 CHECK (records_received >= 0),
  client_agent           TEXT CHECK (client_agent IS NULL OR char_length(client_agent) <= 200),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id, user_id) REFERENCES project_members(project_id, user_id) ON DELETE CASCADE
);

-- Coordinator actions; details holds ids and counts only, never answers. An actor who
-- leaves the project (or whose account is deleted) is set to NULL; the entry stays.
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  -- The actions (AUDIT_ACTIONS, src/types.ts, later tasks' too); named, so a later
  -- migration can drop and widen it.
  action         TEXT NOT NULL CONSTRAINT audit_log_action_check CHECK (action IN (
                   'invite.created', 'invite.revoked', 'member.removed', 'member.anonymized', 'member.signed_out', 'member.role', 'cep.replaced',
                   'csv.uploaded', 'assignments.set', 'division.applied', 'plots.moved', 'decision.set',
                   'decision.deleted', 'settings.changed', 'export.downloaded', 'survey.replaced', 'sampling.drawn',
                   'reference.changed', 'link.created', 'link.revoked', 'training.changed', 'training.synced')),
  details        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_log_project_at ON audit_log(project_id, at);
-- An actor who leaves (removeMember) or whose account goes (ON DELETE SET NULL).
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id);

ALTER TABLE record_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS record_events_isolation ON record_events;
CREATE POLICY record_events_isolation ON record_events
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

DROP POLICY IF EXISTS member_activity_isolation ON member_activity;
CREATE POLICY member_activity_isolation ON member_activity
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);

DROP POLICY IF EXISTS audit_log_isolation ON audit_log;
CREATE POLICY audit_log_isolation ON audit_log
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
