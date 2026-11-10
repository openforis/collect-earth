-- Collect Earth Cloud — a collector left out of the results: a coordinator marks a member, with an
-- optional reason, and their records are left out of the quality figures, the answers per person and
-- the data export (the export can still include them). Their records stay as they are. Undone by
-- setting both back to null. The audit action 'member.excluded' is in 015's list. Idempotent
-- (migrations run on every boot).

ALTER TABLE project_members ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS excluded_reason TEXT CHECK (excluded_reason IS NULL OR length(excluded_reason) <= 500);
