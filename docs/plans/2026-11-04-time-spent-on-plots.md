# Time spent on each plot

Date: 4 November 2026. Branch `ce-2026-GEW`.

## Goal

Record how long the interpreters take to finish each plot and show it on the dashboard, so the coordinators can tell
whether a plot was looked at carefully. Until now the dashboard only estimated speed from the time between two
submissions ("very fast", the person page's Speed), which cannot tell a quick plot from a gap after a break.

## Decisions (asked of the owner, 4 Nov 2026)

1. **Active time**: from opening the plot's form to submitting it, added up over every time it was opened, with pauses
   of more than 5 minutes left out.
2. **Coordinators only** see the times: not reviewers, not the interpreters themselves.
3. **Quick is relative to the team**: a plot that took under a quarter of the team's median time, so no number has
   to be set.

## As built

### Collect Earth (desktop)

- `service/PlotTimeService` counts the time from the signs of work on a plot, which come in through
  `PlacemarkDataController`: the form loading it (`placemark-info-expanded`), each save (`save-data-expanded`), an entity
  added or removed, and the web form's "still here" (`POST /plot-activity?id=`). Each sign adds the time since the
  previous sign on the **same** plot when that is at most 5 minutes (`IDLE_MS`). A longer pause adds nothing. Work on
  another plot ends the stretch, so no minute counts for two plots. The rule is the pure `PlotTimeService.Clock`
  (`PlotTimeClockTest`).
- It is kept in the records' database (table `ce_plot_time`: survey URI, record key, milliseconds) through the shared
  `dataSource`, as the cloud queue is, so it survives a restart.
- **The web form** (`form/store.ts` `watchActivity`, from `FormApp`) sends "still here" once a minute while its page
  is shown and was used (pointer, key, wheel, scroll) within the last minute. Reading the form and looking at the
  imagery with the form in front count too; a form left open and untouched sends nothing. The balloon and Google Earth
  Web forms count through their loads and saves.
- `CloudRecordSerializer` adds `activeSeconds` to each record's envelope (`CloudApiClient` sends it). It goes with the
  cloud sync and with the local dashboard.

### Server

- Migration 026: `records.active_seconds` (null when not known). The intake takes whole seconds from 0 to a week
  (`activeSecondsOf`). Last-write-wins carries it with the record; a deletion keeps the time before it. A save from an
  older Collect Earth has none. `listRecordStates` gives it.
- `src/timeSpent.ts` (pure): per person, how many plots have a time, the median and middle half, the total, the plots
  in time bands (under 30 s, 30 s to 1 min, 1–2, 2–5, 5–10, 10–20 min, 20 min or more), and the quick plots. **Quick:**
  under `QUICK_SHARE` (25 %) of the team's median, once `MIN_TIMED_FOR_QUICK` (20) plots have a time.
- `GET /v1/projects/:pid/time-spent?person=` (coordinators; reviewers and collectors get 403). It counts the submitted
  first assessments of the plot files' plots, as progress does: no checks, no drafts, no plot in no file, no training
  plots.

### Dashboard (coordinators)

- **People tab → "Time spent on each plot"**: the team's usual time and middle half, the rule for quick plots, the
  plots without a time, the bands chart (quick bands in the warning colour), each person's plots with a time, usual
  time, middle half, total and quick plots (the people with the most quick plots first, linked to their page), and the
  quick plots, quickest first, each linked to its plot page.
- **A person's page**: their usual time next to the team's, a warning with how many plots were quick, their bands, and
  their quick plots.
- The Speed section now says where the real time is. Texts in English, Spanish, French and Portuguese.

### Tests and checks

- Desktop: `PlotTimeClockTest` (5), the web form's `watchActivity` (3 tests in `store.test.ts`).
- Server: `test/timeSpent.test.ts` (figures, the intake's limits, last-write-wins, the route and its roles). The
  PostgreSQL column was run against a local PostgreSQL 16: stored, kept through a deletion, cleared by a save without
  a time, migration run twice.
- Dashboard: `timeSpentView.test.ts`; a seeded server checked in a browser on desktop and phone (no page error, no
  overflow, links to the person and plot pages, a reviewer refused).

## Limits

- The time is counted on the machine where the plot was worked on. A plot worked on two machines carries the time of
  the one that saved last.
- Plots submitted by an older Collect Earth have no time. They are counted and said to be without one.
- With Google Earth Pro and its balloon there is no "still here": only the balloon's loads and saves count.
- Training plots are not timed on the dashboard (their records are kept apart).
