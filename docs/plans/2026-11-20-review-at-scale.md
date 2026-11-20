# Reviewing hundreds of plots, and correcting them in Collect Earth — design

Date: 20 November 2026. Branch `claude/awesome-bell-s34gb0`. **Status: built and run (stages 1–4, 20 Nov 2026).**

## What is asked

- **The Quality section of the dashboard** must work with hundreds of plots to review, not a few dozen.
- **A way to go through the plots systematically in Collect Earth to correct them.**

Decided with the project owner (20 Nov 2026):

1. Corrections are made by a **reviewer, an interpreter or a coordinator** whom a coordinator **assigns**, not sent
   back to whoever answered the plot (that stays as it is: "Both need another look").
2. A plot gets on the list to correct by a **new decision**, "Correct it in Collect Earth", taken on one plot or many.
3. Someone assigned a plot they answered themselves gets a **warning**, not a refusal.
4. In Collect Earth the form opens **filled with the first answer**, and the **differences** (the other answers and
   the reviewer's comment) are listed beside it, so the corrector changes only what is wrong.
5. In the dashboard: **a list of the queue**, **select many and decide once**, **a smoother one-at-a-time view**, and
   **tidier lists** (flags, reference plots, confusions).

## Where things stand

(Mapped 20 Nov 2026.)

**Dashboard** (`web/src/project/QualityTab.tsx`, `ReviewQueue.tsx`, `reviewQueueView.ts`)

- The review queue shows **one plot at a time** (`QueueCard`): answers that differ, flags, decision buttons, a
  comment, keys (1/2/3 decide, J/K move, C comment), and after a decision the next undecided plot of the session.
- Filters: person (coordinators) and kind. **No list of the plots, no search, no sort.**
- Pages of 100 (`MAX_QUEUE_ITEMS`), the next page only when the last loaded plot is reached; **a filter change starts
  again from the first plot and forgets the session's decisions**.
- Bulk: two rules (`first_by_reviewer`, `check_by_reviewer`), coordinators only.
- Flags (`QualityFlags.tsx`): 20, then "Show all" renders up to 500 in one list; no decision there.
- Reference plots (`QualityReference.tsx`): every plot in one table (up to 500), no pages.
- Confusions: plot ids as plain text (up to 20).

**Server** (`src/routes/quality.ts`, `src/reviewQueue.ts`)

- The queue is worked out on every request from the cached figures: undecided differences (plot order), then
  undecided flagged plots (newest flag first), then plots saved again after "both need another look". A reviewer's
  own plots and copies are left out (Decision 10 of the quality work: checks stay blind), reference plots hidden.
- Decisions per plot unit: `first`, `check`, `recheck` (`quality_decisions`, migration 008). `first`/`check` only fill
  the export's `final` column; `recheck` sends the plot back to everyone who answered it (`src/sendBack.ts`).

**Collect Earth**

- It knows nothing of decisions. A plot sent back reaches it only as a row of `my-plots.csv` (first, with the
  coordinator's note column). It shows as already done, gives no notice, and "next unfinished" skips it.

## Design

### A. The dashboard

**A1. The list of the queue.** A second view of the same queue, "List", beside "One at a time" (the card):

- One line per plot: plot id, why it is there (difference, the kinds of flags, saved again), the people, how many
  answers differ, the decision (if any), and for "Correct it in Collect Earth" who it is assigned to and whether it
  is corrected.
- **Search** by plot id (contains, any case), **sort** by queue order, plot id, person or kind, the existing
  **filters**, and a **state** filter: waiting (the queue, the default), decided, or both.
- **Pages** of 50, 100 or 200 lines, with the total ("312 plots").
- A click on a line opens that plot in the card view; going back to the list keeps the page, the filters and the
  selection.
- Server: `GET /v1/projects/:pid/quality/review-list` (reviewer and coordinator, the queue's rules: a reviewer's own
  plots are left out, reference plots hidden), compact lines (no answers), `offset`/`limit`.

**A2. Select many, decide once.** Tick lines, or "all N that match the filters", then one decision for them:
first is right, check is right, both need another look, or correct it in Collect Earth (A2 asks then whom to assign,
B2). With a comment for all. A confirmation says how many and what; plots that cannot take the decision (a "check is
right" on a plot with no check; a reviewer's own plot) are skipped and named.

- Server: `POST /v1/projects/:pid/quality/decisions:apply` with `plots` (at most 1000) or `filter` (the list's
  filters), `decision`, `comment`, `dryRun`. One transaction, one batch id (`decided_batch`, as the bulk rules), one
  audit entry. The two bulk rules stay.

**A3. A smoother one-at-a-time view.**

- The next page loads when 10 plots are left, not at the end.
- A filter change keeps the decisions taken in the session (by plot), and the card starts at the first plot of the
  new filter that is still undecided.
- Progress: "Reviewed 120 of 340 in this session" and the queue's total.

**A4. Tidier lists.**

- Flags: pages of 25 instead of "Show all", and the decision buttons on each flagged plot (as the differences have).
- Reference plots: pages of 50.
- Confusions: plot ids are links to the plot's page.

### B. Corrections on the server

**B1. The decision.** `correct` joins `first`, `check`, `recheck` (migration: the CHECK of `quality_decisions`):
"Correct it in Collect Earth". Until a correction is stored, the export's `final` column is `to correct` for the
plot's records; once one is, the correction is the plot's final answer (B3).

**B2. Assignment.** A coordinator assigns the plots decided `correct` to people of the project: reviewers,
interpreters or coordinators (any member who signs in). From the list (A2) or the plot's card: one person, or several
with the plots shared evenly between them.

- `quality_corrections` (new): project, plot unit, assigned to (user), assigned by, assigned at, and once corrected
  the corrected record (XML, summary), by whom and when, and which answer it started from.
- **Someone assigned a plot they answered** (a record of theirs, or a copy they hold): the assignment is made and the
  dashboard warns ("Ana answered 3 of these plots: she would correct her own work"). Collect Earth shows the same
  warning on the plot. (Reviewers still do not decide their own plots in the review queue: that keeps the checks
  blind, Decision 10. The warning is for corrections only.)
- Reassigning, unassigning, and deciding the plot otherwise (or undoing the decision) take it off the person's list;
  a correction already made is kept with the plot's history but no longer final.

**B3. The final answer.** A correction is not an interpretation: it is kept apart from `records` (so it never counts
in the agreement, the people's figures, the progress or anyone's plots) and is the plot's final answer:

- the export (CSV, and the backup's `final` column) gets the correction as a row of its own, operator the corrector,
  `final` = `corrected`, and the plot's records `final` = `no`;
- the plot's page and the queue list show "Corrected by Rosa on 21 Nov".

**B4. For Collect Earth.**

- `GET /v1/projects/:pid/my-corrections`: the plots assigned to the person and not yet corrected (and those corrected
  in the last days, to show as done): each with its keys, the answers (the records' XML: the first answer, the
  checks), the differences by question (labels as the survey says them), the reviewer's comment, and `own: true` when
  the person answered it. A `version` as `my-plots` has, so Collect Earth asks again only when it changed.
- `GET .../my-corrections.csv`: the plots' rows from the project's plot files, so Collect Earth can place them.
- `PUT /v1/projects/:pid/corrections/:plot`: the corrected record (the envelope's XML and summary, as
  `records:batch` takes them). Refused (409) when the plot is no longer assigned to the person.

### C. Collect Earth: correcting

How Collect Earth works today (mapped 20 Nov 2026) decides the shape of this: **a correction must never be a record
of the local database.** Every local record is sent to the server as the person's own interpretation: the save
listener queues it for `records:batch` (`CloudSyncService`), the reconcile every 10 minutes queues anything modified
(`reconcile()`), and "Send to cloud" (`CloudRecordsSender`) sends every record of the survey. A save also always stamps
the local operator (`AbstractEarthSurveyService.updatePlacemarkData`). So corrections live apart:

- **C1. The plots to correct, as a plot file of their own**, as the training plots are (`TrainingPlotFiles`,
  `MyPlotsService.openTraining`): `CorrectionService` asks `my-corrections` at start, every 5 minutes and on demand,
  writes `cloud/<project>/to-correct.csv` from `my-corrections.csv`, and "To correct (n)" in the plots list switches to
  it (and back to the person's plots), as the training's button does. `/plotsIndex` then says `corrections: true`, the
  list shows "to correct" and "corrected" from the service (not from the local database), and the form opens with
  `correction=1`.
- **C2. The record in memory.** The plot's first answer is read from its XML without storing it (collect-core's
  `DataUnmarshaller`), and edits are applied as the form's preview path applies them (`updatePreviewPlacemarkData`:
  values applied, relevance and validation worked out, nothing saved), answered as the form expects
  (`createPlacemarkLoadSuccessResult`). Endpoints of their own (`correction-info`, `correction-save`) so the normal
  save path (and its listener) is never reached. A correction in progress is kept as XML in
  `cloud/<project>/corrections/<plot>.xml`, so closing Collect Earth loses nothing; it is never imported.
- **C3. Submitting** (complete, as a normal submit validates it): the record's XML and summary (`DataMarshaller`,
  `CloudRecordSerializer`'s summary) go to `PUT corrections/:plot`; on success the plot is "corrected", its draft file
  is removed and the next plot to correct opens. Offline or refused: kept, said, tried again.
- **C4. Beside the form** (as the training's feedback panel and the repeat survey's header): the reviewer's comment,
  each question where the answers differ with every answer (labels, not codes), which answer the form started from,
  and the warning when it is the person's own plot.
- **C5. Moving through them**: previous/next through the plots to correct, and after a submit the next one not yet
  corrected; "N" as for unfinished plots.

## Stages

1. **A1–A4** (dashboard and its routes), with tests. *Built 20 Nov 2026* (the card opens the list's page through
   `GET /quality/queue?plot=…`; the flags' menu offers "first" and "both need another look", a flagged plot often
   having no check).
2. **B1–B4** (corrections on the server), with tests. *Built 20 Nov 2026*: migration 052 (`correct`,
   `quality_corrections` with the corrected record's key), `src/routes/corrections.ts`, the assignment with the
   decision (`decisions:apply` `assign`) and on its own (`corrections:assign`), the export's correction rows, the map
   (a plot to correct shows as one to look at again until corrected), the card's key 4, the dashboard's "Plots to
   correct in Collect Earth" panel. Not yet: the analysis (areas, uncertainty) and the repeat survey's earlier answers
   still read the first assessments, not the corrections (to decide: should a correction replace the plot's answer
   there too?).
3. **C** (Collect Earth), with tests. *Built 20 Nov 2026*, as above, with these choices:
   - `CorrectionService` (collect-earth-app `service/cloud`) holds the list (`to-correct.json`, read again offline), the
     plot file, the states (`to-correct.properties`: draft, pending, sent, refused) and the drafts
     (`corrections/<sha>.xml`, kept after the correction is sent: reopening it shows the correction, not the first
     answer again).
   - Records kept apart are core's `AbstractEarthSurveyService` `parseDetachedRecord`, `startDetachedRecord` (no longer
     submitted, the person's operator), `updateDetachedRecord` (the stored path's update with its store left out, so
     relevance and validation are the same), entity rows, `detachedRecordXml`/`Summary`. Collect reads a record with no
     creator as one whose creator has no name, which it cannot write back: cleared after reading.
   - The form calls `correction-info-expanded`, `correction-save-expanded`, `correction-create-entity`,
     `correction-delete-entity`; the normal saves are refused while the plots to correct are open (a form of before).
     A plot to correct always gets the generated form, even in a project with its own balloon. Its time is not counted
     as the person's plot's, and the form's cloud-sync line is left out (the panel says where the correction is).
   - A submit waits up to 8 s for the server; past that, or offline, the correction is pending and sent at the next
     check. A 409 (`not_assigned`, `not_to_correct`) is said in the panel and as a notice.
   - The server's `my-corrections` gives each plot's `placemarkId`, its id in `my-corrections.csv` (the round inserted
     where the server added round), which Collect Earth goes by.
   - The plots list: "Plots to correct (n)" while on the person's own plots (`toCorrect` in `/plotStatuses`), the
     banner with "Back to my plots" while correcting; their statuses come from the service, not the local database.
   - C5's previous/next is the list's own (N, the next unfinished): the plots to correct are the list while open.
4. A real run: a coordinator decides plots "correct" in bulk and assigns them; a reviewer corrects them in a real
   Collect Earth; the export has the corrections as final.

   *Run 20 Nov 2026*, on PostgreSQL (the app role, RLS) with the demo survey and real Collect Earth jars: Ana submitted
   four plots in her Collect Earth and they synced; Ben's checks differed on three; the coordinator decided the three
   "correct" in one go and gave them to Rita (a dry run giving them to Ana said "3 of hers", not refused); Rita's
   Collect Earth found them by itself after its start and offered "Plots to correct (3)"; she opened them, the panel
   showed the comment, "starts from ana's answer" and the forest type each gave (labels); she changed one to Ben's
   answer, submitted one as it was, left one half done; nothing went into her local database nor into the cloud's
   records; the server kept two corrections by her from Ana's answer; after a restart everything was as she left it;
   the coordinator then decided the third "first answer", her submit was refused and said, and it left her list; the
   export gave each corrected plot's correction as its final answer, the interpreters' answers beside it.

   Found and fixed in the run:
   - The server refused every correction (400): a question left blank comes as `null` in Collect Earth's JSON. The
     route now reads the summary as `records:batch` does (`summaryOf`: null is a blank, anything else not text is left
     out), which that route had learned the same way.
   - For the seconds between a start and the first check the plots to correct were not read back from their file: the
     list showed none started and a submit was refused. The list file is read on first use.
   - A plot refused and then given back still said "refused", and opened as submitted: a refusal is cleared when the
     server lists the plot again, and a correction not on the server never opens as submitted.
   - After switching to the plots to correct the list showed every plot "not started" until its next poll (up to 10 s):
     it asks for the statuses at once.
   - The reviewer's comment showed twice (the panel, and the plot file's coordinator note): the note is left empty in
     `my-corrections.csv`. The refusal's text repeated itself: the reason alone is shown.

## After the run (20 Nov 2026)

Asked: "use the corrections for the analysis and all further works. make the refusal a warning instead."

- **A plot's correction is its answer** everywhere the plots' answers are read (`src/corrections.ts`
  `loadCorrectedAnswers`, `firstAssessments(rows, resolve, corrected)`): the Analysis page (a row of its own, assessment
  "Correction"; a new column "Plot's answer", yes on the row each plot is counted by, which the views now start
  filtered on instead of "Assessment = first assessment"), its summary, the areas and the uncertainty (`stateFactors`,
  kept by the corrections too), the IPCC files, the export's `expansion_factor` (on the correction's row), the Collect
  backup (the correction's XML in place of the record of its key, in both modes), and a repeat survey's earlier answers
  and comparisons. A person who corrects a plot they answered is counted once (`answerId` tells the two rows apart).
  The quality figures, the people's figures, the progress and the answers page still read the interpreters' records.
- **A plot of one's own is a warning, never a refusal**: it stays in the queue and the list marked "yours" (the card
  and the plot page say it is better decided by someone else), a decision on it goes through (`byAssessor` on the
  decision, `own: true` in its audit entry), and a decision on many says how many of them are the person's own
  (`own`, `ownCount`). Coordinators are warned the same way. Kept: a reviewer's copy not yet checked stays out of their
  queue and its page is not shown until their check is submitted, as that check is to be made blind.


Then asked: "use the coordinator marked plot". Each plot's answer is now, in this order: its correction; else the
record a coordinator's decision took ("First is right" or "Check is right": the export's final "yes",
`finalAnswers`); else its first submitted assessment (`plotAnswers` in `src/routes/analysis.ts`, with
`loadPlotChoices`/`choicesStamp` in `src/corrections.ts`). "Both need another look" and a "correct" not corrected yet
leave the first assessment until then. It is what the Analysis page's "Plot's answer", its summary, the areas, the
uncertainty, the IPCC files and the export's weights read; a repeat survey already took it. The Collect backup's "first
assessments only" still gives the round-1 records (with the corrections in their place): a check's record has its own
round key there.
