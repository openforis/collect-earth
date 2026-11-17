# Training the team

Date: 17 November 2026. Branch `ce-2026-GEW`. Builds on
`2026-11-04-calibration-and-learning-plots.md` (training sets, golden answers, attempts, scores).

## Goal

When a project starts, the coordinator wants everybody to train together for a day or two:
everyone opens the same plots in Collect Earth, learns how it works, and the coordinator sees
who agrees with whom. Once the training is over, the answers given during it must not stay in
the database or count as the project's, and the plots must stop being offered.

## Decisions (asked of the owner, 17 Nov 2026)

"Go with your recommendations. Still possible to upload files, keep scores, allow training
before it is published."

1. **The training plots are copies.** By default the coordinator picks a plot file of the
   project and a number of plots (20 by default): that many plots, evenly spaced through the
   file, are copied with new ids (`T-<id>`, or `-<id>` for number ids), so the project's own
   plots stay to do and nobody's real answers are mixed with training answers. Uploading a plot
   file of its own for the training is still possible.
2. **Everyone takes part by default.** A set for "everyone" has every collector and reviewer of
   the project, those who join later included, never the coordinators. People can still be
   picked one by one.
3. **Training before the project is published.** A draft project takes the records of a
   running training and keeps every other record out (Collect Earth sends them again once the
   project is published).
4. **Finishing keeps the scores, deletes the answers.** "Finish the training" offers the
   printable report first, then: the scores, the agreement figures and the golden answers are
   kept as they are (the set stays, read-only); every answer given on its plots is deleted; an
   answer sent later by a computer that was offline is thrown away.
5. **Collect Earth follows by itself.** No one has to choose a plot file or delete anything.

## Server (`collect-earth-cloud`)

- Migration `046_training_days.sql`: `training_sets` gains `everyone`, `finished_at`,
  `finished_by` and `results` (the set's view as it was when finished, JSONB);
  `training_retired_plots (project_id, plot_key, retired_at)` holds the plots of deleted sets,
  under RLS like every project table.
- `memberIds` of an "everyone" set is worked out when it is read (memory and Postgres stores),
  so every caller of `memberIds` is unchanged.
- `POST /training-sets/from-plot-file` copies the plots (`copyPlotsWithNewIds`, which keeps the
  header and the file's line endings) and checks them as a set from a file is checked. Plots whose
  copy another set has (running or finished) are left out and the copies are spread through the
  rest, so a second day's training from the same file has other plots; 409 `no_plots_left` when
  none is left.
- `PUT /training/:setId/members` takes `{everyone: true}` or `{userIds}`.
- `POST /training/:setId/finish` closes every open attempt with its score (a participant who
  never had an attempt gets a closed attempt 1), stores the view (`FinishedResults`), deletes
  the set's training records and audits `training.changed` `{change: 'finished'}`. A finished
  set answers 409 `training_finished` to any change but a new name, is left out of my-assignment, the feedback
  and the figures, and its list, view and "My training" are read from what was kept.
- Deleting a set retires its plots; a new set may take them again.
- `records:batch` (`trainingPlots`): in a draft, a batch with no record of a running training
  answers 409 `project_draft`; otherwise a record of a finished or deleted training answers
  `stale` (Collect Earth marks it sent and forgets it), a draft's other records answer `error`
  with the draft's reason (sent again later), and a running training's records go to
  `training_records` as before.
- `GET /my-assignment` adds `finishedTraining: {files, plots}` when there is a training over:
  the files of the finished sets the person took part in, and the plots of every finished or
  deleted set.

Tests: `test/trainingTeam.test.ts`, cases in `test/isolation.test.ts`, and
`npm run smoke:pg:training-team` (PostgreSQL, RLS, migrations twice).

## Dashboard (`collect-earth-cloud/web`)

- Setup > Overview: a "Train the team first" card while the project has no record (under the
  checklist, or under the summary once the checklist is done).
- Training tab, new set: "Copy plots from a plot file of the project" (the file, how many) or
  "Upload a plot file"; "Everyone in the project" ticked by default.
- The list shows "Everyone (n)" and "Finished on …". A running set's settings explain when to
  finish and have "Finish the training", whose dialog says what is kept, what is deleted and what
  Collect Earth does, with a link to the report. A finished set shows Scores and Calibration only,
  read-only (its name can still be changed).
- The refusals `no_plots_left`, `negative_ids` and `training_finished` are said in the person's
  language.
- The Activity tab says "… finished the training Week 1: its answers were deleted".

## Collect Earth (`collect-earth`)

Built on the person's plots from the server (`2026-11-16-plots-from-the-server.md`, `MyPlotsService`):
a training set is opened instead of the person's plots (`CLOUD_TRAINING_FILE`) until they go back
to them (Settings › Project, "Back to my plots").

`TrainingPlotFiles` (service/cloud), at the start once the person's plots are checked, and every
five minutes during the cloud sync (`checkIfDue`, as often as the person's plots are asked for):

- A training over: the records of `finishedTraining.plots` are deleted
  (`EarthSurveyService.deleteRecordsOf`), once for the same plots (`cloud_training_cleaned`);
  every training file of the assignments folder that is no running set's goes (a file the server
  listed as finished, or named as it names training files, "Learning – …" and "Calibration – …",
  also as written where file names cannot hold the dash). If the set open was one of them, the
  person's plots come back (`MyPlotsService.useMyPlots`) with a notice; with no copy of them yet,
  the training file is left with its header only.
- Then the training sets are offered as at a start (`CloudService.offerTraining`, once for each
  version), so a running Collect Earth gets a set started on the dashboard within minutes. **One
  set new to this computer opens by itself while the person holds no plot of their own** (the
  first days of a project, when the team trains together), with a notice saying the answers are
  for the training only; otherwise it is offered (Open / Later), so nobody's work is switched away
  under them. A learning set in a new attempt is only offered (taking it deletes earlier answers).
- The plots list says "Training plots: Learning – Day 1" above the progress while a training set
  is open (`plotsIndex` answers `training`, from `CLOUD_TRAINING_FILE`), with a tooltip saying the
  answers are for the training only.
- Nothing happens without the server (the next check tries again), outside a cloud project, or
  with an older server that has no person's plots (the assigned files of before apply).

Tests: `TrainingPlotFilesTest` (11), `TrainingAttemptRecordsTest` (core), `controller.test.ts`.

## Compatibility

- An older Collect Earth with this server: it never opens a training by itself (the person picks
  it in Settings › Project, as before), ignores `finishedTraining`, and its late training records
  are answered `stale`, which it treats as sent. Nothing breaks.
- This Collect Earth with an older server (no person's plots): `TrainingPlotFiles` does nothing;
  the assigned files of before apply.
- Projects without training are not affected.
