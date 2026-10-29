# Following the work and the people: the coordinator's panel (Collect Earth Cloud)

Date: 2026-10-29. Branch: `feature/cloud-dashboard`. Builds on
`2026-10-29-dividing-plots.md`: "assigned to whom" comes from there.

**Goal.** A coordinator opens the project and, within a minute, can answer:
- How far along are we, and will we finish on time?
- Who is working, who has stopped, and who is stuck?
- Is the data good: are people careful, do they agree with each other, what
  needs another look?
- What happened, and who did it?

**Constraints**
- **No Java / Swing changes.** Everything comes from what the desktop client
  already sends:
  - each record's key, operator, `modifiedOn` (the collector's save time),
    `activelySaved`, `step`, `deleted`, and the summary with every answer;
  - the time the server received it;
  - the calls it makes (join, login, `my-assignment`, downloads, `records:batch`).

  A later desktop release could add more: the client version, and time spent
  per plot. Those items are marked *(later, needs client)*.
- **Tenancy as now.** Only project coordinators see project data, guarded by
  membership plus RLS. The platform admin sees only server-wide totals, never
  answers.
- **Plain language** in en/es/fr/pt. Every number says what it counts. Every
  time is shown in the viewer's local time zone.
- **Respect for collectors.** Activity monitoring is visible to the people it
  concerns:
  - the join page and the desktop "joined" message say coordinators see when and
    how much each person works;
  - each collector can see their own numbers on a "My work" page.

## What we have today, and what is missing

| Have | Missing (added by this plan) |
|---|---|
| Latest version of each record (last write wins) | **History**: one row per accepted upload, so work over time can be counted and replayed |
| Counts per operator on the Overview | Per-person detail page, daily activity, targets, forecast |
| Members list (role, joined) | **Last seen / last sync** per person, the sync health of each person |
| CSV export | Quality checks, review status, answer charts, map |
| — | Activity log of coordinator actions |

## Phase 1: activity data (server only, invisible)

1. **`record_events`** (migration 007, RLS like `records`). Each accepted record
   upload appends one row:
   - columns: `project_id, record_key, operator, modified_on, received_at,
     actively_saved, step, deleted, change`;
   - `change` is one of `created`, `updated`, `submitted`, `unsubmitted`, `deleted`;
   - no XML is stored; the summary is stored only on `submitted`, for "what
     changed" in a review.
   - Indexes: `(project_id, modified_on)` and `(project_id, operator, modified_on)`.
   - Uploads rejected by last-write-wins (stale) are not logged.
   - Existing records get one backfill event each (`created` at `modified_on`)
     when the migration runs.
2. **`member_activity`**: per `(project_id, user_id)`:
   - `last_seen_at`: any authenticated call to the project;
   - `last_sync_at`: `records:batch`;
   - `last_plots_download_at`: `my-assignment` / content;
   - `last_cep_download_at`;
   - `syncs_count`, `records_received`.

   Updated by one upsert per request, coalesced in memory to at most once per
   minute per member.
3. **`audit_log`** of coordinator actions: invite created or revoked, member
   removed, role changed, project file replaced, plot file uploaded or replaced,
   division applied, plots moved, review decisions, settings changed, export
   downloaded.
   - columns: `project_id, at, actor_user_id, action, details JSONB`.
   - Kept for the life of the project.
4. **Retention and size.** For 100k plots × a few edits this stays at around a
   million rows: fine. No rollup tables until measurements show the need.
   Aggregations are SQL `GROUP BY` queries that never read XML.

**Tests**
- events are written for each change kind; no event for stale uploads;
- the backfill;
- coalescing of `last_seen_at`;
- audit entries for each action;
- isolation between projects.

## Phase 2: "Progress" (the new first tab; the old Overview becomes "Setup")

- **Headline cards**, with progress bars:
  - plots in the project;
  - plots assigned (and not yet assigned);
  - submitted;
  - started but not submitted;
  - not started.
- **Progress over time:** a line of submitted plots per day, cumulative, with the
  target line when a deadline is set.
  - A plain sentence: "At the pace of the last 14 days (≈ 85 plots a day), the
    rest takes about 12 days: around 10 November."
  - When a deadline is set: "That is 4 days after the deadline. About 110 plots a
    day are needed."
- **Project settings** gain an optional deadline and an optional target number of
  plots; the default target is all assigned plots.
- **This week:** submitted per day for the last 7 days, and the most active and
  the least active people.
- **Needs attention.** Each card links to the place where it can be fixed:
  - someone has assigned plots but hasn't synced for N days (N set in the
    project settings, default 3);
  - someone joined but never downloaded their plot file;
  - plots not assigned to anyone;
  - someone's unsent work is old: their records were saved days before the
    server received them, which suggests syncing problems;
  - quality-check disagreements waiting for a decision (Phase 4);
  - the storage limit is close.
- **Auto refresh** every 60 s while the tab is visible, with "Updated 20 s ago".

**API**
- `GET /v1/projects/:pid/progress?days=90` returns `{ totals, daily: [{date,
  submitted, started}], forecast, attention: [...] }`.
- Days are computed in the time zone the browser sends (`tz=Europe/Rome`),
  validated against `Intl.supportedValuesOf('timeZone')`.

## Phase 3: "People": following each person

**The people table** (sortable, filterable, CSV download) has one row per member:
- role;
- plots assigned, submitted, started, remaining, and % done (with a progress bar);
- submitted in the last 7 days;
- typical pace: the median of plots a day over the days they worked;
- **last sync** ("2 hours ago"; amber after N days, red after 2N);
- last plot submitted;
- quality-check agreement rate (Phase 4);
- status chip:
  - Working;
  - Quiet for N days;
  - Never started;
  - Finished;
  - Invited, not joined (from the pending invites).

**The person page** `/projects/:pid/people/:userId` shows:
- **Activity calendar:** submitted plots per day (heat map) over the project's
  life, and hours of the day they work (from `modifiedOn`). The calendar gives
  the time span only, not hours worked.
- **Their files and plots:** for each plot file, their plots with status, and
  the "Move unfinished plots to…" action from the division page.
- **Speed:** time between consecutive submissions in a working session (gaps
  under 30 min), as a median and a distribution.
  - It flags "very fast" submissions (under 15 s, tunable), which often mean
    plots were answered without looking.
  - It is labelled as an estimate. True time per plot is *(later, needs client)*.
- **Sync health:** last sync, last plot-file download, last project-file
  download. When the project file was replaced after their last download, it
  says "has an old project file: ask them to join again with a new invitation
  link", matching what the desktop app really does.
- **Quality:** their agreement rate in quality checks, the plots sent back to
  them, and their unanswered questions (from the summary: required answers left
  empty).
- **Actions:** change role, remove from project (with what happens to their
  plots), make a new invitation link, move unfinished plots.

**API**
- `GET /people`: the table rows.
- `GET /people/:userId`: the detail.
- `GET /people/:userId/activity?from&to&tz`: the calendar.

## Phase 4: data quality and review

- **Quality checks** (from the plot-division overlap):
  - **Agreement rate** per question and per pair of people: "maria and jose
    agree on land use in 82 % of the 50 plots they both did."
  - **Differences table:** plot, people, question, answers. Each row has a
    decision: "Accept maria's", "Accept jose's", or "Send back to …".
- **Review status per plot** (`plot_reviews`, RLS):
  - states: `pending`, `accepted`, `needs_another_look`;
  - fields: comment, reviewer, time;
  - coordinators and reviewers can set it; collectors can't.

  A plot is reviewed per (record key, operator).
- **"Send back for another look"** with no client change: the person gets a
  generated plot file "To check again – <file>.csv" in `my-assignment`, holding
  only the plots sent back to them.
  - Their next Refresh shows it in the plot settings.
  - The comment is shown in the dashboard and listed in that file's last column,
    `review_comment`, only if the survey ignores extra columns. Check this before
    relying on it; otherwise comments live in the dashboard only.
  - When they submit the plot again, the review returns to `pending` with a
    "re-submitted" mark.
- **Automatic flags** (each one with its reason in plain words; none blocks
  anything):
  - submitted very fast (from Phase 3);
  - all answers identical to the previous plot by the same person;
  - required questions unanswered;
  - the same plot submitted by two people outside a quality check;
  - a plot not in any uploaded plot file (an old file, or a typo in the id);
  - edited after being accepted.
- **Answer charts:** for each question in the summary,
  - a bar chart of answers for categorical questions, or a histogram for
    numbers;
  - filters by person, plot file, column value (province…) and date range.

  Charts follow the dashboard's chart style, are readable in light and dark, and
  each comes with a table view.
- **Review queue:** one list combining differences, flags and `pending` plots,
  with keyboard shortcuts (accept / send back / next).

**API**
- `GET /quality/agreement`
- `GET /quality/flags`
- `GET /review-queue`
- `PUT /reviews/:recordKey/:operator`
- `GET /answers/:key?filters`

## Phase 5: map of progress

- **Leaflet map** of plot locations (columns 2 and 3 of the plot files, Y then X,
  as Collect Earth reads them):
  - coloured by status: not started, started, submitted, accepted, needs another
    look, disagreement;
  - filters by person or plot file; clustering above ~5k points;
  - clicking a plot shows its people, status and answers.
- **Base map:** OpenStreetMap tiles only (no keys, no billing), with the
  attribution shown. No satellite imagery here: that stays in Collect Earth.
- **Later:** the map picker (draw an area to give its plots to someone) fits on
  this map. It is out of scope now, as agreed.

**API:** `GET /plots/geo?bbox&filters` returns compact arrays
`[lat, lon, statusCode, personIdx]`, paged for large projects.

## Phase 6: activity log, reports, notifications

- **Activity log tab:** the audit log plus record events, filterable by person,
  kind and date. For example, "14:02 maria submitted plot 17" or "09:15 ana
  divided plots-north.csv between 3 people".
- **Reports:**
  - **Weekly summary**, a printable page (browser print to PDF): progress,
    per-person table, quality summary.
  - **CSV downloads:** people table, daily activity, review decisions,
    differences.
- **Notifications:**
  - in the dashboard now: a bell with the "needs attention" items, read state per
    coordinator;
  - email (weekly digest, "someone stopped syncing") when the email round lands.
    It is designed now, not built.
- **"My work" page for collectors:**
  - the same personal numbers the coordinator sees;
  - plots sent back to them with comments;
  - their quality-check agreement.

  Collectors log in to the dashboard with the account they made when joining.

## Phase 7: server owner's panel (platform admin)

These are totals only, never project data:
- users: number, sign-ups per week, active in the last 30 days;
- projects: number, active in the last 30 days, storage per project and the
  largest ones;
- records received per day;
- health: database size, version, migrations applied, failed logins per hour,
  rate-limit hits.
- Actions: disable an account, delete a stale project (with notice to its
  coordinators), and the existing settings.

## Order, size, tests

| Phase | Depends on | Size |
|---|---|---|
| 1 Activity data | division plan | M |
| 2 Progress | 1 | M |
| 3 People | 1, 2 | L |
| 4 Quality & review | 1, division overlap | L |
| 5 Map | 2 | M |
| 6 Log, reports, notifications | 1–4 | M |
| 7 Server owner's panel | 1 | S |

Phases 1–3 make the core "follow the work and the people". 4 and 5 can then go in
parallel.

**Tests**
- **Server:**
  - every endpoint against the memory store;
  - a smoke run on real Postgres with about 100k records, to check the query
    times (target < 300 ms for `/progress` and `/people`);
  - isolation tests for each new table.
- **Web:**
  - pure helpers: forecast sentence, status chips, time-zone day bucketing,
    flag reasons;
  - a Chrome run of each page with seeded data, at phone width and in dark mode.

**Open questions for the project owner**
1. The default for "quiet for N days" (3?), and whether collectors are told
   their activity is visible in the way proposed above.
2. "Send back for another look" through a generated plot file: is it OK that it
   appears as an extra file in the collector's plot settings?
3. Should reviewers (the existing role) see Phases 2–5, or only the review queue?
