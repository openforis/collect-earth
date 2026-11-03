-- Collect Earth Cloud — the bell (Task 10): which "needs attention" items each coordinator has
-- read. An item's key is its kind and a hash of what it says (its people and count), so an item
-- whose content changes is unread again. Project data, RLS-fenced on app.current_project like
-- records (001); the rows go with the membership (removeMember, deleteUser, deleteProject also
-- delete them). Idempotent.

CREATE TABLE IF NOT EXISTS attention_reads (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL CHECK (char_length(item_key) <= 100),
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, item_key),
  FOREIGN KEY (project_id, user_id) REFERENCES project_members(project_id, user_id) ON DELETE CASCADE
);

ALTER TABLE attention_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attention_reads_isolation ON attention_reads;
CREATE POLICY attention_reads_isolation ON attention_reads
  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);
