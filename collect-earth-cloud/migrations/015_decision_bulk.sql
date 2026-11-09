-- Collect Earth Cloud — the review queue (Task 7): bulk decisions are audited as one entry,
-- 'decision.bulk' (the rule and how many plots it decided). Widens the audit actions of 012
-- (AUDIT_ACTIONS, src/types.ts); later tasks added their actions to this list in place.
-- Idempotent: the constraint is replaced only while it does not allow every action listed
-- here (each one is looked for, not only decision.bulk: a database that ran an older copy of
-- this file has decision.bulk but not the actions added since).

DO $$
DECLARE
  wanted TEXT[] := ARRAY[
    'invite.created', 'invite.revoked', 'member.removed', 'member.anonymized', 'member.signed_out', 'member.role', 'cep.replaced',
    'csv.uploaded', 'assignments.set', 'division.applied', 'plots.moved', 'decision.set',
    'decision.deleted', 'decision.bulk', 'settings.changed', 'export.downloaded', 'survey.replaced',
    'sampling.drawn', 'reference.changed', 'link.created', 'link.revoked', 'training.changed', 'training.synced',
    'member.excluded'];
  defined TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO defined FROM pg_constraint
   WHERE conname = 'audit_log_action_check' AND conrelid = 'audit_log'::regclass;
  IF defined IS NULL OR EXISTS (
    SELECT 1 FROM unnest(wanted) AS w(action) WHERE position(quote_literal(w.action) IN defined) = 0
  ) THEN
    ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
      'invite.created', 'invite.revoked', 'member.removed', 'member.anonymized', 'member.signed_out', 'member.role', 'cep.replaced',
      'csv.uploaded', 'assignments.set', 'division.applied', 'plots.moved', 'decision.set',
      'decision.deleted', 'decision.bulk', 'settings.changed', 'export.downloaded', 'survey.replaced',
      'sampling.drawn', 'reference.changed', 'link.created', 'link.revoked', 'training.changed', 'training.synced',
      'member.excluded'));
  END IF;
END $$;
