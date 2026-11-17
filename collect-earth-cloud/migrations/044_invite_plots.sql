-- Collect Earth Cloud — invitation links that hand out plots: a link may carry a plot file, given to each person who
-- joins with it, whole or as the next N plots nobody holds (src/invitePlots.ts). { csvFileId, mode: 'whole'|'share',
-- count }; NULL: the link gives no plots (as before). A file deleted since is skipped at the join. Idempotent.
ALTER TABLE invites ADD COLUMN IF NOT EXISTS plots JSONB;
