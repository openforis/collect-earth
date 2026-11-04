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
