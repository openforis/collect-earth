# Repeat survey: collecting a project's plots again, years later, with the earlier answers beside them

Date: 11 November 2026. **Status: stages 1 to 4 built on the working branch (`claude/awesome-bell-s34gb0`), with the Map
tab's layer, the desktop's filter and the numbers copied on "Still the same"; kept out of `ce-2026-GEW` until the 2.0
release is out, the export with both periods and the choice of plots to repeat. Not built yet: see "Open" at the end. The owner's decisions are below.**

## Goal

A project collected in 2020 is collected again in 2025: the same survey (or a newer version of it), the same plots.
The coordinator makes the 2025 project in the dashboard **from the 2020 one**, and the 2020 answers come with it as
the **earlier period**. They are not 2025's data: they are shown to the collectors (if the coordinator wants), and
compared with 2025's once collected: what changed, where, and how much.

This is what land monitoring asks for: activity data for a new reporting period, the land use changes since the last
one (an IPCC land representation's transition matrix), and a consistent time series.

### Not to be confused with

- **The re-assessment round** (`2026-10-29-reassessment-round-design.md`): a second interpretation of the *same*
  plot in the *same* campaign by another person (round 2), for quality. A repeat survey is a new campaign; its own
  checks still use rounds as they do today.
- **Reference plots** (Quality): plots whose correct answers the coordinator sets, to measure the collectors. The
  earlier period is not "correct": land changes.
- **Same as previous plot** (P, in the form): the answers of the plot submitted just before, by the same person.

The dashboard names it **"Repeat survey"** (es *Repetir la encuesta*, fr *Répéter l'enquête*, pt *Repetir a
pesquisa*) and the earlier answers **"2020 answers"** (the earlier period's label, set by the coordinator).

## What exists to build on

- `src/projectCopy.ts`: a new project from another (survey, project file, plot files, settings; with or without its
  people). It leaves the records out.
- `src/routes/backupImport.ts` (11 Nov 2026): a project from a Collect Earth backup, its records read and summarized
  as Collect Earth does. A 2020 project collected on the desktop only, never on the cloud, comes this way.
- Records with summaries (`collect_<type>_<name>` keys), the export, the analysis page (DuckDB over the summaries).
- Training sets keep records apart from the project's own (`training_records`): the same separation is needed here.

## Design

### 1. Making the repeat survey (dashboard)

On a project's Settings (and on the projects page): **Repeat this survey**. A dialog asks:

- the new project's name (`<name> 2025`) and the label of each period (`2020`, `2025`: years by default, from the
  records' dates);
- the survey: the same one (default), or a newer project file (questions added, answers renamed): the answers of the
  earlier period are matched by question name and answer code, and the dialog lists what does not match (left out
  of the comparison, kept in the earlier records);
- the plots: all of them (the project's plot files), or only those collected in the earlier period;
- who sees the earlier answers (decision 2), and whether the people come along (as `copyProject`'s `members`).

The source is a cloud project, its submitted records (decision 1). A project collected on the desktop only is first
brought to the cloud with the backup import (`2026-11-11-backup-import.md`), then repeated.

### 2. The earlier period in the new project (server)

- A table of its own, `period_answers` (project, period label, plot, operator, answers, saved at), written once at
  creation, read-only after: **never counted** in Progress, People, Quality, the exports of the project's own data or
  the records' sync, as training records are not. Migration `039_period_answers.sql`, both stores, RLS.
- One earlier record per plot: the one the coordinator took when the plot was decided (a check's, when it was the
  check), else the latest submitted first assessment.
- Routes (README): `POST /v1/projects/:pid/repeat/preview` and `/repeat`, `GET /periods`, `PUT /periods/header`,
  `GET /periods/plots/:plot` (one plot's earlier answers, for the dashboard and, in stage 2, the desktop).

  Cross-tenant 404 cases go in `test/isolation.test.ts`.

### 3. The collectors (desktop): the plot's header

Decision 2. When a plot of a repeat survey opens, Collect Earth asks the cloud for its earlier answers (as it asks for a
learning plot's feedback; collecting needs the internet anyway, for the imagery). The form then opens on a **header**: the plot's main characteristics as they were collected in the earlier period (the
questions the coordinator chose, by default its land use and land cover), and three choices:

- **Still the same**: the earlier answers of the form are filled in (marked *Copied* until looked at, as "Same as
  previous plot"), for the collector to confirm and complete;
- **Changed since {2020}**: nothing is filled in; the plot is interpreted anew, and counts as a change;
- **Wrongly interpreted in {2020}**: nothing is filled in; the plot is interpreted anew, and the difference is a
  correction of the earlier period, not a change: the comparison leaves it out of the changes and counts it apart
  (the earlier period's quality).

The choice is saved with the record, in a code attribute the server adds to the survey of a repeat survey
(`period_status`: `same`, `changed`, `corrected`), as it adds `round` and the coordinator's note, so it is in the
summaries, the exports and the comparison. A plot without an earlier answer opens on the form as today.

### 4. Comparing (dashboard)

A **Change** page (Results), for the questions the coordinator picks (land use by default, `land_use_category`,
`land_use_subdivision` in the IPCC surveys):

- the **transition matrix** (2020 rows × 2025 columns), as plots and as area (the plot weight of the sampling design,
  as the IPCC uncertainty does), with the uncertainty of each cell;
- the plots that changed, filterable, each linking to its plot page with both periods' answers side by side;
- a map of the changes (the Map tab's layer "changed since 2020", built);
- the export: one row per plot with `2020.<key>` and `2025.<key>` columns, and the analysis page with a `period` field.

### 5. More than two periods

Repeating the 2025 project in 2030 brings both 2020 and 2025: the periods are a list, and the matrix compares any two.

## Owner decisions (11 Nov 2026)

1. **Where the earlier period comes from: a cloud project only.** A desktop-only project comes to the cloud with the
   backup import first.
2. **What the collectors see: a header** with the plot's main characteristics as collected in the earlier period, where
   the collector says whether the plot is still the same, has changed since, or was interpreted wrongly then (section
   3), instead of the earlier answers beside each question.
3. **The survey: a newer version is allowed**, the earlier answers matched by question and answer code, with a report
   of what does not match.
4. **The comparison: the transition matrix and the plots first**; areas and their uncertainty in a later stage.

## Stages

1. The repeat survey from a cloud project: the earlier answers kept apart, the routes, the dialog, the plot page's
   periods. **Built** (below).
2. The desktop: the `period_status` attribute added to a repeat survey's survey, the plot's earlier answers asked when
   it opens, the form's header with its three choices. **Built** (below).
3. The comparison: the transition matrix, the changed plots and corrections, the comparison as a file. **Built**
   (below), with the Map tab's layer (below).
4. Areas and uncertainty of the changes. **Built** (below).

## Stage 1, as built (11 Nov 2026)

- Migration `039_period_answers.sql`: `period_answers` (project, label, plot, operator, answers, saved at; RLS like the
  records) and `projects.repeat_settings` (this period's label, the earlier periods, the header's questions). Both
  stores (`replacePeriodAnswers`, `listPeriodAnswers`, `getPlotPeriodAnswers`, `get/setRepeatSettings`).
- `src/repeatSurvey.ts`: the earlier record of each plot (the coordinator's final one when the plot was decided, else
  the latest submitted first assessment; drafts, deleted records and checks not taken left out), the answers matched to
  the new survey by question (what it no longer asks left out, codes it no longer offers kept; both reported), the
  default header (the plot's land use and land cover questions, at most four), labels and the year of most records.
- `src/routes/repeatSurvey.ts`: `POST /repeat/preview`, `POST /repeat` (a copy of the project, `copyProject`, with a
  newer project file through `acceptCep` when given; the earlier periods of a repeat come along), `GET /periods`,
  `PUT /periods/header`, `GET /periods/plots/:plot` (with the survey's labels and answers' names; who collected them
  for coordinators and reviewers only). Logged as `project.imported` (`source: repeat`) in the new project. Off in local
  mode; cross-tenant cases in `test/isolation.test.ts`.
- Dashboard: Settings, **Repeat this survey** (the dialog: the two labels, the name, the header's questions, the people,
  a newer project file and what does not match it); in a repeat survey, its earlier periods and the header's questions
  to change; the plot page's **Earlier periods** table, the header's questions first. Texts in en/es/fr/pt.
- Checked: `test/repeatSurvey.test.ts` (9), the isolation cases, `npm run smoke:pg:repeat` (the migration twice, RLS,
  a repeat of a repeat, deletion), and the flow in a browser (a project of 8 plots repeated, its settings and a plot's
  page).

## Stage 2, as built (11 Nov 2026)

- The cloud (`src/cep.ts`, `addPeriodStatus`): a repeat survey's served survey gets `period_status`, a code attribute
  after the plot's keys, on their step, with its own list (`same`, `changed`, `corrected`, labelled in en/es/fr/pt),
  ids above every id in use; once only. Added when the survey is repeated (`servePeriodStatus`) and to any project
  file uploaded to a repeat survey later (`acceptCep`). `GET /periods/plots/:plot` takes the plot as the desktop names
  it (`17,1`, with the round the server added) and tells what the header shows (`label`, `header`).
- The desktop: `GET /earth/api/cloud/plot-periods?plot=` (`CloudService.plotPeriods`, kept ten minutes per plot; no
  periods when the project is not on the cloud, repeats no survey, or the cloud cannot be reached, and the form is then
  as for any project).
- The form (`form/period.ts`, `PeriodHeader` in `FormApp.tsx`): the period status is taken out of the questions; on
  the first step, a header with the plot's main characteristics as answered in the earlier period ("This plot in
  2020: Land use: Cropland") and the three choices. **Still the same** copies the earlier answers into the questions
  left empty, on every step, marked *Copied* (choices and yes/no only, as "Same as previous plot" copies them: never a
  number, a text nor a key); **Changed since 2020** and **Wrongly interpreted in 2020** copy nothing. Submit is refused
  until one is chosen, the header in red with what to do. Texts in en/es/fr/pt.
- Found on the way, fixed in a commit of its own: the form asked a learning plot's training feedback at an address
  Collect Earth does not serve (`/api/...` instead of `/earth/api/...`, without the `X-Collect-Earth` header), so the
  feedback never showed.
- Checked: the cloud's tests (`addPeriodStatus` once, after the keys, ids unique; again on an upload), `CloudServiceTest`
  and `CloudControllerTest`, `form/period.test.ts`, and a real run: a 2020 project repeated as 2025, joined from the
  desktop by its collector; the form of a plot opened on its 2020 header, Submit refused until answered, "Still the
  same" and "Changed since 2020" saved as the record's `period_status`. The demo survey's "Invalid value" on its land
  cover rows is its own (the 2020 project's form shows the same).
- Left for later, both built since (below): the plots map's filter, and copying numbers on "Still the same".

## Stage 3, as built (11 Nov 2026)

- `src/repeatSurvey.ts`, `compareRepeat`: one question of every plot, the earlier period's answer against the record
  taken now (as `earlierRecords` takes it), with the collector's header answer. Each plot is **unchanged**,
  **changed**, **corrected** (another answer, the collector having said the earlier one was wrong: not a change),
  **new** (no earlier answer) or **pending** (not collected yet); and to look at again when the header answer and the
  answers disagree (said "still the same" with another answer, or "changed" with the same one). The transition matrix
  counts the unchanged and changed plots by earlier answer and answer now; the corrections are counted apart. A choice
  is compared by its code (its qualifier left out). `changeQuestions`: the plot's single choices answered in the
  earlier period.
- Routes (coordinators and reviewers): `GET /v1/projects/:pid/periods/change?question=&period=` (the counts, the matrix,
  the corrections, every plot, the questions and the answers' names; the header's first question by default, the latest
  earlier period by default) and `GET .../periods/change.csv` (a row per plot: each period's code and name, the header
  answer, the outcome, what to look at), logged as `export.downloaded` (`kind: change`). Isolation cases.
- Dashboard, Data tab of a repeat survey: **Change from 2020 to 2025**: the question (and the earlier period when there
  are several), the counts, the matrix (the diagonal unchanged, the changes marked), the corrections, the plots changed,
  corrected or to look at again (each to its page), and the file. Texts in en/es/fr/pt.
- Checked: `test/repeatSurvey.test.ts` (the outcomes, the matrix, the mismatches, the routes and the file),
  `repeatSurveyView.test.ts`, and in a browser (a 2020 project of 8 plots repeated, 7 collected in 2025 with each kind of
  outcome: the counts, the matrix, the corrections, the plot to look at again, the file downloaded).

## Map layer, as built (11 Nov 2026)

- Map tab of a repeat survey (cloud projects only, not in local mode): **Colour the plots by** their status (as
  before) or **their change since 2020**, with the question to compare (the header's first question by default). The
  page joins the map's plots to `GET .../periods/change` by plot id in the browser; no server change.
- Each plot is drawn as unchanged (blue dot), changed (large vermilion dot, thick outline), corrected (pink dashed
  ring), new (green dot), not collected yet (grey ring) or not compared (small dotted grey ring: a plot on the map with
  no row in the comparison). Okabe–Ito colours with a different shape or outline for each, so they read without colour.
- The legend **Change since 2020** has a line per kind with its symbol, how it is drawn, its count and a box to hide its
  plots; the plots' list under the map follows what is shown. Texts in en/es/fr/pt.
- `web/src/mapView.ts`: `CHANGE_KINDS`, `CHANGE_STYLE`, `changeCodes`, `changeCounts`, `shownByCodes`, `styleSvg`.
- Checked: `mapView.test.ts`, and in a browser on the 8-plot project of stage 3 (counts 4 unchanged, 1 changed,
  1 corrected, 1 new, 1 not collected yet; the list holds only the changed plot when the others are hidden).

## Stage 4, as built (11 Nov 2026): areas and uncertainty

- `src/uncertainty.ts`, `stratifiedTotal`: the stratified estimate of the total of a plot variable over the area,
  Σ_h A_h·ȳ_h with Var = Σ_h A_h²·s_h²/n_h; for a plot in a class or not it is the uncertainty page's estimate (tested
  against it), and it takes the net change (+1 gained, −1 lost) too.
- `src/repeatSurvey.ts`, `changeAreas`: the plots compared (unchanged, changed or corrected) in their strata; the area,
  share, SE, 95% CI and uncertainty (CI as a % of the area) of each outcome, each cell of the transition matrix, each
  correction, and each answer in the earlier period, now, and its net change. The earlier period is taken **as now
  known**: a corrected plot counts with the answer that corrects it, so the net change is a change of the land, not of
  the interpretation. New and pending plots are left out (`skipped.notCompared`), as are plots in no stratum.
- The strata: the project file's areas file (region_areas.csv or areas_per_attribute.csv, the expansion factors of the
  analysis), each plot matched by this period's record, else its earlier answers; without one, a single stratum of the
  **total area** the coordinator saves (`PUT /v1/projects/:pid/periods/area { totalArea }`, kept in `repeat_settings`
  and carried to a repeat of the repeat; `?area=` tries one without saving); without either, shares of the whole
  (`areaKnown: false`).
- Routes: `GET .../periods/change` has `areas` and `canEdit`; `GET .../periods/change-areas.csv` (outcomes,
  transitions, corrections, each answer's area in both periods and its net change: plots, area, share, SE, CI,
  uncertainty), logged as `export.downloaded` (`kind: changeAreas`). Isolation cases.
- Dashboard, under the change card: **Areas of the changes**: the total area (coordinators) or where the areas come
  from, the outcomes, each answer in both periods with its net change, each change, every area with its ± 95% under it,
  a warning for strata of fewer than 2 plots compared, and the file. Texts in en/es/fr/pt.
- Checked: `test/repeatSurvey.test.ts` (worked by hand: 1 plot of 4 changed over 100 ha is 25 ± 49 ha; the strata; the
  routes, the saved area, the file, the areas file), `repeatSurveyView.test.ts`, and in a browser (the 8-plot project:
  shares first, then 12,000 ha saved: 2,000 ± 3,920 ha changed, Forest −2,000 ha, Cropland +2,000 ha, the file).
- Not done: a finite population correction (as the uncertainty page has none), and areas of more than one question
  at a time.

## The desktop's filter by the earlier period, as built (11 Nov 2026)

- Collect Earth (`AbstractEarthSurveyService`): `hasPeriodStatus()` (the survey's plot has `period_status`: a repeat
  survey's) and `getPeriodStatus(record)` (its code, null when not answered); `loadRecordOf(summary)` loads a record
  once for both its status and its period status. `/earth/plotStatuses` sends `periods` (plot id → `same`, `changed`,
  `corrected`, or "" when not answered) with the statuses, for a repeat survey only.
- The plots map (`plots.ts`: `matchesPeriod`, `countPeriods`, `plotColor`; `MapController.setPeriodFilter`): on a
  repeat survey, under the status chips, **Compared with the earlier period**: All plots, Still the same, Changed since
  then, Wrongly interpreted then, Not answered yet, each with its count. The list shows the plots of the answer chosen
  (with the status chips and the search), and the map keeps their colours and draws the others grey ("Left out by the
  filter" in the legend); stepping to the previous or next plot follows the list. The choice is remembered, and ignored
  on a project that repeats no survey. What the collector said on this computer only: the cloud's Map tab has
  everyone's. Texts in en/es/fr/pt.
- Checked: `UntouchedPlotTest` (the period status read from the record), `plots.test.ts`, the Java suites, and a real
  run: the 2025 repeat survey joined from the desktop, three plots answered (same, changed, corrected) in their forms;
  the filter counted 1/1/1/5, "Changed since then" listed plot 2 alone with the 7 others grey on the map, "Not answered
  yet" the 5 others, and the choice was kept after a reload.

## "Still the same" copies the numbers too, as built (11 Nov 2026)

- The form (`form/model.ts`, `answersToCopy(..., numbers)`; `form/period.ts`, `earlierToCopy`): "Still the same" now
  copies the earlier integer and decimal answers as well (a canopy cover, a tree height, a count), into the questions
  left empty, marked *Copied* like the choices: it is the same plot, and its land has not changed. Never a calculated
  number, a key, a value that is not a number, a text or a date. "Same as previous plot" still copies no number, as a
  number measured on one plot is not another plot's.
- Checked: `form/period.test.ts` (numbers copied; calculated, text, date, key, a value not a number and one typed now
  left alone; none from the previous plot), and a real run on the demo survey with two numbers the collector types added
  (its own percentages are all calculated): "Still the same" on plot 3 filled 12 and 32.5, marked Copied and saved, and
  left the 2020 comment out; "Changed since 2020" on plot 4 copied nothing.

## Open (not built)

From the design above, not built yet:

- Areas of several questions at once, and a finite population correction (stage 4's "Not done").
- The earlier answers of multiple entities (the land cover's rows) on the analysis page.

## The export with both periods, as built (11 Nov 2026)

- `src/repeatSurvey.ts`, `bothPeriodsTable`: one row per plot of any period; each period's `<label>.operator` and
  `<label>.saved_on`; this period's `period_status`; each question of the survey answered in some period, in the
  survey's order, a column per period next to each other (`2020.collect_code_land_use_category`,
  `2025.collect_code_land_use_category`); then this period's other columns once (the keys, the plot file's, the
  places). This period is the record taken for each plot, as the comparison takes it. The coordinator's note left out.
- `GET /v1/projects/:pid/periods/export.csv` (coordinators, as the project's export; `?coordinates=none` without the
  places), logged as `export.downloaded` (`kind: periods`); isolation case. Dashboard: **Download every period (CSV)**
  on the change card, for coordinators. Texts in en/es/fr/pt.
- The analysis page, instead of a `period` field (which would count each plot once per period): the earlier periods'
  answers as **columns of the plot table**, after its own (`withPeriodColumns`): each question of the plot answered then,
  named `<name>_2020`, labelled "<label> (2020)", same type and list, with `period` in the model; each record gets its
  plot's answers. So a pivot of "Land use" by "Land use (2020)" is the transition matrix of the raw answers (a
  correction counts there as a transition: filter by "Since the earlier period" to leave them out). Not for the
  questions of multiple entities (the land cover's rows), which are tables of their own. The stand-alone analysis file
  has them too.
- Checked: `test/repeatSurvey.test.ts` (the table, the columns, the routes), and in a browser: the file downloaded
  (plot 7 with 2020's answers only, plot 8 with 2025's only), and on the analysis page "Land Use 2025" by "Land Use 2025
  (2020)" gave the 2020 × 2025 table of the eight plots.

## The choice of plots to repeat, as built (11 Nov 2026)

- The dialog, **The plots to collect again**: all the plots of the plot files (the default, as before), or only those
  collected in the earlier period, each with its count (`POST /repeat/preview` gives `filePlots` beside `plots`).
- `POST /repeat { plots: 'collected' }`: `copyProject(..., keepPlot)` copies each plot file with only the rows of those
  plots (`withRowsOnly` in `src/plots.ts`: the header and each row kept byte for byte), leaves out a file left with
  none, and keeps the divisions' plots among them; the people keep their plot files. A row is matched by its plot id,
  without the round when the survey has a round of its own (as the earlier records name their plots). 409
  `nothing_collected` when no plot was. The answer says `plots` and `filePlots`; the log records `onlyCollected`.
- Checked: `test/fileAssignment.test.ts` (`withRowsOnly`), `test/repeatSurvey.test.ts` (5 plots in the file, 2 collected:
  all 5, or the 2 with the people's assignment), and in a browser (8 plots, 7 collected: the new project's plot file
  has the 7, maria's assignment kept).
