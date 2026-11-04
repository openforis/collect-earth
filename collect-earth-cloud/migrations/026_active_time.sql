-- Collect Earth Cloud — the active time spent on each plot (docs/plans/2026-11-04-time-spent-on-plots.md).
-- Collect Earth counts how long the interpreter worked on a plot (its form open and in use, pauses over five minutes
-- left out) and sends it with the record; null for a record sent by an older Collect Earth or a tool. Shown to the
-- coordinators only. Idempotent (migrations run on every boot).

ALTER TABLE records ADD COLUMN IF NOT EXISTS active_seconds INTEGER CHECK (active_seconds IS NULL OR active_seconds >= 0);
