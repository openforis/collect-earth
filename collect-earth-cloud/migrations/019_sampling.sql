-- Collect Earth Cloud — automatic check sampling (Task 13). A project's rule (which plots of
-- its divided files get a quality check, and who may check), when a draw is due and the last
-- one; and which copies of plot_assignments a draw added (sampled_at), so the plot file page
-- tells them from the division's copies and a new division keeps them. Project data,
-- RLS-fenced on app.current_project like records (001); deleteProject deletes the row.
-- Idempotent (migrations run on every boot).

ALTER TABLE plot_assignments ADD COLUMN IF NOT EXISTS sampled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sampling_rules (
  project_id        UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  -- { checkers, firstN, percent, seed, files }: user and file ids and numbers only.
  rule              JSONB NOT NULL,
  -- Whether the rule can draw anything (a rule with both parts off is kept, inactive).
  active            BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A draw is due since then (a first submission stored, or the rule saved); null: none due.
  due_since         TIMESTAMPTZ,
  -- When the last automatic draw was claimed: at most one per project per interval.
  last_auto_draw_at TIMESTAMPTZ,
  -- The last draw: when, by whom (a user id, or automatic), and its counts.
  last_draw         JSONB
);

ALTER TABLE sampling_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sampling_rules_isolation ON sampling_rules;
CREATE POLICY sampling_rules_isolation ON sampling_rules
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
