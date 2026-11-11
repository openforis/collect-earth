# Repeat survey: collecting a project's plots again, years later, with the earlier answers beside them

Date: 11 November 2026. **Status: stage 1 built on the working branch (`claude/awesome-bell-s34gb0`), kept out of
`ce-2026-GEW` until the 2.0 release is out; the owner's decisions are below.**

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
  the records' sync, as training records are not. Migration `037_period_answers.sql`, both stores, RLS.
- One earlier record per plot: the one the coordinator took when the plot was decided (a check's, when it was the
  check), else the latest submitted first assessment.
- Routes (README): `POST /v1/projects/:pid/repeat/preview` and `/repeat`, `GET /periods`, `PUT /periods/header`,
  `GET /periods/plots/:plot` (one plot's earlier answers, for the dashboard and, in stage 2, the desktop).

  Cross-tenant 404 cases go in `test/isolation.test.ts`.

### 3. The collectors (desktop): the plot's header

Decision 2. When the plot file of a repeat survey is downloaded, the earlier answers of its plots come with it (a small
JSON beside it, `<plot file>.period.json`, summaries by plot), so the form works offline as it does today. The form
then opens on a **header**: the plot's main characteristics as they were collected in the earlier period (the
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
- a map of the changes (the Map tab's layer "changed since 2020");
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
4. Still open: the comparison's areas and uncertainty from the start, or the matrix and plots first (proposed: matrix
   and plots first).

## Stages

1. The repeat survey from a cloud project: the earlier answers kept apart, the routes, the dialog, the plot page's
   periods. **Built** (below).
2. The desktop: the `period_status` attribute added to a repeat survey's survey, the earlier answers with the plot file,
   the form's header with its three choices.
3. The comparison: the Change page (the transition matrix, changed plots and corrections, map layer), the export's
   period columns.
4. Areas and uncertainty of the changes.

## Stage 1, as built (11 Nov 2026)

- Migration `037_period_answers.sql`: `period_answers` (project, label, plot, operator, answers, saved at; RLS like the
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
