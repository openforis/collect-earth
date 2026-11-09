-- Collect Earth Cloud — the AI tokens each person spent, by month, kept when a project is deleted (security
-- review, 2026-11). The monthly limit was counted from the project's own runs (011), which go with the
-- project: deleting a project and making a new one started a fresh allowance, billed to the server owner's
-- Google account. A new run also checks the person's month here, against the monthly limit times the projects
-- they coordinate. A global table, like users (002): not under RLS, queried only by exact key, no project
-- data. Idempotent.

CREATE TABLE IF NOT EXISTS ai_token_ledger (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month    DATE NOT NULL,
  tokens   BIGINT NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  PRIMARY KEY (user_id, month)
);
