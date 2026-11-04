# Calibration and learning plots

Date: 4 November 2026. Branch `ce-2026-GEW`.

## Goal

Two ways of training photo-interpreters inside a Collect Earth Cloud project:

- **Calibration:** several people interpret the same plots. The dashboard shows, plot by plot
  and question by question, how their answers spread and how much they agree. The coordinator
  then picks the agreed (consensus) answer for each question, which becomes the golden
  interpretation of the plot.
- **Learning plots:** plots with a golden interpretation that interpreters assess to learn.
  Right after they submit a plot they see, on My work, their answers next to the golden ones,
  with the coordinator's explanation. Each attempt is scored (how close to the golden
  interpretation), attempts are kept, and an optional pass mark says who is ready.

This complements the **reference plots** (Task 14 of the dashboard improvements), which
measure accuracy blind during production and never show anything to collectors.

## Decisions (asked of the owner, 4 Nov 2026)

1. **Inside the project**, with the project's survey and Collect Earth set-up, kept apart from
   production data.
2. **Feedback right after each plot.**
3. **Calibration ends in a consensus** that becomes the golden interpretation; the set can then
   be used as learning plots.
4. **Repeated attempts**, each scored and kept.

## Design

### Kept apart at the source

A training set is not a plot file: it has tables of its own, and **the records of its plots go
to a table of their own** (`training_records`) when Collect Earth syncs them. Progress, the
export, the Collect backup, the checks and their sampling, the quality figures, the review queue,
the map, plot search, the activity of records and the AI read `records` and `csv_files` only, so
they never see training data and are not changed.

- The record intake (`POST records:batch`) resolves each record's unit against the project's
  training plot ids (`unitOfRecord`, as the figures do); a match is stored in
  `training_records` with the same last-write-wins rule and no record event.
- **No plot id is in both:** creating a training set is refused when one of its plot ids is in a
  plot file (`in_plot_file`) or has production records (`has_records`); uploading a plot file is
  refused when it holds a training set's plot (`training_plot_in_file`).

### Training sets

`training_sets`: `id, project_id, kind ('calibration' | 'learning'), name, filename, data, checksum,
plot_count, pass_mark (percent or null), created_at/by, updated_at`. The plot file is uploaded on
the Training tab (CSV, the same parsing as plot files; at most 500 plots).

- **Participants** (`training_members`): members the coordinator chooses (any role). Each gets
  the whole set as a plot file in `my-assignment`, named `Calibration – <name>.csv` or
  `Learning – <name>.csv`, built as a whole file (round 1 and the note column when the survey has
  them), downloaded from `GET /training/:setId/content`.
- **Kind:** a calibration set can be turned into a learning set (its golden answers kept) and
  back.

### Golden interpretation

`training_golden`: `set_id, plot_key, answers (question key -> value), note, updated_at/by`.
Set by the coordinator:

- **from the consensus** of a calibration (the most common answer, or the median of a number,
  proposed; the coordinator picks per question);
- **from one person's records** ("Use the answers of …": an expert who assessed the set in
  Collect Earth; their own scores are then left out);
- edited question by question, with an explanation note per plot.

### Calibration figures (`src/training.ts`, pure)

From each participant's latest submitted record of each plot:

- **per plot and question:** the answers and how many gave each (numbers: their values, the
  median); the proposed consensus (most common, or the median; null on a tie);
- **per question:** pairwise agreement (share of pairs of participants whose answers agree, the
  quality figures' rule: same choice, numbers within the margin) and **Fleiss' kappa** for choice
  questions (chance-corrected; null when it cannot be worked out);
- **per person:** agreement with the group's most common answer, overall and per question.

### Learning scores

A record is compared with the golden answers by `compareAnswers` (`quality.ts`: same questions,
margins, blanks on both sides not compared). Per person and attempt: the share of answers that
match (**accuracy**), the plots answered fully right, per question, and whether they **passed**
(every plot submitted and accuracy at least the pass mark).

### Attempts

`training_attempts`: `set_id, user_id, number, started_at, results (snapshot, null while open)`.
Attempt 1 starts when the set is created. A record counts for the open attempt when it was
submitted at or after its start. A **new attempt** (one person or all) closes the open one with a
snapshot of its scores and answers (the server keeps only a record's latest version) and starts
the next one now.

**Collect Earth and a new attempt:** the trainee's earlier record is still in their local
database and would open with the old answers. `my-assignment` gives the set's entry `freshSince`
(the open attempt's start, from attempt 2 on), and Collect Earth deletes the person's local
records of the set's plots saved before it when it takes the file (stage 3).

### Who sees what

- **Coordinators:** the Training tab: sets, participants, progress, calibration figures, the
  consensus and golden answers, scores per person and attempt, new attempts.
- **Participants:** My work → "Training": for each learning set, their open attempt (plots done
  of all, accuracy so far, passed), and **for each plot they submitted in it, their answers next
  to the golden ones and the note**; earlier attempts' scores. A calibration set shows only how
  many plots they submitted (no one's answers, so they stay independent), until it is a learning
  set.
- Reviewers: nothing more than collectors (they may be participants).

### Routes (`src/routes/training.ts`)

Coordinators: `GET /v1/projects/:pid/training`; `POST /training` (multipart-free: `PUT
/training/sets/:filename?kind=&name=` with the CSV body); `PATCH /training/:setId` (name, kind,
pass mark); `DELETE /training/:setId`; `PUT /training/:setId/members`; `GET /training/:setId`
(figures, golden, scores); `PUT /training/:setId/golden/:plot`; `POST /training/:setId/golden-from`
`{ userId }` and `{ consensus: true }`; `POST /training/:setId/attempts` `{ userIds | all }`.
Members: `GET /training/mine`; `GET /training/:setId/content` (participants).

## Stages

1. **Server:** migration 025, store (memory and PostgreSQL), record routing, the plot-id rules,
   `my-assignment` and the content route, `training.ts` figures, routes, audit entries, tests.
2. **Dashboard:** the Training tab and My work's Training section, 4 languages, tests.
3. **Desktop:** `freshSince` handled when a learning set's file is taken.

## As built (4 November 2026)

- **Server** (`migrations/025_training.sql`, `src/training.ts`, `src/routes/training.ts`): as designed. A
  set is created with `PUT /v1/projects/:pid/training-sets/:filename?kind=&name=&passMark=` (CSV body).
  `training.changed` was added to the audit actions in place (012 and 015), as earlier tasks did.
  **Attempt 1 counts every record** (a desktop clock may be behind the server's); later attempts count
  records saved at or after their start. Trainees see answers as "Label (code)" in the survey's order.
  Tests: `test/training.test.ts` (figures, kappa, scores, attempts) and `test/training.routes.test.ts`
  (roles, plot clashes, serving, record routing, consensus → golden → learning, attempts, audit); the
  PostgreSQL methods were run against a local PostgreSQL 16.
- **Dashboard:** `project/TrainingTab.tsx` (Training tab after Quality, coordinators only, not in the local
  mode), `components/MyTraining.tsx` (on My work), `trainingView.ts` (tested), 114 texts in four languages,
  activity sentences.
- **Desktop:** `my-assignment` entries carry `training.freshSince`; `CloudService.downloadAssignment`
  deletes the interpreter's local records of the file's plots saved before it
  (`AbstractEarthSurveyService.deleteRecordsSavedBefore`, keys from the file's first key columns).
  The deletion is local only: the server already ignores those records in the new attempt.
- **Printable training report** (`pages/TrainingReportPage.tsx`, `/projects/:pid/training/:setId/report`,
  coordinators; "Printable report" on each set): the set and who takes part; scores per person with
  earlier attempts; accuracy by question (weakest first) and the hardest plots (`questionAccuracy`,
  `plotAccuracy` in `trainingView.ts`, tested); how much they agree (and, for a calibration, the plots
  where answers differ); the golden interpretation with its explanations, on a page of its own when
  printed. It names people: for coordinators and trainers.
- **Reviewers see the calibration figures** (`GET /training/figures`, reviewers and coordinators;
  `anonymousCalibration` in `src/training.ts`; the reviewer's Training tab, `components/TrainingFigures.tsx`):
  per set, how many take part, pairs agreeing and kappa per question, and plot by plot how many gave
  each answer with the most given one (the median for numbers). **Never anyone's name** (as for reference
  plots, Decision 8: no one's agreement by name), no golden answers, no scores. A set the reviewer takes
  part in shows only once they have submitted all its plots, so their answers stay their own.
- **Not built:** per-question explanations (one per plot).

### Sentry and Google Analytics

The cloud server and dashboard had neither; they now have both, opt-in (`TELEMETRY=1`), with the
desktop app's Sentry project and GA property as defaults (decided by the owner, 4 Nov 2026; the GA
API secret must be given, `GA_API_SECRET`). `src/telemetry.ts`, `web/src/telemetry.ts`.

- **Sentry, server:** every 5xx (a Fastify `onError` hook, tagged with the route and project id), and
  the failures caught and logged without a 5xx: a record not stored at intake (training records
  included), the training sets of `my-assignment`. Sent without request body, headers, query string or
  user (`scrubEvent`); console and HTTP breadcrumbs dropped; no tracing.
- **Sentry, dashboard:** `@sentry/react`, loaded only when the server gives a DSN in `/v1/server-info`
  (`telemetry`); no user, no request body, link tokens masked in every address (`scrubUrl`).
- **Google Analytics (Measurement Protocol, from the server: no cookie, no script in the browser):**
  `training_set_created`, `training_set_changed`, `training_set_deleted`, `training_members_set`,
  `training_golden_set`, `training_attempts_started`, `training_records_synced`,
  `training_file_downloaded`, `training_figures_viewed`, `my_training_viewed`, and from the dashboard
  through `POST /v1/projects/:pid/telemetry` (a fixed list) `training_report_opened` and
  `training_report_printed`; also the plot files of this work: `plot_file_replace_asked`,
  `plot_file_replaced`, `plot_file_refused`. Kinds and counts only; the client id is a hash of the
  project and account ids.
- **Desktop:** a new attempt that cannot be started afresh is logged as an error (the Sentry appender);
  a successful one sends `TrainingAttemptStartedAfresh` (GAlogger, as `PlotSavedCollectEarth`).
- **Tests:** `test/telemetry.test.ts` (settings, parameters kept, scrubbing, the events of the whole
  training flow with no name, id or answer in them), `web/src/telemetry.test.ts`; a real Sentry event
  of a failing training route checked against a local endpoint (captured with its route, nothing
  personal in it).

### Gaps closed (4 November 2026)

- **Correctness:** only current participants count in a set's figures; training counts towards project
  storage; golden answers for questions the survey no longer has are not scored (listed, "Remove them",
  `POST /training/:setId/golden/prune`); golden answers are checked against the survey (`bad_answer`);
  plot ids must fit the survey's number keys (`bad_ids`; a warning for plot files).
- **Clocks:** a record counts for an attempt when saved after its start, or received after it and saved
  at most 12 hours before (`inAttempt`); `my-assignment` gives `serverTime`, and Collect Earth reads an
  attempt's start by its own clock before clearing earlier records.
- **Speed:** the training lists read members, records, survey and settings once per request.
- **Exports:** `GET /training/:setId/export?what=scores|answers` (CSV, formula-guarded), buttons under
  Scores.
- **Notices:** the bell's "Learning plots finished" card (who finished, passed or not); My work says when
  a new attempt started and what to do in Collect Earth.
- **Activity:** training syncs logged once per batch (`training.synced`).
- **Reviewers:** calibration figures of calibration sets only.
- **Feedback inside Collect Earth:** `GET /training/feedback?key=`; the desktop's
  `/api/cloud/training-feedback` syncs first and asks again while pending; the plot form shows the answers
  next to the golden ones after a Submit.
- **Verified:** row-level security of the training tables with the separate app role (no project: nothing;
  another project's write refused; project deletion removes them); `deleteRecordsSavedBefore` on the core's
  test survey; the QualityWorker tests (a tsx bootstrap for Node 22.18+, which loads .ts workers itself);
  French and Portuguese texts reviewed, golden answers called "attendues/esperadas".
- **Not verifiable here:** Sentry and Google Analytics live (this environment's network denies them):
  `npm run telemetry:check` on the deployment checks both against the real services.
