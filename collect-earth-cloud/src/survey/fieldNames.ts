// Fields the server adds to a survey. Kept free of imports: the dashboard's build reads src/survey without the
// server's packages (Dockerfile, stage 1), so src/survey must not import cep.ts.

/** The coordinator's note; Collect Earth sends it in a record's summary as NOTE_SUMMARY_KEY (cep.ts). */
export const NOTE_NAME = 'coordinator_note';

/** A repeat survey's period status (docs/plans/2026-11-11-repeat-survey.md, stage 2). */
export const PERIOD_STATUS_NAME = 'period_status';
