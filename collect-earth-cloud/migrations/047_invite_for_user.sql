-- Collect Earth Cloud — a person's own link (POST …/invites with forUserId: the new project file for someone already
-- in the project) is theirs alone: register and login refuse it to any other account. NULL: anyone holding the link.
-- The person's account deleted, their link goes with it (never a link for anyone). Idempotent.
ALTER TABLE invites ADD COLUMN IF NOT EXISTS for_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
