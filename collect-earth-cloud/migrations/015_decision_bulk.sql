-- Collect Earth Cloud — the review queue (Task 7): bulk decisions are audited as one entry,
-- 'decision.bulk' (the rule and how many plots it decided). Widens the audit actions of 012
-- (AUDIT_ACTIONS, src/types.ts). Idempotent: the constraint is replaced only while it does
-- not allow the new action yet (migrations run on every boot).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'audit_log_action_check' AND pg_get_constraintdef(oid) LIKE '%decision.bulk%'
  ) THEN
    ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
      'invite.created', 'invite.revoked', 'member.removed', 'member.role', 'cep.replaced',
      'csv.uploaded', 'assignments.set', 'division.applied', 'plots.moved', 'decision.set',
      'decision.deleted', 'decision.bulk', 'settings.changed', 'export.downloaded', 'survey.replaced',
      'sampling.drawn', 'reference.changed', 'link.created', 'link.revoked'));
  END IF;
END $$;
