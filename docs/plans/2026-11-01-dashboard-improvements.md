# Dashboard and data collection improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

Date: 2026-11-01. Branch: `feature/cloud-dashboard` (unpushed). Builds on
`2026-10-29-coordinator-monitoring.md` (its phases 1–7 are Tasks 1–8 here) and
`2026-10-29-reassessment-round.md` (rounds, quality figures, AI assistant).

**Goal:** Help coordinators follow the work and find quality problems without
waiting for checks, give collectors faster and clearer feedback, and make
re-assessments come by themselves.

**Architecture:** Everything is server and dashboard work: Fastify routes over the
`Store` interface (memory + Postgres, RLS through `withProject`) and React/MUI pages.
The only desktop change is the User-Agent (Task 21). New figures are pure functions
over records, events and plot files, tested on their own, then served by thin routes.
Heavy figures go through the quality worker's cache (keyed by `qualityVersion`).

**Tech stack:** Fastify 4, TypeScript (tsx), vitest; PostgreSQL migrations from 012;
React 19, MUI 9, Vite, i18n en/es/fr/pt; Leaflet for the map; Maven/JDK 23 for the
desktop.

---

## Standing rules (every task)

- **No Swing changes.** Desktop changes only outside Swing classes, and only where a
  task says so.
- **Keep each file's line endings** (`git ls-files --eol <file>`; `web/src/i18n.ts` is
  CRLF). Never sed a CRLF file.
- **Texts in en, es, fr, pt**, plain language, true to what Collect Earth does. Every
  number says what it counts; times in the viewer's time zone.
- **Tenancy:** every new table has `project_id`, RLS like `records` (the NULLIF
  policy form of migration 001), and an isolation test. Routes use
  `requireProjectMembership` and check the role.
- **Privacy:** collectors' activity is visible to them ("My work"); funders' links and
  the server owner's panel never show names or answers.
- **No billable resources, no real Vertex, no email sent** during development.
- **Tests:** `npm test` (server) and `npm test` in `web/`, both green before each
  commit. Postgres smoke (`npm run smoke:pg` or the existing script) for tasks that
  add SQL. One commit (or a few) per task, message in the repo's style plus the
  attribution lines.
- **Collect Earth runs** use the real profile only after backing up
  `%APPDATA%\CollectEarth`, and restore it afterwards.

## Decisions taken with the recommended defaults (the owner can change them)

1. **Quiet:** someone with plots counts as quiet after **3 days** without a sync; set
   per project.
2. **"To check again" plot file:** accepted. Plots sent back reach the collector as an
   extra plot file in Collect Earth's plot settings.
3. **Reviewers** see the Quality tab, the review queue, the map and plot search, but
   not the People and Activity pages.
   Working the review queue, they also read who made each record of a flagged plot (two
   first assessments, a plot in no file) and which way a plot was decided (Task 5's flags).
   **They decide (Task 7):** reviewers set and undo decisions (`PUT` / `DELETE
   /quality/decisions/:plot`), from the review queue, audited with their name; the
   decision shows who made it. Bulk decisions stay the coordinators'. Reviewers still get
   neither `GET /quality` (the whole report), the notes, the team report nor the AI
   assistant: the queue (`GET /quality/queue`) gives them each plot's two answers, its
   flags and its decision, and where it is (`POST /quality/places`).
   **Not their own plots:** a reviewer may not decide (nor undo the decision of) a plot of
   which they made the first assessment or a check (409 `own_plot`, "someone else decides
   it"); a coordinator may, and the decision then says "Decided by someone who assessed this
   plot" (`byAssessor`).
4. **Collectors are told** on the join page and on "My work" that coordinators see
   when and how much they work (as the monitoring plan says).
5. **Email** is built behind a transport that is off unless SMTP is configured; the
   weekly job is an HTTP endpoint for Cloud Scheduler, documented but not created.
6. **“None” is an answer.** In survey health, an option labelled “None” / “Ninguno” /
   “Aucun” / “Nenhum” alone (“None (no disturbance)”) is a real answer, not a catch-all:
   its share is shown apart for information and is never a reason to reword. “None of the
   above” and its translations stay catch-alls with “other”, “unknown” and “no data”.

---

## Part A: activity data

### Task 1: Record events, member activity, audit log (monitoring Phase 1)

**Files:**
- Create `collect-earth-cloud/migrations/012_activity.sql`.
- Modify `src/store/store.ts`, `src/store/memory.ts`, `src/store/postgres.ts`,
  `src/types.ts`, `src/routes/records.ts`, and the routes listed under the audit log.
- Create `src/activity.ts` (the in-memory coalescer).

**Build:**
- **`record_events`.** Columns `project_id, record_key, operator, modified_on,
  received_at, actively_saved, step, deleted, change`.
  - `change` is one of `created | updated | submitted | unsubmitted | deleted`,
    derived from the existing row and the new one.
  - One row per *stored* upload; stale ones are not logged.
  - The summary is kept only on `submitted`.
  - Indexes on `(project_id, modified_on)` and `(project_id, operator, modified_on)`.
  - Backfill: one `created` event per existing record, at its `modified_on`.
- **`member_activity`.** Keyed by `(project_id, user_id)`, with `last_seen_at,
  last_sync_at, last_plots_download_at, last_cep_download_at, syncs_count,
  records_received, client_agent`.
  - `client_agent` is the raw User-Agent, capped at 200 characters.
  - Written through `activity.ts`, which coalesces to at most one upsert per member
    per minute (counters add up in memory between writes).
  - The `my-assignment`, CSV `content`, `cep` and `records:batch` routes record it.
- **`audit_log`.** Columns `project_id, at, actor_user_id, action, details JSONB`.
  - Actions: `invite.created`, `invite.revoked`, `member.removed`,
    `member.role`, `cep.replaced`, `csv.uploaded`, `division.applied`,
    `plots.moved`, `decision.set`, `decision.deleted`, `settings.changed`,
    `export.downloaded`, `sampling.drawn` (Task 13), `reference.changed` (Task 14),
    `link.created`, `link.revoked` (Task 19).
  - `details` holds ids and counts only, never answers.
- **Store methods:**
  - `appendRecordEvent`;
  - `listRecordEvents(projectId, {from, to, operator?, limit, before?})`;
  - `touchMemberActivity(projectId, userId, patch)`;
  - `listMemberActivity(projectId)`;
  - `appendAudit`;
  - `listAudit(projectId, {limit, before?, actor?, action?})`.
  - `deleteProject`, `removeMember` and `deleteUser` clean the new tables.
    `audit_log` keeps rows of removed members with `actor_user_id` set to null.

**Tests:**
- Each change kind writes its event, and a stale upload writes none.
- The backfill.
- Coalescing, with fake timers.
- An audit entry per action.
- Isolation between two projects in both stores, plus the Postgres smoke.

**As built** (a05cd9dc, after the review e6177708; differs from the above)
- **How Collect Earth's saves arrive** (checked in the code): Collect's
  `RecordManager.save(record, sessionId)` (collect-core 4.0.110) calls
  `save(..., updateDateAndUser = true)`, which sets `modifiedDate` to now on every save,
  autosaves (the write-behind flush) included; the envelope sends that date. So each
  save has a new `modifiedOn`, and last-write-wins loses no autosave (a same-time upload
  is stored anyway: `applyLww` keeps newer *or equal*). Autosaves send `activelySaved`
  false, also onto a submitted plot.
- **`change`** (`recordChange(existing, row, submittedBefore)`, `src/lww.ts`):
  - every actively saved upload is a submission: `submitted` for the record's (key,
    operator) first one, **`resubmitted`** after (a kind added to the plan's list);
    so editing a submitted plot and submitting it again is `unsubmitted`, then
    `resubmitted`. Task 2 counts `submitted`;
  - `created` for a first or revived record not submitted, `updated` for a draft saved
    again, `deleted` for a tombstone;
  - **the same save sent again** (same `modifiedOn`, flags, step, XML and answers: a
    retried batch) logs nothing; the same time with other content is `updated`.
  - The answers are kept on `submitted` and `resubmitted`.
- **The backfill** gives each record the change a first upload would have had
  (`submitted` with its summary, `created`, or `deleted`), not always `created`. It runs
  only while `record_events` is empty (migrations run on every boot): records written by
  an older instance during a rolling deploy, after it ran, get no event. Its cost is in
  DEPLOY.md's upgrade section (about 1 s per 100,000 records on Postgres 16 in Docker).
- **One transaction per record:** `putRecordWithEvent(projectId, recordKey, operator,
  apply)` takes a transaction advisory lock on the record (it may not exist yet), reads
  the row `FOR UPDATE` with whether it was submitted before, lets `apply` (LWW +
  `recordEventOf`) decide, and stores the row and its event together. Round trips per
  record go from 12 to 7 or 8. Three racing uploads of one save log one event (smoke).
  One transaction per batch was not done: a failing record would undo the others.
  `appendRecordEvent` stays for tests and later use. `renameRecordOperator` runs before,
  outside that lock, as before; its events keep the old operator.
- **`member_activity`** also references `project_members` (ON DELETE CASCADE), and the
  upsert writes only for a member. `last_seen_at` is any request of a member with a
  session; `client_agent` comes only from the four Collect Earth routes (`records:batch`,
  `my-assignment`, a plot file's content, `GET /cep`), so the dashboard's browser does not
  replace it (a coordinator downloading a plot file or the CEP from the dashboard still
  sets it). `records_received` counts the records stored.
- **The coalescer and Cloud Run** (CPU throttled once the answer is sent): written in an
  `onSend` hook, awaited before the answer. A member's first call of the minute writes;
  the calls in the minute after it add up in memory and are written by the member's
  first call once the minute is over. A timer a minute after the last write is only a
  best effort; `close()` writes the rest. A failed write keeps its patch for the next
  one. Idle members are forgotten when over 1000 are held, at most one scan a minute.
- **Audit actions:** added `assignments.set` (the whole-file assignment grid) and
  `survey.replaced` (`PUT /survey`, `{ bytes }`). `invite.created` has the invite's id
  (`createInvite` returns `{ token, id }`). `member.removed` is written before the
  removal. `settings.changed` has `{ setting: 'quality' | 'round' | 'ai' | 'name' }`.
  Guidance notes are not audited. The `CHECK` lists every action of the plan (later
  tasks' too), named `audit_log_action_check` to widen later; a test checks it against
  `AUDIT_ACTIONS`. `at` is the server's clock, as `received_at`.
- **Indexes** besides the plan's: `record_events(project_id, record_key, operator)` (was
  the record submitted before) and `audit_log(actor_user_id)`.
- **Store:** `listRecordEvents(projectId, { from, to, operator?, limit, before? })`,
  `listAudit(projectId, { limit, before?, actor?, action? })`, newest first; `before` is a
  cursor `{ at, id }` (ids are BIGSERIAL, as strings), so rows at the same time are
  neither lost nor repeated between pages. Both stores throw `InvalidCursorError`
  (`checkCursor`, `src/store/store.ts`) for an id that is not 1-18 digits or a time that
  is not a number; the routes of later tasks turn it into a 400. `listAudit` gives the
  actor's username too. `appendAudit(projectId, { actorUserId, action, details })`.
- **No grants in 012:** `prepareAppRole` grants every table and sequence on each boot.
- **Postgres smoke:** `scripts/pg-smoke-activity.mts` (`npm run smoke:pg -- <port>`,
  README "With PostgreSQL"), on a throwaway `postgres:16`, the server as a NOSUPERUSER
  NOBYPASSRLS app role: the backfill on a 001-011 database with records, once; the
  grants; every route; events, activity and audit read back with paging, filters and a
  refused cursor; racing uploads; the first activity write inside the request;
  `removeMember`, `deleteUser` and `deleteProject`; with A set, B's rows not read,
  changed or deleted and B rows refused; with `''`, no rows and no error. 57 checks, all
  ok. The whole suite on that store (as the app role) fails only the 12 tests that reach
  into the memory store or set up twice.

### Task 2: Progress tab (monitoring Phase 2)

**Files:**
- Create `src/progress.ts` (pure).
- Create `src/routes/progress.ts`.
- Create `web/src/project/ProgressTab.tsx` and `web/src/progressView.ts` (pure
  helpers, with tests).
- Modify the project settings (server and `SettingsTab.tsx`), `router.ts`,
  `ProjectPage.tsx` and `i18n.ts`.

**Build:**
- **Route:** `GET /v1/projects/:pid/progress?days=90&tz=` returns
  `{ totals, daily, forecast, attention }`.
  - `tz` is validated against `Intl.supportedValuesOf('timeZone')`; the fallback is
    UTC.
  - Days are bucketed from `record_events` with change `submitted`.
  - Totals: plots in the project, assigned, not assigned, submitted, started (not
    submitted) and not started, all counted per plot unit (round 1 only, using
    `recordRound`).
- **Forecast:** pace over the last 14 days. The sentence is built in the web from
  numbers: days left, the end date, and with a deadline, days over and the plots a
  day needed.
- **Settings:** optional `deadline` (a date), `targetPlots` (default: all assigned
  plots) and `quietDays` (default 3). Stored in a new `project_settings` table or
  next to the quality settings, whichever the code already favours.
- **Needs attention cards,** each with a link to the place where it can be fixed:
  - quiet people;
  - joined but never downloaded plots;
  - plots not assigned;
  - old unsent work (median of `received_at − modified_on` over 2 days);
  - differences waiting for a decision;
  - storage near its limit;
  - **an old project file**: `last_cep_download_at` before the CEP's `updatedAt`;
  - **an old Collect Earth**: a version older than the release that hides checks,
    from `client_agent` (Task 21). Unknown agents are counted as "version
    unknown", never as old.
- **Tabs:** "Progress" becomes the first tab, and the old Overview is renamed
  "Setup". The page refreshes every 60 s while visible and says "Updated 20 s ago".

**Tests:**
- `progress.ts`: totals, daily buckets across a DST change, the forecast, each
  attention rule.
- The route against the memory store.
- The web helpers.

**As built** (05fd9b70, after the review 07efd1b4; differs from the above where it says so)
- **Route:** `GET /v1/projects/:pid/progress?days=90&tz=` for coordinators and reviewers
  (collectors 403) gives `{ timeZone, today, totals, daily, forecast, attention, settings }`.
  `days` is kept between 14 (the pace's days) and 366. `tz` passes `isTimeZone`
  (`src/days.ts`): the `Intl.supportedValuesOf('timeZone')` list, `UTC`, or another IANA
  name Intl knows (a browser's alias); offsets such as `+05:30` are refused; else UTC.
  `timeZone` says the zone used. Days are worked out in JS only (Intl), so the server and
  the database cannot disagree about a zone.
- **Reviewers** get the totals, the chart and the forecast, and `attention: null` (the
  cards name people). The web shows them the Progress page alone (with their "My quality"
  link); the other tabs stay the coordinators'.
- **One count everywhere** (`src/progress.ts`, pure): plot units of the plot files whose
  first assessment is submitted now. Each record is resolved by the quality figures'
  `recordResolver` (now exported): only first assessments (`assessment` main) of the files'
  plots count; checks, unknown rounds and plots in no file do not. An own round's file
  units whose round is the reassessment code are checks, not plots. Assigned = a unit of a
  whole file given to someone (the grid) or with a main holder in a divided file
  (`loadPlotContext` now also gives `fileUnits`); started = a unit with a main record, none
  submitted.
- **Records:** `listRecordStates` (key, operator, submitted, `modifiedOn`, and
  `firstSubmittedOn`: the record's event `submitted`, joined in one query; no answers). A
  record submitted, taken back and submitted again keeps its first day.
- **Days:** each plot submitted now counts once, on the local day of the earliest first
  submission among its submitted first assessments (a submitted record without an event,
  stored before events were kept, by its `modifiedOn`); `localDate` is cached per quarter
  of an hour (every zone's offsets and changes are whole quarters). Days after today (a
  clock ahead) count as today. The cumulative line starts with the plots first submitted
  before the window, so the bars plus that start add up to `totals.submitted` and the line
  ends there with no clamp (`dailyOf`). The first version grouped the events `submitted`
  in Postgres (`AT TIME ZONE`), checks included, and anchored the line backwards; the
  review replaced it (`countSubmittedByDay` is gone).
- **Forecast:** pace = plots of the last `paceDays` days / `paceDays`, where `paceDays` is
  14, or the days since the first plot was first submitted (today included) when fewer;
  `daysLeft` = ceil(remaining / pace), `endDate` = today + daysLeft; with a deadline
  `daysToDeadline`, `daysOver` (endDate − deadline) and `neededPerDay` = ceil(remaining /
  (daysToDeadline + 1)) (the deadline day counts), null once it passed. The web builds the
  sentences (`forecastSentences`).
- **Settings:** a `progress_settings JSONB` column on `projects` next to `quality_settings`
  (migration 013, which also indexes `record_events(project_id, received_at)`).
  `GET`/`PUT /progress/settings` (admin); a body that is no object is a 400; validated
  (`deadline` a real date, `targetPlots` 1..10,000,000, `quietDays` 1..365, missing =
  null/null/3), audited as `settings.changed` `{ setting: 'progress' }`. A "Progress" card in
  the Settings tab edits them: a date typed only in part is said (not saved as no
  deadline), and "12.5" is refused (separators only between groups of three: "1,200").
- **Cards** (coordinators; only those with something to say; at most 50 people named, the
  count says how many):
  - `quiet`: plots left (main plots not submitted, or check copies without their
    submitted check) and neither a sync nor a plot download for `quietDays`. When plots
    were given is not stored for divided files (`plot_assignments` has no time), so the
    later of the last sync and the last plot download stands for it: someone given plots
    after their last sync is quiet only `quietDays` after downloading them. Each person
    says "last sync" or, never synced, "plots downloaded".
  - `neverDownloaded`: main plots or check copies, and neither a plot download nor a sync.
  - `notAssigned`; `oldUnsentWork` (`unsentDelays`: per operator the median of received −
    modified over the events received in the last 14 days, deletions left out; Postgres
    `percentile_cont`, the memory store the same); `storage` (90 % as the Setup tab).
  - `differencesWaiting`: only when the project has copies or a reassessment code, from
    the figures this server has at hand: `QualityService.peek` never computes for a project
    with no report and never waits; an out-of-date report is served and refreshed behind as
    report() would (one at a time, minIntervalMs, the failure memo). Differing plots less
    the listed ones decided. Nothing at hand (nobody opened Quality since the server
    started): the card is left out.
  - `oldProjectFile`: `last_cep_download_at` before the CEP's `updatedAt`. Collect Earth
    downloads the project file only when joining, so the card says they keep the old one
    until they join again with a new invitation link (as `file.uploaded`). A CEP downloaded
    in a browser no longer sets `last_cep_download_at` (`noteActivity`: Collect Earth's
    agent only).
  - `oldCollectEarth`: only with copy holdings, among people holding plots who used
    Collect Earth: `parseClientAgent` old counted, `unknown` given apart as
    `unknownVersion`, never as old.
  - The project file and version cards count only people who hold plots or have synced (a
    coordinator's own dashboard use does not count). Links: People, Plot files, Quality,
    Setup. Texts have one-day forms ("Quiet for a day or more").
- **Web:** `PROJECT_TABS` starts `progress, setup` (`/projects/<id>` is Progress,
  `/projects/<id>/setup` the old Overview, `/projects/<id>/overview` still opens it); a new
  project opens on Setup, the project list and the "My quality" back link on Progress.
  Setup's count now says "Submitted records, quality checks included" and its "all done"
  points to the Progress tab. `ProgressTab.tsx`: five headline cards with bars, the cards,
  the forecast, and a chart of the plots submitted in total (one line, the target dashed
  when a deadline or target is set, keyboard and pointer readout of the day, announced
  only while the chart has the keyboard; drawn at any width; a table view; colours from the
  MUI theme). Reloads 60 s after each load once the page is visible (`onceVisibleAfter`),
  "Updated 20 s ago" ticks every 5 s. `progressView.ts` holds the pure helpers.
- **Tests:** server 650 (was 617: `test/progress.test.ts`, `test/progress.routes.test.ts`,
  the peek in `qualityService.test.ts`, the browser CEP download in
  `activityRoutes.test.ts`), web 224 (`progressView.test.ts`, router cases), tsc clean in
  both. **Postgres smoke** `npm run smoke:pg:progress -- <port>`
  (`scripts/pg-smoke-progress.mts`, README): 32 checks, all ok: 013 twice, the first
  submissions read with the records (through a resubmission), the bars of Rome across the
  DST change, UTC and three more zones (Lord Howe's half-hour DST included), the medians
  as the memory store's, the route as coordinator/reviewer/collector, settings and audit,
  RLS between two projects, and `/progress` on 100,000 records with 20,000 checks (a
  divided file, 120,000 holdings): the bars add up to the plots submitted, 480-650 ms on
  Postgres 16 in Docker on Windows (`listRecordStates` ~300 ms of it, loading the plot
  context ~200 ms; the query itself ~110 ms, the rest is moving 120,000 rows). The Task 1
  smoke (`npm run smoke:pg`) expected the inject agent to be stored, which Task 21
  stopped; it now expects Collect Earth's (ALL OK).
- **Chrome** (first version, seeded dev server, memory store): phone width (390 px) and
  desktop look right, no console errors; the reviewer sees the figures without the cards.
  The dashboard has no dark theme (`theme.ts` is light only), so with the browser in dark
  mode it stays light; the chart takes its colours from the theme and would follow one.
- **Open:** the member activity is coalesced (Task 1), so a sync is seen by the cards up
  to a minute late. Phase 2's "This week" (most and least active people) is left to Task 3.
  Task 22's 300 ms for `/progress` on 100k records is not met with 20 % checks in Docker
  on Windows (see the smoke).

### Task 3: People table, person page, My work (monitoring Phase 3)

**Files:**
- Create `src/people.ts` and `src/routes/people.ts`.
- Create `web/src/project/PeopleTab.tsx` (rework), `web/src/pages/PersonPage.tsx`,
  `web/src/peopleView.ts`.
- Extend the "My work" page (`ReportPages.tsx` or its own page).

**Build:**
- **`GET /people`** returns the table rows:
  - role, assigned, submitted, started, remaining and % done;
  - submitted in the last 7 days, and the median pace;
  - last sync, and the last plot submitted;
  - agreement rate;
  - the status chip: Working, Quiet N days, Never started, Finished, Invited not
    joined;
  - plus the CSV download.
- **`GET /people/:userId`** returns:
  - the activity calendar (submitted per day) and hours of the day;
  - files and plots with their status;
  - speed: the gaps under 30 min between consecutive submissions, with the median
    and a distribution, labelled as an estimate;
  - sync health: last sync, last plot download and last CEP download, with the
    "old project file: ask them to join again with a new invitation link" warning
    and the Collect Earth version;
  - quality: agreement, plots sent back, required answers left empty.
- **Actions** reuse the existing endpoints: change role, remove, new invitation
  link, move unfinished plots.
- **My work** (any member, own data only) shows the same personal numbers, plots
  sent back with comments, and agreement, with the sentence saying coordinators see
  this too.
- **Who sees what:** reviewers get 403 on `/people*` (decision 3).

**Tests:**
- Status chips at the quiet boundaries (N and 2N).
- Speed gaps, with sessions split at 30 min.
- Role checks.
- A collector cannot read another person's data.
- **Checks stay blind on My work:** a test fails if anything in a My work response
  (serialized and searched, plus structural asserts) says which of the person's plots are
  quality checks or copies: no `checks`, no `kind`, copies counted as plots.

**As built** (1fbcb1e7, then the review 9ed9de89; differs from the above where it says so)
- **One count:** `plotUnits` (`src/progress.ts`, now exported) takes `perOperator` and also
  gives each operator's records resolved by the same `recordResolver`: main plots submitted
  (with their first submission) and drafts, checks submitted and drafts, the first
  submissions known from the events (for the speed) and the plot groups of their records
  (for the decisions). `/progress` does not ask for it. A person's **submitted** = plots
  whose first assessment by them is submitted (held now or not), so the people's sum is the
  Progress tab's `submitted` (smoke, 100k); **assigned** = plots they hold (whole files and
  divided holdings); **remaining** = plots they hold that *nobody* submitted (as the quiet
  rule counts); **started** = their drafts not submitted by them; checks apart (copies held,
  checks submitted, copies left). The quiet rule is `isQuiet` (shared with the card).
- **Routes** (`src/routes/people.ts`, one load per request: records' states, plot context
  with the members/files/info read once, assignments, settings, activity, open invites,
  CEP info, decisions, `QualityService.peek` — never a computation, a failing peek is
  null):
  - `GET /people?tz=` (admin) → `{ timeZone, today, quietDays, quality: { available,
    computedAt, stale }, people: PersonRow[], invites, week }`. `PersonRow` = `{ userId,
    username, role, plots: { assigned, submitted, started, remaining, done }, checks: {
    assigned, submitted, remaining }, submittedLast7, medianPerDay, lastSyncAt,
    lastPlotsDownloadAt, lastSubmittedAt, agreement: Rate | null, status }`; `status` is
    `noPlots | finished | neverStarted | quiet {days, level amber|red} | working` (order:
    no plots, finished, never downloaded nor synced → never started, quiet (amber after N
    days, red after 2N), nothing sent → never started, working). `agreement` is the
    report's `asFirst` (null without figures at hand; `{0,0,null}` for someone not in it).
    `week` = Phase 2's "This week" (put here, coordinators only, since reviewers see
    Progress): the last 7 days' plots a day (as Progress's bars) and up to 3 most active
    (≥1 plot) and 3 least active (people with plots or checks left, not among the most).
  - `GET /people/:userId?tz=` (admin; 404 for a non-member) → `{ …, person, calendar:
    [{date, plots, checks}] (days with any, local), hours[24], files: [{csvFileId, filename,
    divided, plots: {total, submitted, doneByOther, started, notStarted}, checks: {total,
    submitted, started, notStarted}, list (file order, ≤ 1000), truncated}], speed: {
    submissions, sessions, gaps, medianGapMs, veryFast, buckets: [{upToMs, count}] }, sync:
    { lastSeenAt, lastSyncAt, lastPlotsDownloadAt, lastCepDownloadAt, syncsCount,
    recordsReceived, cepUpdatedAt, oldProjectFile, collectEarth: {kind, version} | null },
    quality: { available, computedAt, stale, asFirst, asChecker, sentBack: [{plot, comment,
    decidedAt, decidedBy}] } }`.
  - `GET /my-work?tz=` (any member with a session; a project token 403) → the same page of
    the signed-in person only (no userId is read from the request): `asFirst` is the
    report's `personal.asFirst` (plots certainly theirs, as My quality), no `asChecker`, no
    `decidedBy`.
  - Reviewers and collectors get 403 on `/people*` (`requireProjectMembership('admin')`).
- **Speed:** consecutive first submissions (event times; main plots and checks) less than
  30 min apart are gaps; a gap of 30 min or more starts a session; median, 7 bins (<15 s,
  15-30 s, 30 s-1 min, 1-2, 2-5, 5-10, 10-30 min), "very fast" < 15 s (`VERY_FAST_MS`, a
  constant, not a setting). Labelled an estimate.
- **Calendar and hours** in the viewer's zone (`dayInZone`, new `localHour` in `days.ts`,
  both cached per quarter of an hour), from the first submission of each plot/check by them
  (as Progress, `modifiedOn` for records older than the events).
- **Plots sent back** = decisions `recheck` (Task 12 has not built sending back yet) whose
  plot group is one of the person's records' groups, with the comment.
- **Required answers left empty: left out.** The survey outline (`src/surveyOutline.ts`)
  does not read `required`, and counting them would need the answers (summaries), which
  these pages do not load. Task 5 (flags) can add both.
- **Web:** `PeopleTab.tsx` keeps the invitation form, open links and the members list
  (role, remove) below two new sections: "This week" (a 7-column chart with a table view,
  the most and least active linked to their page) and "How each person is doing" (sortable
  columns: name, status chip, plots done with a bar and "N left"/checks, last 7 days with
  "usually N a day", last sync with an amber/red warning icon, last plot submitted,
  agreement; filter by name and status; the open links as "Invited, not joined" rows;
  "Download as CSV" built in the browser by `peopleCsv`: cells starting with = + - @ tab
  or CR get a `'`, times in the browser's zone, a BOM for spreadsheets). Agreement "—"
  with a note and a link to the Quality tab when no figures are at hand.
  `pages/PersonPage.tsx` (`/projects/<id>/people/<userId>`, under the People tab): status,
  numbers, actions (role, remove — saying their plots become given to nobody —, a new
  one-person 7-day invitation link with the join steps), files and plots ("Move unfinished
  plots to…" calls `move-unfinished`; for a whole file the dialog says it is divided as it
  is; the plots list behind "Show the plots"), the calendar heat map and the hours (one
  hue from the theme's primary, 4 shades, table views), the speed bins (the <15 s bin in
  the warning colour), sync health, quality. `MyWorkPage` (`/projects/<id>/my-work`, in
  `ReportPages.tsx`) reuses those sections with the sentence "Coordinators of this project
  see these numbers too…"; My work and My quality link to each other, and collectors and
  reviewers get both buttons. `peopleView.ts` (pure): chips, sync level, "N days ago",
  sorting/filtering, CSV, calendar weeks and shades, durations. `components/PeopleCharts.tsx`:
  `ColumnChart`, `CalendarHeatMap`, `ChartOrTable`, `ValuesTable`. 163 new keys × 4
  languages (i18n.ts written with CRLF kept).
- **Tests:** server 670 (was 650: `test/people.test.ts` 14 — chips at N and 2N, speed and
  sessions at 15 s / 30 min, counts against `/progress`'s totals, week, calendar and hours
  across zones, files and statuses, the 1000 cap, sync health, quality and My work's
  privacy; `test/people.routes.test.ts` 6 — role checks, a collector only ever gets their
  own My work, the figures never computed by these pages), web 237 (was 224:
  `peopleView.test.ts` 11, router cases), tsc clean in both.
- **Postgres smoke** (`npm run smoke:pg:progress`, now also the People tab): 41 people on
  100,000 records with 20,000 checks: the people's plots add up to `/progress`'s, checks
  20,000 apart, op1's 2,500 plots and 2,500 copies, op1's page and calendar, a collector
  403 and their own My work. **GET /people 487-653 ms, GET /people/:userId 512-563 ms**
  (GET /progress 500-640 ms in the same run; listRecordStates ~300 ms of each), Postgres
  16 in Docker on Windows: Task 22's 300 ms is not met, as for `/progress`. ALL OK; the
  Task 1 smoke too.
- **Chrome** (seeded memory server, built dashboard): desktop (1366) and phone (390) for
  the People tab, a person's page (a move of unfinished plots done from it) and My work as
  a collector and a reviewer; no page-wide horizontal scroll (the table scrolls inside its
  box on a phone), no console errors; a reviewer gets 403 from `/people` and their own My
  work. No dark theme exists yet (as Task 2 found).
- **Open:** the table is a full load per visit (no auto refresh); a person's activity is
  coalesced up to a minute (Task 1); `remaining` counts plots someone else submitted as
  done for the holder too (whole files given to several people).
- **Where the people's sum and the Progress total can drift** (by design, both small):
  (1) a whole file given to several people, where two of them submit the same plot: the
  plot counts once in Progress and once for each of them on People; (2) records of people
  removed from the project: their plots count in Progress but have no row on People.
- **Review (9ed9de89):**
  - **Blind checks on My work.** `personDetail(…, { self: true })` folds the copies into
    the plots: `person.plots` counts held plots and copies alike (assigned, submitted,
    started, remaining, done; `submittedLast7` and the pace too), there is no `checks`,
    the calendar has `plots` only, the files list plots with no `kind` and no `checks`
    counts, no `asChecker`, no `removal`. Tests serialize a My work answer and fail on
    `check`, `copy`/`copies`, `overlap` or a `kind` of a plot (unit test, route test with a
    collector holding a checked copy, and the 100k smoke for op1). The web hides every
    check figure and column when they are absent, and says "plots you submitted" there.
  - **Plots to look at again** come only from the groups of the person's first assessments
    (`OperatorWork.mainGroups`, replacing `groups`), on both pages: a `recheck` on a plot
    they only checked, or hold but someone else assessed, is not theirs.
  - **The new project file, checked in the desktop code:** Collect Earth downloads the
    project file only in its join flow (`CollectEarthMenu.joinCloudProject`: the link's
    preview, then `CloudLoginDialog`, then `CloudApiClient.downloadCep`). "Log in" in that
    dialog (`apiClient.login`, no invite token) does not use the invite up, and the server
    does not touch the membership, so an existing member keeps their role; the other two
    login paths (`CollectEarthWindow.promptCloudLogin`, the Database settings' login
    button) only refresh the session and never download the project file. So a link is
    needed, and the person presses "Log in", not Register. `POST /invites` takes
    `forUserId` (a member, else 400): always a collector link (anyone else who opened it
    would join as a collector), 1 use, 7 days, audited `invite.created` with `forUserId`;
    the People table names such links "Link for the new project file: <name>" (chip "New
    project file") instead of "Invited, not joined" (`GET /people` finds them in the last
    500 `invite.created` entries). The person page shows the link with its own steps (not
    the new-person join steps), and the texts of the Progress old-file card, `file.uploaded`,
    the person page and My work say exactly that.
  - **Remove dialog:** `removal: { plots, copies }` on the coordinator's page: plots only
    they hold that nobody submitted (given to nobody after `removeMember`) and copies not
    checked (dropped), one/many wording, numbers in the person's language.
  - **The last sync's warning** comes from the status (quiet amber / red), not from the
    sync time alone; on My work it says "You have not synced nor downloaded plots for more
    than N days, and you have plots left to do".
  - **`ProjectStateCache`** (`src/projectState.ts`), one per server, used by `/progress`,
    `/people`, `/people/:id` and `/my-work`: per project `{ context, units (plotUnits
    perOperator), files, members, assignments }`, versioned by sha256 of the records
    version, the round info, the files (id, checksum, division), the members (id, username)
    and the whole-file assignments (a few small queries, no records); roles are read each
    time (not in the version). One build at a time per project (concurrent first requests
    share it); a state under 30 s old whose inputs changed is served at once with `asOf`
    (the pages say "Figures as of …: newer ones are being worked out") while a new one is
    built behind it; older, the request waits. 6 projects kept (LRU), dropped after 10 min
    idle. Activity, invites, settings, decisions, the CEP date, the quality figures and the
    time zone are applied after, uncached. Tests set `stateStaleMs: 0` (config). The
    project's used bytes for the storage card are kept per state version and project file
    (summing 120,000 records took ~40 ms); the limit is read each time.
  - **Smaller maps:** `PlotContext.mainHolders` holds `null`, one username, or a Set only
    when several people hold the plot (`src/holders.ts`: `holderCount/Has/List`).
  - **My work** reads no invitation links nor audit entries, keeps only the person's own
    activity row, and answers again from its last answer within 5 s (per person, project
    and time zone; 1000 kept).
  - **Minor:** `submittedLast7` and the pace count a day ahead of today as today; the
    table says "quiet after N days without syncing or downloading plots"; the CSV uses `,`
    and `.` in English and `;` and a decimal comma in Spanish, French and Portuguese (BOM
    `﻿` kept); the "nobody matches" row only when nothing at all is listed; the
    calendar box is focusable with a label, arrow keys/Home/End step through the days (and
    the column charts' columns), the readout is announced only while focused; its lightest
    shade is 3:1 against an empty day (alpha 0.7, 0.82, 1, then primary.dark); demoting
    yourself on your own page goes back to the project.
  - **Tests:** server 681 (`test/projectState.test.ts` 5; people 17 and routes 9), web 239
    (CSV in Spanish, the remove texts, the warning from the status), tsc clean.
  - **Postgres smoke** (Docker, Windows; 100,000 records + 20,000 checks; each route first
    on a fresh server, then in five other time zones so My work's 5 s answer is not what is
    measured): **/progress cold 901-1032 ms, warm median 40 ms; /people cold 626-667 ms,
    warm 37-51 ms; /people/:userId cold 509-648 ms, warm 25-28 ms; /my-work cold 539-554 ms,
    warm 25-28 ms.** Warm /people is at the 50 ms target (37 and 51 ms medians in two runs).
    Cold stays ~0.5-1 s (listRecordStates ~300 ms, the plot context ~200 ms). ALL OK; the
    Task 1 smoke ALL OK.
  - **Chrome:** My work as a collector holding 6 copies (bruno), phone and desktop: no
    check is named anywhere (no copies line, no kind column, plots counted 54 with the
    copies), the plot to look at again shown; the person page's link card and remove
    dialog; the table's labelled link row; no console errors.

## Part B: quality without checks

### Task 4: Answers per person (improvement 8)

**Files:**
- Create `src/answerStats.ts`.
- Add to the quality route and its worker cache (`qualityService.ts`).
- Create `web/src/project/QualityAnswers.tsx`.

**Build:**
- For each question with choices, from the summaries of round-1 records:
  - the team distribution;
  - each person's distribution;
  - a flag when one answer's share differs from the team's by a lot. Use a
    two-proportion z-test with |z| ≥ 3 and at least 20 of the person's plots, and
    in the text: "Ana: cropland on 41 % of 64 plots; the team: 22 %."
- For numbers: each person's median and interquartile range against the team's.
- **Charts:** bars, with a table view, following the dashboard's chart style and
  readable in light and dark (load the dataviz skill).
- **Filters:** person, plot file, a plot-file column value, date range.

**Tests:**
- The distributions.
- The z-test threshold and the minimum-plots rule.
- Number quartiles.
- The text built from figures.

**As built** (1ea26ac2; differs from the above where it says so)
- **What is counted:** the submitted, not deleted first assessments (`assessment` main by the
  quality figures' `recordResolver`) of plots in a plot file: checks, drafts, unknown rounds
  and plots in no file never. Two main assessments of one plot (a whole file given to
  several people) count as each person's plot. A question is one the report compares
  (`keyRule`, now exported: an outline question with choices or a number, not excluded;
  without an outline, by its key's name). Choices: codes without qualifiers; a multiple
  answer counts once per code (shares can add up to over 100 %, the page says so); shares
  are of the plots *answering* the question (blank ones counted apart: entity questions are
  shown on few plots). Yes/No in the viewer's language for a boolean.
- **Two steps** (`src/answerStats.ts`):
  - `answerTable(input)`: one row per first assessment (person index, plot index,
    `modifiedOn`; the person index widened to 32 bits in the review) and per question typed arrays: a `Uint16Array` code index per choice
    (dense, or sparse rows + codes when under a third of the rows answer; several codes in a
    side list), number rows + `Float64Array` values and the rows whose answer is not one
    number (text, several values). Built by the **quality worker in the same job as the
    report** (`qualityFigures`), from the same read of the records: the worker's reply is now
    `{ report, answers }`, the table's buffers transferred, not copied (`tableBuffers`).
    `QualityRunner.run` gives `QualityFigures`; the cache entry (same version, same
    stale-while-refresh, same busy / failure rules) holds the table and `answerStats`, an LRU
    of 8 filter results; `ServedReport` carries both. Progress, People and My work never
    touch it (`peek` returns it but they read only `report`).
  - `answerStats(table, filter)`: one pass to keep rows (plots, days), then per question a
    count per person × code, per number each person's values sorted. **Filters decided:
    computed on the server from the table per request, not precomputed per file / person,
    nor in the worker per filter.** A cube of per-file × person × day aggregates cannot answer
    a plot-file column value (any column, any value) nor medians, and a worker job per filter
    would read the 100k summaries again (~2 s). The table is small (11.2 MB for 90,000 rows,
    25 choices and 5 numbers) and a filter's figures take 15-90 ms on the event loop on
    100,000 records; repeated filters are answered from the LRU.
- **Filters** (`GET /quality/answers?person=&file=&column=&value=&from=&to=&tz=`):
  - `person`: whose rows and flags are shown; **the team stays everyone** (with only that
    person, the team's share would be theirs). The page then draws that person against the
    rest of the team.
  - `file`: the plots of a plot file (`plotIdsOf`); `column` + `value` (with `file`): the
    plots with that value in a column of it (`plotsWithValue`). Columns and their values come
    from `GET /quality/answers/columns?file=` (reviewers too: the plot file page's
    `csv-files/:id/columns` is coordinators only); the listing is now `src/plotColumns.ts`,
    shared with the division routes. A column of over 200 values cannot be chosen (as for
    dividing).
  - `from` / `to`: local days (`tz`) of when the plot was **last saved** (`modifiedOn`; the
    summaries carry no first-submission time; the page says so).
  - Refused with 400: an unknown or malformed file, a column out of range or the id column,
    a column without value or file, a bad date, over-long texts.
  - The answer also gives `filters: { people (everyone with a first assessment), files }`,
    `computedAt`, `stale`, `timeZone`.
- **The flag:** a two-proportion z-test (pooled) of the person's share of an answer against
  **the rest of the team** (everyone in the filter but them; said in a code comment: the
  person's own plots would pull the team's share towards theirs). |z| ≥ 3 (`FLAG_Z`), the
  person with **at least 20 plots answering** (`FLAG_MIN_PLOTS` = the report's `MIN_PLOTS`)
  and, added, the rest of the team with at least 20 too. Both sides of one difference are
  listed (Forest less often, Cropland more often). Up to 100, largest |z| first, with the
  total. The web's sentence: "Ana: cropland on 41 % of 64 plots; **the rest of the team**:
  22 %." (the plan wrote "the team"; the figure is the rest of the team's, so the text says
  so). The spec's own example (41 % of 64 against 22 %) is *not* flagged against a team of
  200 (z 2.94); it is against 900 (test).
- **Numbers:** per person and for the whole team (in the filter) the median, Q1 and Q3 by
  linear interpolation (R type 7 / QUARTILE.INC), plots with a number and plots with
  something else (counted, not used).
- **Who:** coordinators and **reviewers** (`requireProjectMembership('reviewer')`);
  collectors 403. Reviewers had only the Progress page: they now get two tabs, Progress and
  Quality, the Quality one with this section alone and a line saying the rest is the
  coordinators'. Nothing in My work or the personal report (test).
- **Web:** `project/QualityAnswers.tsx`, a section of the Quality tab after the agreement
  figures: filters in one row (person, plot file, its column, the value, saved from / until,
  clear), the plots counted and when the figures are from (stale: newer being worked out,
  asked again after 20 s; busy: 15 s), "Worth a look" (8, then all) with a "Show" that
  opens the question for that person, a question picker (flag counts in it), and per
  question a chart or a table: choices as horizontal bars per answer (the team; with a
  person, the person and the rest of the team, two series with a legend), numbers as the
  middle half as a bar with the median as a mark, team and each person, the scale's ends
  written. Charts are HTML (fit any width), focusable, arrow keys / Home / End step through
  the rows with a readout announced only while focused, hover shows the same; values at the
  bar ends in text colours. Colours: the team `#2a6fb0`, a person `#2f7d4a` (the Quality
  tab's mark), checked with the dataviz validator (lightness, chroma, CVD ΔE 16.9, normal
  17.7, 3:1); the dashboard still has no dark theme. Tables scroll inside their frame on a
  phone. `answersView.ts` (pure, tested): flag text, rows with the rest of the team, the
  question shown, spreads, scale. 57 keys × 4 languages (i18n.ts written with CRLF kept;
  `api.ts` and `ProjectPage.tsx` too).
- **Tests:** server 701 (was 681: `test/answerStats.test.ts` 14 — distributions, checks /
  drafts / deleted / no file left out, multiple and qualifiers, sparse columns, no outline,
  filters by plots and days across zones, the person filter, z, the |z| 3 boundary from both
  sides, 19 vs 20 plots, quartiles, numbers with non-numbers; `test/answers.routes.test.ts`
  6 — figures, filters, refused filters, columns, roles, My work; the worker test now checks
  the table crosses the thread), web 244 (was 239: `answersView.test.ts` 5), tsc clean in
  both, web build ok.
- **Postgres smoke** (`npm run smoke:pg:progress`, no new SQL; now also the answers):
  100,000 records + 20,000 checks rewritten with 40 answers each (25 choices, 5 numbers, 10
  texts), op3 answering q0 apart: 90,000 first assessments counted, 25 + 5 questions, only
  op3 flagged, ALL OK. **Worker job cold (read 100,000 summaries, report + answer table,
  hand over): 3.25 s** for `GET /quality/answers` on a fresh server; on the main thread for
  the record: reading the summaries 1.97 s, plot context 0.23 s, report 0.16 s, answer table
  0.19 s (so the table adds about 0.2 s to the worker's job). Then: no filter (kept) 16 ms,
  a person 43 ms, the plot file 92 ms, days 69 / 74 ms, a person again (kept) 13 ms;
  `GET /quality` from the same cache 26 ms. Postgres 16 in Docker on Windows.
- **Chrome** (seeded memory server, built dashboard; 5 collectors, 396 plots, diego and
  bruno answering apart): desktop (1366) and phone (390, emulated): flags, "Show" for a
  person (two series and legend), the number chart, the table view, a plot file → region →
  north filter (99 plots), keyboard readout; a reviewer gets Progress and Quality tabs with
  the section; no page-wide horizontal scroll, no console errors. Fixed after looking: the
  count no longer says "match the filters" for the person filter alone, and "0 plots have no
  answer" is not said.
- **Open:** the date filter is by the last save, not the first submission; a filter's
  figures (up to ~90 ms at 100k) run on the event loop on a cache miss; a project whose
  plot ids repeat across files counts a plot once per first assessment, not per file.
- **Review (after 1ea26ac2; supersedes the above where it says so):**
  - **Rare answers:** a flag now also needs, with the pooled share p̂, n·p̂ ≥ 5 and
    n·(1−p̂) ≥ 5 for the person *and* the rest of the team (`FLAG_MIN_EXPECTED`), and a
    difference of at least 10 points between the two shares (`FLAG_MIN_DIFFERENCE`). 1 of
    20 against 0 of 1000 (z 7.07) and 2 of 20 against 1 of 1000 are no longer flagged, nor
    26 % against 22 % on 6,000 plots (z over 3) (tests).
  - **Many comparisons:** the server counts the comparisons it made (`tests`: a person and
    an answer against the rest, enough plots on both sides) and gives `chanceFlags` = tests ×
    `CHANCE_PER_TEST` (0.0027, the two-sided normal tail at |z| 3). The page says "N found in
    T comparisons of a person with the rest of the team. Chance alone would give about X of
    them." (or "would hardly ever give even one" under 0.05). Chosen over a Bonferroni-style
    threshold: with 40 people and 100 answers |z| would have to reach about 5, which hides
    real differences in small teams and is hard to explain; the expected-by-chance figure
    keeps the plan's |z| 3 and says how much to trust the list. The help text is softer in 4
    languages ("a difference larger than chance usually makes. With many people and
    questions some of these are still chance, and plots in different areas can differ: look
    at the plots before judging").
  - **Two people answering:** the second against "the rest" (the first) is the same
    difference, so it is listed and counted once, from the first by name, unless that one is
    hidden by the person filter. With three or more, each keeps both codes of a difference
    (Forest less often, Cropland more often).
  - **Dates:** the date fields apply 600 ms after the last change or when left; a first day
    after the last is said on the page (and not applied) and refused by the server (400).
  - **Flags per question** come from the server (`choices[].flags`, all of them, not the
    100 listed) for the question picker.
  - **Columns:** the server refuses a column of over 200 different values (400), as the
    columns listing does not offer it (the same `MAX_LISTED_VALUES` as dividing a file);
    part of the filters decision above.
  - **Texts:** the count says "N first assessments of plots (quality checks are not
    counted)"; "N plots have no answer to it" says "in the filters" only with a filter; es
    "mucho más a menudo o mucho menos a menudo".
  - **Choice table:** a "rest of the team" row when a person is chosen; a side with no answer
    to the question reads "No answers" (chart and table) instead of 0 % bars.
  - **Screen readers:** only the count is a live region (the "figures of" time after it
    changes at each reload and is not announced); the charts' readouts are always
    `aria-live="polite"`.
  - **Table:** the person index is a `Uint32Array` (no limit of 65,535 people). Memory: about
    11 MB per cached report at 100,000 records with 30 questions (90,000 rows), so the 4
    cached reports keep up to about 45 MB of answer tables, plus 8 filter results each.
  - **Tests:** server 704 (answerStats 18: the rare answers, the 10 points, the chance count
    and flags per question, the two-person pair; routes: from after to, a column of 201
    values), web 245 (chance text, "No answers", the rest-of-team row, dates in order), tsc
    clean in both, web build ok. No Docker or Chrome in this round (low memory); no new SQL.

### Task 5: Pattern flags (improvement 9 and monitoring Phase 4 flags)

**Files:**
- Create `src/flags.ts`, served from the quality worker.
- Create `web/src/project/QualityFlags.tsx`.

**Build:**
- Each flag carries its reason in plain words, and none blocks anything:
  - **very fast:** submitted under 15 s after the same person's previous
    submission (the threshold is a project setting);
  - **same as before:** every answer identical to the person's previous plot, in
    runs of 3 or more;
  - **required left empty:** from the survey outline (`surveyOutline.ts`);
  - **two main assessments outside a check** (already a data problem; link to it);
  - **plot in no file;**
  - **edited after a decision:** a record's `modified_on` later than its plot's
    decision.
- **Labels:** "worth a look", never wording that accuses.
- Per-flag counts appear on the person page (Task 3) and in the review queue
  (Task 7).

**Tests:** one per flag, its boundaries, and that the texts name no other person.

**As built** (differs from the above where it says so)
- **Two steps, as Task 4** (`src/flags.ts`):
  - `flagTable(input, kept, answers)`, on the **quality worker in the same job** as the report
    and the answer table (`qualityFigures` now gives `{ report, answers, flags }`; one
    `firstAssessments(input)` resolves the rows for both tables). Its rows are the answer
    table's (submitted, not deleted first assessments of plots in a plot file): `order` (each
    person's rows by `modifiedOn`, then record key), `same` (all answers equal to the person's
    previous row), `answers` (answers per row), the required questions blank (sparse), and
    `saved`: every non-deleted record of a known round (drafts and checks too) grouped by plot
    group, with its operator and `modifiedOn`, for the decisions. Its typed arrays are handed
    over with the answer table's (`tableBuffers(answers, flags)`); 2.3 MB at 100k. Cached in
    the same entry (same version, stale-while-refresh, busy / failure rules); `ServedReport`
    carries `flags`.
  - `patternFlags(served, decisions, { fastSeconds, person?, kind? })`, on the server per
    request: one pass over the rows in each person's order, the decisions and threshold as they
    are now (decisions change without the records changing, so they are not in the worker).
    8-15 ms at 100k in memory; `GET /quality/flags` 66-89 ms on Postgres (smoke). Not cached.
- **Order of a person's submissions: the records' `modifiedOn`**, not the events' first
  submission times. It is in the summaries the worker already reads (the events would need
  another read of 100k rows), it is the time on the collector's machine when they saved (not
  when it was synced, which bunches), and the answers compared are the record's current ones,
  so the time they were given is the one that goes with them. A plot submitted again later
  moves to its new time (said in the code). Only first assessments: checks are not in the
  order (a check between two plots lengthens the gap; nothing tells a collector which plots
  are checks).
- **The flags** (shape `{ kind, plot, operator, at, details }`, stable for Task 7; `operator`
  is the only person a flag names):
  - `very_fast`: under `fastSeconds` after the same person's previous first assessment
    (strictly under; 14.999 s flagged, 15 s not); details `{ gapMs, previousPlot }`.
  - `same_as_before`: every answer equal to the person's previous plot, in runs of
    `MIN_SAME_RUN` 3 or more: the plots after the run's first, details `{ previousPlot,
    runLength, firstPlot, answers }`. Answers = outline questions not excluded and not
    calculated (any kind, text too), blanks left out; without an outline, keys `keyRule`
    compares. **Added: at least `MIN_SAME_ANSWERS` 3 answers**, else a one- or two-question
    survey flags every run of forests. (The demo survey's land use, forest percentage and
    change are `calculated`: they never count.)
  - `required_empty`: details `{ questions: [{key, label}] }`. **The outline now reads
    `required`** (`Question.required`, `src/surveyOutline.ts`): a root attribute with
    `required="true"` or `minCount` ≥ 1, **no `relevant` and no `requiredIf`**, not calculated,
    not excluded. Relevance and conditions cannot be judged on the server, so a question
    required or shown only under a condition is never counted (the page says so); nor are an
    entity's attributes (the desktop app leaves their blanks out of the summary: an empty one
    cannot be told from an entity that is not there). A key absent from the summary (a record
    of a survey without the question) is not counted; blank or `null` is. The demo survey has
    3 such questions.
  - `edited_after_decision`: a record of the decided plot (group) whose `modifiedOn` is after
    `decidedAt`, each person once (their latest save), drafts and checks too, deleted ones not;
    details `{ decision, decidedAt }`. **Not after "recheck"**: saving the plot again is then
    what was asked (Task 7's queue shows those apart). `modifiedOn` is the collector's clock,
    `decidedAt` the server's: a clock far ahead can flag a save made before the decision.
  - `two_main`, `no_plot`: **from the report's data problems, not worked out again**: the
    report now also gives `problemsByPerson` (`{operator, kind, count}`, over all problems, not
    only the 500 listed), counted per person; the flags listed are the report's listed problems
    (their `at` the record's latest save from `saved`); details `{ recordKey }`. The page says
    they come from "Data problems" below (coordinators) and lists them with the others.
- **`GET /v1/projects/:pid/quality/flags?person=&kind=`** (coordinators and **reviewers**:
  `requireProjectMembership('reviewer')`; collectors 403) → `{ fastSeconds, plots (first
  assessments looked at), counts (by kind: everyone's, or the person's), people ([{username,
  counts, total}], everyone with a flag, most first), total (matching the filters), flags (up to
  500, newest first), requiredQuestions, computedAt, stale }`. 400 for an unknown kind or a
  person over 1000 characters. Not in My work nor the personal report (route test).
- **Threshold:** `fastSeconds` in the project's `quality_settings` JSON (no migration), whole
  seconds 1-120, default 15 (`fastSecondsOf`). `PUT /quality/settings` now takes `margins`,
  `fastSeconds` or both (the one left out stays; neither is a 400), audited `settings.changed
  {setting: 'quality'}`. **The figures' version takes the margins only**, so a new threshold
  applies at once without working the figures out again (test: same `computedAt`). The person
  page's speed bins (Task 3) keep their fixed 15 s (`VERY_FAST_MS`).
- **Person page** (coordinators): `quality.flags` = their counts by kind, from the figures at
  hand (`QualityService.peek`, never computing; null without figures), worked out only for
  `/people/:userId`. Never on My work.
- **Web:** `project/QualityFlags.tsx`, "Plots worth a look", on the Quality tab before the
  answers per person, and on the reviewer's Quality tab (read-only threshold; the reviewer
  note says so). The threshold field (coordinators), the note on required questions (or that
  the survey has none), person and kind filters (kind counts in the menu), the count and the
  figures' time (stale: asked again after 20 s, busy 15 s), the list (20, then all; plot,
  person, time, kind, and the reason in a sentence that names no one), a "By person" table
  (kinds with any, the person's name filters). `flagsView.ts` (pure, tested): sentences, gaps
  ("8.4 s"), counts text, the field's parsing. Person page: "Plots worth a look: Very fast: 8"
  with a link to the Quality tab. 44 new keys × 4 languages, the reviewer note changed (`i18n.ts`, `api.ts`, `api.test.ts`,
  `ProjectPage.tsx` written with CRLF kept).
- **Tests:** server 722 (was 704: `test/flags.test.ts` 12 — each flag and its boundaries
  (14.999 / 15 s, runs of 2 / 3, fewer than 3 answers, another person, blank, excluded and
  calculated keys, absent vs blank required, recheck, deleted, drafts and checks after a
  decision), the report's problems per person, filters and counts, no other person named, the
  500 cap, the transfer buffers, the threshold; `test/flags.routes.test.ts` 5 — the route,
  roles, My work / My quality, the threshold (audited, no recomputation), edited after a
  decision, the person page via peek; `surveyOutline` required; isolation for the new route and
  setting), web 250 (was 245: `flagsView.test.ts` 4, an api case), tsc clean in both, web build
  ok.
- **Postgres smoke** (`npm run smoke:pg:progress`, no new SQL; now also the flags): 100,000
  records + 20,000 checks with 40 answers: `GET /quality/flags` from the same figures 82 ms,
  again 89, a person 66, a kind 83; the threshold stored in `quality_settings` and applied with
  the same `computedAt`; on the main thread the flag table took 301 ms (report 173, answer
  table 207, reading the summaries 1.9 s), so the worker's job grows by about 0.3 s (cold
  `/quality/answers` 3.8 s in this run, Docker on Windows). ALL OK; the Task 1 smoke ALL OK.
- **Chrome** (seeded memory server, built dashboard): the coordinator's Quality tab (16 flags:
  very fast, required empty, saved again after a decision; the by-person table; the threshold
  saved as 30), bruno's person page ("Very fast: 8"), the reviewer at phone width (390 px, no
  page-wide horizontal scroll, read-only threshold). No console errors. Fixed after looking: the
  filters showed blank instead of "Everyone" / "All kinds".
- **Open:** a run of "same as before" in the demo survey needs answers to questions that are
  not calculated; the flag list is worked out per request (not cached; ~10 ms at 100k); the
  required rule leaves out entity attributes and conditional questions by design; Task 7 builds
  its queue from `GET /quality/flags`.

- **Review (after c08df499; supersedes the above where it says so):**
  - **Empty answers reach the server.** Collect Earth sends every empty root question as
    JSON null (checked: `AbstractAttributeHandler.getValueFromParameter` and the handlers'
    `getParameterValue` give null for no value, `BalloonInputFieldsUtils.getHTMLParameterName`
    puts it in the map, `CloudApiClient.toJson` writes it with `summary.put(key, null)`), and
    `summaryOf` (`routes/records.ts`) dropped it, so a blank required question was *absent*
    and `required_empty` never fired on real data. Chosen: **(a) a null is kept as ''**.
    Checked every reader: the answer table (`codesOf` / `numberOf`: no answer), the flags
    (`answerValue`), the AI tools (`aiSafeValue('')` is left out), the differences (blank
    values left out), the export CSV (an absent key was already written as ''), the personal
    and team reports (from the report only). The one change of meaning was the quality
    figures, which compared a question present on either side and counted two blanks as
    agreeing: **a question blank on both sides is no longer compared** (`isBlankAnswer`), so
    the agreement of real data is unchanged (before, both were absent and not compared); the
    two unit tests that encoded "two blanks agree" now say so. Not (b): which survey version
    a record was saved with cannot be told from its summary (a record of an older survey
    shares most keys), nor from when the CEP was uploaded (collectors keep the old file until
    they join again). **Records stored before this keep no key for their blanks**: they are
    judged once saved again; an absent key is still not counted (a survey that gained the
    question later is thus never blamed on its older records). `lww.sameSummary` sees the
    new blank keys of a retried batch as other content once (an `updated` event, no harm).
  - **"Very fast" by first submission.** `listRecordSummaries(projectId, { firstSubmissions:
    true })` (both stores; Postgres the same LEFT JOIN of min(modified_on) of `submitted`
    events as `listRecordStates`, only for the quality worker and the memory path) gives
    `QualityRecord.firstSubmittedOn` (and `receivedAt`). The flag table orders each person's
    rows by `firstSubmittedOn ?? modifiedOn` (`FlagTable.submitted`), and `very_fast` /
    `same_as_before` take their `at` from it; a plot corrected and submitted again 8 s after
    another one is no longer flagged (test). The answers' days filter stays on the last save.
  - **The person page's speed agrees with the flags:** for the coordinator's page,
    `speedOf(work.mainSubmissionTimes, fastSeconds)`: the first assessments only (each
    record's first submission, or its modifiedOn when older than the events, as the flags),
    with the project's threshold (`PeopleInput.fastSeconds`, read with the quality
    settings). My work keeps plots and copies alike (checks stay blind; a count of first
    assessments only would let a collector work out how many copies they hold) with the
    same threshold. Tests: unit (10 / 11 s around a 10 s gap) and route (1 at 15 s, 2 at
    25 s, on both the speed and the flags).
  - **Saved again after a decision, from what the decision saw.** Checked in the desktop
    code: opening a plot does not save it (`checkIfPlacemarkAlreadyFilled` fills the fields
    with `val()`, which fires no change), but **going to another tab of the form does**
    (`onStepChanged` → `ajaxDataUpdate`, which also sets the plot not submitted;
    `updatePlacemarkDataExistingRecord` then persists the record and `RecordManager.save`
    gives it a new `modifiedOn`) and so does any answer clicked. So a new `modifiedOn` does
    not mean new answers. **Migration 014** adds `quality_decisions.seen JSONB`: when a
    decision is set, the route keeps the plot's records as the figures at hand show them
    (`QualityService.peek`, never computed; `seenOf`: each record's person and a 32-bit FNV
    hash of its answers, the same answers "same as before" compares, several values as a
    set). The flag table keeps each saved record's `received` time and answers' `hash`. A
    record is flagged when **the server received it after the decision and** its answers
    are not among those seen (a record of the plot the decision did not see counts too).
    Decisions without `seen` (no figures at hand then, or made before 014): received after
    and `modifiedOn` after. Tests: changed after; **offline edit** (saved before the
    decision, synced after: flagged, the decision was made on other answers); **clock
    ahead** (a `modifiedOn` after the decision but received before: never flagged, with or
    without `seen`); same answers saved again (tabs): not; several values in another order:
    not; a new record of the plot: flagged; through the route, a decision then a draft save
    with the same answers: not. `seen` is never sent to clients (`publicDecision`, GET
    /quality and PUT decision). Limit: when the figures at hand are older than a change
    made and synced before the decision, a later save with those answers is flagged once.
    Task 7's bulk decisions should keep `seen` the same way.
  - **Reviewers** read the two_main / no_plot rows (with the person) and `details.decision`
    of the flags: kept, and said in Decision 3 (they work the review queue).
  - **Settings in one write:** `patchQualitySettings` (Postgres: one `UPDATE … SET
    quality_settings = COALESCE(quality_settings, '{}') || $2` with RETURNING; memory the
    same merge), so a margins save and a threshold save at the same time both stay (test).
  - **Web:** "Show the 500 latest of 1,234" when the server lists fewer than it counts (else
    "Show all N", the total), "Only the 500 latest of 1,234 are listed."; the note on data
    problems says they are all counted but only those among the report's first 500 (in plot
    order) can be listed; the order note says which time each kind shows (first submission
    or last save). One question left empty and a 1-second threshold have their own texts
    (`flags.text.required_emptyOne`, `flags.fastReadOnlyOne`); es "Muy rápida: menos de
    (segundos)"; pt "Ver na aba Qualidade".
  - **Speed of the flag table:** each record's answers are digested once (hash and count),
    and "same as before" compares the answers only when the hashes are equal; without an
    outline the answer keys are gathered once across the records (sorting each summary's
    own keys took about 2.5 s on 100,000 records). 0.2-0.6 s on 100,000 records with 40
    answers (noisy machine).
  - **Tests:** server 729 (was 722: flags 18, flags routes 6, people, quality, records), web 250,
    tsc clean in both. **Postgres smoke** (`npm run smoke:pg:progress`, now also a decision's
    `seen` stored and not sent, and the first submissions read with the summaries): ALL OK;
    the Task 1 smoke ALL OK. On a slower run of the machine (reading the summaries 3.2 s,
    was 1.9 s): cold worker job 7.1 s, flag table 0.64 s on the main thread (answer table
    0.70 s, report 0.56 s), GET /quality/flags 79-244 ms.

### Task 6: Survey health (improvement 10)

**Files:**
- Create `src/surveyHealth.ts`.
- Create `web/src/project/QualitySurvey.tsx`.

**Build:**
- Per question:
  - how often it is left empty (when shown; relevance is not known on the server,
    so the text says "empty in N % of plots");
  - how often an answer whose label looks like other, unknown, none or no data is
    chosen (labels matched in the survey's languages, plus the code list's own
    codes);
  - agreement between rounds, from the quality report;
  - how often it is the question most changed by decisions.
- The table is sorted by "worth rewording". The text says that this is for the next
  version of the survey.
- The AI assistant gets this as a new read-only tool (`src/ai/tools.ts`), capped and
  pseudonymised like the others.

**Tests:** the rates, label matching in 4 languages, and the AI tool's cap and
project scope.

**As built** (differs from the above where it says so)
- **Two steps, as Tasks 4 and 5** (`src/surveyHealth.ts`):
  - `healthTable(outline, answers, checked)`, on the **quality worker in the same job**
    (`qualityFigures` now gives `{ report, answers, flags, health }`), **from the answer table
    and the report, no new pass over the records**: the answer table now also counts, per
    question it looks at, the rows holding the key with no answer (`AnswerTable.asked`, also
    for the questions every row left blank, which have no column); `qualityReport(input,
    onCheckedPlot)` calls back once per checked plot with the compared questions that differ
    between its main record and its **latest** check (the pair a decision for the check chooses
    between, as `finalAnswers`), gathered into typed arrays (`checkedPlots`, handed over with the
    other tables: `tableBuffers(answers, flags, health)`). Cached in the same entry;
    `ServedReport.health`.
  - `surveyHealth(figures, decisions)`, on the server per request with the decisions as they are
    now: 2-9 ms at 100k (bench), `GET /quality/survey-health` 14-18 ms on Postgres (smoke).
- **Questions:** those the answer table looks at (`keyRule`: outline choice and number questions
  not excluded; by name without an outline) that a first assessment holds, plus those only the
  checks compared. Text questions are not in it. Per row: `required` (Task 5's rule) and
  `calculated` (the page says to reword the questions it comes from).
- **Empty:** `blank` = first assessments holding the key with no answer ('' or "null"; Collect
  Earth's null is kept as '' since Task 5's review); `notKnown` = those without the key (records
  stored before that, an entity's question, a survey without it); `emptyShare` = blank / (answered
  + blank + non-numbers), null under 20 of those. The page says older records and grouped
  questions count as not known, and that a question shown only for some answers can be empty on
  purpose (relevance cannot be judged on the server).
- **"Other, unknown, none or no data"** (`looksLikeOther`): an option's labels in every language
  of the survey decide (the outline now keeps `Question.optionLabels`: each option's other labels,
  by code, only when there are some). A label matches when it is one of `OTHER_PHRASES` (en, es,
  fr, pt; accents and case ignored: other/otro/autre/outro..., unknown/desconocido/inconnu/
  desconhecido, don't know/no sé/ne sait pas/não sei, none/ninguno/aucun/nenhum, none of the
  above, no data/n/a/sin datos/pas de données/sem dados, not applicable...), or one followed by a
  bracket, colon, slash, comma or spaced dash ("Other (specify)", "Unknown / not visible").
  Without a label of its own, the code decides (the phrases plus `oth`, `unk`, `nodata`,
  `no_data`, `na`, `nd`, `99`, `999`, `9999`). Not matched: "Other land", "Other wooded land",
  "Otherland", "Otherwise forested", "Otros bosques", "Other plantation", "No change", code 99
  labelled "Forest", the demo's `na` "0 Points – No Coverage". On the demo survey it finds
  exactly the subdivisions' "Other" (other_wetlands, other_otherland), aspect "N/A" and soil / GEZ
  "No data" (test). A share of the first assessments answering; a plot with two such codes counts
  once.
- **Agreement:** the report's, per question (`compared`, `agreeing`, `rate`).
- **Changed by decisions** (said exactly on the page): of the checked plots decided **for the
  check** (`decision: 'check'`; not first, not recheck; a decided plot that is not checked is not
  counted), those where this question's answer differs between the main record and the latest
  check: `decidedForCheck`, and per question `{ changed, share }`.
- **Worth rewording:** no score; reasons per row, the thresholds sent and written on the page:
  `low_agreement` (rate under 80 % with at least 20 checks), `often_other` (10 % or more of at
  least 20 answering), `often_empty` (20 % or more of at least 20 known), `often_changed` (5 plots
  or more and 25 % or more of those decided for the check). Sorted: rows with a reason first,
  among them by low agreement (lowest first), then the other share, the empty share, the changed
  share (highest first); then the survey's order. Up to 1,000 rows (`questionsTotal`).
- **`GET /v1/projects/:pid/quality/survey-health`** (coordinators and reviewers; collectors 403;
  never in My work): `{ plots, plotsChecked, decidedForCheck, questions, questionsTotal,
  thresholds, computedAt, stale }`. No names, no plots. In the isolation test.
- **AI tool `get_survey_health`** (`src/ai/tools.ts`, the 8th, no arguments): the rows the run's
  tools know (position questions left out, as everywhere), worth rewording first, up to
  `MAX_HEALTH_QUESTIONS` 60 (`moreQuestions`), labels cut and scrubbed, codes through `safeCode`,
  percentages rounded to one decimal (`emptyPercent`, `otherLike.percentOfAnswered`,
  `changedByDecisions.percentOfDecided`) next to their counts (`answered`, `empty`, `known`,
  `checks` / `agreeing` / `rate`), so a finding quoting them passes `numbersKnown`; then
  `capResult`. "Not available" without the figures. The service builds it from the same served
  figures and the project's decisions (one project, its RLS). The prompts mention it (system,
  report start, survey changes). The development fake also calls it and adds a finding "X may need
  rewording" quoting the empty or other share, so the number check is exercised end to end.
- **Web:** `project/QualitySurvey.tsx`, "Survey health", on the Quality tab after the answers per
  person and on the reviewer's Quality tab (the reviewer note says so): the count line and the
  figures' time (stale / busy asked again as the others), a table (the question with "Required" /
  "worked out from other answers"; the reasons as sentences; left empty with "N not known"; the
  other-like share and its options; checks agreeing; changed by decisions), only the questions
  worth rewording until "Show all N questions", "Nothing stands out" when none, and "How these are
  counted" (a `<details>`: empty, other, agreement, changed, and the order with the server's
  thresholds). `healthView.ts` (pure, tested). 35 keys × 4 languages and the reviewer note
  (`i18n.ts`, `api.ts`, `ProjectPage.tsx` written with CRLF kept).
- **Tests:** server 782 (was 729: `test/surveyHealth.test.ts` 45 — 24 labels that match and 12
  that do not, in 4 languages, codes, the demo survey; empty / not known / other / agreement per
  question, an all-blank question, the 20-plot rule, decisions for the check against first /
  recheck / agreeing / unchecked plots, the latest check, the order, the cap, the buffers;
  `surveyHealth.routes` 2 — the figures and decisions through the route, roles and My work;
  isolation; `surveyOutline` optionLabels; AI: the tool's content without names, plot ids,
  qualifiers or positions, not available, the 60 cap and 20,000 characters, a finding quoting its
  figures kept and one with a made-up figure dropped, and through the service with the fake: its
  own project's figures only, the fake's health finding kept), web 254 (was 250:
  `healthView.test.ts` 4), tsc clean in both, web build ok.
- **Cost:** bench (100,000 first assessments + 20,000 checks, 25 choices, 5 numbers, 10 texts, main
  thread): health table 5-16 ms, the checked plots' callback within the report's noise (report
  168-201 ms either way), `surveyHealth` 2-9 ms with 5,000 decisions. **Postgres smoke** (`npm run
  smoke:pg:progress`, no new SQL; now also survey health): ALL OK; GET /quality/survey-health 18 ms,
  again 14 ms, from the same figures; on the main thread the report with the checked plots 151 ms,
  the health table 9 ms (report 161, answer table 188, reading the summaries 1,975 ms). Docker on
  Windows, stopped after.
- **Chrome** (seeded memory server, built dashboard; 400 plots by 5 collectors, 120 checked, 27
  decided for the check): the coordinator's Quality tab at desktop width (Land Use Subdivision
  first: checks agree on 79 % of 120, "Other" on 16 %, changed on 19 of 27 decided), "Show all 5
  questions", the notes; the reviewer at phone width (390 px): the section and the new reviewer
  note, the table scrolls inside its frame, no page-wide horizontal scroll; no console errors.
  Fixed after looking: narrower columns, so the table needs less sideways scrolling on a desktop.
- **Open:** text questions are not in survey health; an entity's questions are always "not known"
  for empty (the desktop app leaves their blanks out); the phrase list is deliberately short ("cannot
  tell", "cloud covered" are not matched); "changed by decisions" uses the latest check of a plot
  checked twice; Task 7's bulk decisions feed it as they are.

- **Review (after 70154a64; supersedes the above where it says so):**
  - **Empty share without the old records' bias.** Records stored before blanks were kept have
    no key for them, so counting their answers made a question look less empty (900 old + 100
    new: 30 of 700 instead of 30 of 100). Now only first assessments that **keep their empty
    answers** count (`keepsBlanks` in `answerStats.ts`): a record holding a blank value of any key,
    or one the server received at or after the project's first record holding one (from then on
    every save keeps them; the time of the first boot with the Task 5 change is not known to the
    server, this is). A record without `receivedAt` counts only by holding a blank. Rule chosen
    over "holds a blank" alone, which would leave out fully answered new records and make every
    question look emptier. Per question `emptyBase` (those that say) and `emptyBlank`; `notKnown`
    = plots − emptyBase ("N do not say"); under 20 the share is null with "Not enough records
    that say what was left empty (N; at least 20 are needed)". A question inside a group (an
    entity) never gets a share: "Not known: inside a group of questions, empty answers are not
    sent" (before, it showed 0 %). Limit: should a pre-Task-5 record hold a '' (a value sent
    empty rather than null), `since` would be early and some old records would count. One extra
    loop over the rows (stops at a row's first blank): answer table 203 ms at 100k (was 175-193).
    Test: the 900 + 100 scenario gives 30 %, a fully answered new record counts.
  - **Conditional questions** (`Question.conditional`, `surveyOutline.ts`: `relevant` or
    `requiredIf` on the attribute or on the entity holding it): the empty share is shown, never
    `often_empty`; the row says "Shown only for some answers: an empty answer may be expected";
    the AI tool sends `conditional: true` and its `about` says an empty answer is then expected,
    not a wording problem. Tests (outline and health).
  - **"None" alone is an answer (Decision 6):** `answerKind(code, labels)` gives `catch_all` or
    `none`; none / ninguno / ninguna / aucun / aucune / nenhum / nenhuma (alone or with a bracket
    etc., "None (no disturbance)") are `none`: counted apart (`row.none`), shown in a "“None” (an
    answer of its own)" column only when some question has it, sent to the AI as `noneAlone`,
    never a reason. "None of the above" and its translations (and "aucune de ces réponses",
    "nenhum dos anteriores") stay catch-alls. Code `none` alone is `none`.
  - **More variants:** ne sais pas, pas de donnée, sin dato, não aplicável, N.A., NA, N/D, N.D,
    undetermined, indeterminate, indeterminado/a, indéterminé/e; em and en dashes without spaces
    ("Other—specify"), a hyphen without spaces only before specify / especif- / précis- / please /
    por favor ("Other-specify", "Otro-especifique"; "Unknown-origin plantation" and
    "Other-wooded land" still do not). Tests that "Otros usos", "Otra cobertura", "Aucun
    changement", "Otherland" do not match.
  - **The AI tool's numbers:** `collectNumbers` leaves out any `about` text (its numbers are
    rules, not figures; the `about` of get_survey_health has none now). A reason comes as
    `{ reason, ...thresholds }` with its percentage threshold only (`agreementUnderPercent`,
    `otherAtLeastPercent`, `emptyAtLeastPercent`, `minPlotsChanged` + `changedAtLeastPercent`),
    never the 20-plot minimum, so a made-up "20 %" finding is dropped (test). `moreQuestions`
    replaced by `questionsTotal` (all the rows the tool may send), right whatever `capResult`
    cuts (test). Field `known` is now `saysIfEmpty`, `empty` the blanks among them.
  - **Without an outline** the answer table's question keys (`SAFE_KEY`, as the report's) are
    in the tools' questions too (test).
  - **Codes beyond `MAX_CODES`** count as answered (`AskedQuestion.overflow`; test with 65,003).
  - **Web:** the toggle has `aria-expanded` / `aria-controls`; es "{n} sin información"; the
    order note says the minimum once for every figure; the changed note says numbers within their
    margin are not changed; the empty and other notes say the new rules (4 languages).
  - **Tests:** server 817 (was 782: surveyHealth 77, surveyOutline conditional, AI 2 more), web
    254, tsc clean in both, web build ok. Postgres smoke ALL OK (survey-health 16-17 ms; health
    table 12 ms on the main thread, answer table 209 ms). No Chrome in this round.

### Task 7: Review queue and faster review (improvement 11, monitoring Phase 4 queue)

**Files:**
- Modify `web/src/project/QualityDifferences.tsx` (or a new `ReviewQueue.tsx`) and
  `src/routes/quality.ts`.

**Build:**
- **One queue:** differences without a decision first, then flags, then the
  plots re-submitted after "Both need another look" (Task 12). Filters by kind and
  by person.
- **Keyboard:**
  - `1` First is right;
  - `2` Check is right;
  - `3` Both need another look;
  - `J`/`K` next and previous;
  - `C` comment.
  - Shortcuts are shown on the page and work without a mouse; focus is visible.
- **Bulk:** "Take the first assessment where the first is a reviewer's" and "Take
  the check where the check is a reviewer's", with a confirmation that gives the
  count. The server endpoint is `POST /quality/decisions:bulk`, audited.
- **Links:** "Open in Earth Map" next to "Open in Google Earth"
  (`https://earthmap.org/?latlng=<lat>,<lon>` — check the exact URL format against
  the desktop's Earth Map code before using it). Lat/lon only, as for Google Earth.

**Tests:** the queue order, the bulk endpoint (roles, counts, audit) and the
keyboard handling helper.

**As built** (differs from the above where it says so)
- **A new section, not the differences list:** `web/src/project/ReviewQueue.tsx`, "Review
  queue", one plot at a time, on the coordinator's Quality tab (after the counts, before the
  questions; the differences list below works as before, now also with an Earth Map link) and
  on the reviewer's (first). Decisions made in the queue update the coordinator's differences
  list; decisions made in the list reach the queue on its next load.
- **Every differing pair, not only the 500 listed:** the report now also gives `pairs` (every
  differing pair up to `MAX_PAIRS` 200,000, without answers: plot, first and check
  `{operator, recordKey}`, `latest`: the check is the plot's latest), in the same plot order;
  stripped from `GET /quality`. A plot beyond the 500 listed differences has its two records
  read when its page of the queue is shown (`store.getRecord`) and its differing answers worked
  out by `pairFields` (`src/quality.ts`, the report's rule: same questions, order, margins,
  blanks; a test compares it with the report). Without this, the plots after the first 500
  could never be reached (the report does not depend on the decisions).
- **The queue** (`src/reviewQueue.ts`, pure): each plot once, in the first part it belongs to,
  with all that is known of it (its pairs, its flags, who submitted it again, its decision):
  1. differing plots without a decision (plot order);
  2. plots with flags (Task 5's `patternFlags`, newest first) without a decision, and, for a
     decided plot, only `edited_after_decision` (deciding again takes it out);
  3. **submitted again after "Both need another look"** (`resubmittedAfterRecheck`,
     `src/flags.ts`, sharing `savedAgain` with `edited_after_decision`): a record of a plot
     decided recheck that is **submitted now** (the flag table's `saved` now keeps
     `submitted`), received after the decision, and either with answers the decision did not
     see (`seen`) or saved after it (submitting again with the same answers is also an
     answer to "another look"; going through the tabs alone leaves it unsubmitted). Without
     `seen`: submitted and saved after. Task 12 will bring these in by itself.
  Filters: person (anyone whose record is shown) and kind (`difference`, a flag kind,
  `resubmitted`). The flags looked at are `patternFlags`' newest 500 for the filters
  (`flagsCapped` says when there were more).
- **`GET /v1/projects/:pid/quality/queue?person=&kind=&offset=`** (coordinators and
  reviewers, collectors 403, never My work) → `{ items (100 from offset: plot, section,
  people, differences [Difference with fields], flags, resubmitted, decision (no seen)),
  offset, total, counts {difference, flag, resubmitted}, people, flagsCapped, labels,
  options, computedAt, stale }`. 400 for an unknown kind, a person over 1000 characters, an
  offset that is no whole number.
- **Reviewers decide** (Decision 3 says so now): `PUT` / `DELETE /quality/decisions/:plot`
  and `POST /quality/places` are `reviewer` (coordinators too); audited `decision.set` /
  `decision.deleted` with the actor; `seen` kept as before.
- **Bulk: `POST /v1/projects/:pid/quality/decisions:bulk` `{ rule }`** (coordinators only),
  `?dryRun=1` only counts. `bulkPlots`: among the differing plots without a decision,
  `first_by_reviewer` decides "first" where the first assessment is a trusted person's and no
  differing check is (both trusted: which is right is not clear); `check_by_reviewer` decides
  "check" where the plot's **latest** check (the one a decision for the check takes) differs and
  is a trusted person's and the first is not. **Trusted = reviewers and coordinators** (a
  coordinator who checks is at least a reviewer; the plan said reviewers). One statement in one
  transaction (`store.addQualityDecisions`: Postgres `INSERT … SELECT FROM unnest … ON CONFLICT
  DO NOTHING RETURNING plot`), so a plot decided meanwhile keeps its decision; each keeps its
  `seen` from the figures (`seenOf`), comment null. Answer `{ rule, decision, count, plots (20),
  dryRun }`. Audited once as **`decision.bulk` `{ rule, decision, count }`** (none when nothing
  was decided): **migration 015** widens `audit_log_action_check` (replaced only while it lacks
  the action; the activity test reads both 012 and 015).
- **Keyboard** (`web/src/reviewQueueView.ts`, pure, tested): `queueKeyAction`: 1/2/3 decide,
  J/K next/previous, C the comment, either case; nothing with Ctrl/Cmd/Alt; never while typing
  (inputs that take text, textarea, select, contenteditable, roles textbox/combobox/listbox/
  option/menu…), where only Escape counts (it leaves the comment for the card). The keys are
  listened to on the queue section (they work while the focus is in it: the card is focusable,
  with a 3 px focus outline) and written on the page; the buttons carry `aria-keyshortcuts`
  and their key. After a decision the queue moves to the next plot without a decision made here
  (`nextUndecided`) and focuses it; a polite live region says "Plot 12: Check is right. Now
  plot 13, 4 of 20." (also on J/K and undo). "Check is right" is disabled for a plot without a
  check (key 2 says so); "First is right" then keeps its assessment. Decided plots stay in the
  loaded list (Undo works); "Load the next plots" asks for the next 100 from offset = loaded −
  decided here. Stale figures: a "Show the newer figures" button, no automatic reload (it
  would move the list under the reviewer).
- **Earth Map:** as Collect Earth opens it (`BrowserService.earthMapUrl`, `earth_map_url` =
  `https://earthmap.org`): `https://earthmap.org?polygon=<GeoJSON Feature named by the plot id>
  &aoi=global&embed=true`. The desktop draws the plot's shape; the server knows only the
  centre (lat/lon files only, as Google Earth), so the polygon is a 100 m square around it
  (`earthMapUrl`, tested: ring closed, centred, a quote in the id kept valid). Next to "Open in
  Google Earth" in the queue and in the differences list. Not opened against the live site.
- **Texts:** 42 `queue.*` keys × 4 languages and the reviewer note (`i18n.ts` CRLF kept, as
  `api.ts`, `api.test.ts`, `ProjectPage.tsx`, `QualityDifferences.tsx`); no plural forms
  ("Plots to decide: 5").
- **Tests:** server 829 (was 817: `test/reviewQueue.test.ts` 4 — order, attachments, filters,
  the bulk rules; `test/reviewQueue.routes.test.ts` 4 — the queue through the route with a
  resubmission, roles, places for reviewers, reviewers deciding and undoing (audited), bulk dry
  run / apply / meanwhile decided / audit / 400 / 403, plots beyond the 500 listed read from the
  records; quality 2 — pairs, pairFields against the report; flags 2 — resubmitted; operator 403
  list and isolation extended), web 262 (was 254: `reviewQueueView.test.ts` 7, an api case),
  tsc clean in both, web build ok.
- **Postgres smoke** (`npm run smoke:pg:progress`, now also 015 and the queue): 3,333 differing
  plots, op6 a reviewer: `GET /quality/queue` 40-68 ms, a person 20-24 ms, offset 3,000 (200
  records read) 212-272 ms; bulk dry run 13-15 ms, 833 plots decided in 35-41 ms, `seen` kept
  for each, one audit entry, the queue 833 shorter. ALL OK; the Task 1 smoke ALL OK. Docker
  stopped after.
- **Chrome** (seeded memory server, built dashboard): the reviewer at phone width (keys 2, K, C,
  typing "1" in the comment did not decide, Esc back to the card; the announcement; J through
  the three parts; the resubmitted plot with its decision and comment; links); the coordinator's
  bulk dialog (5 plots) and result at phone and desktop width. No console errors. Fixed after
  looking: the heading read "Plot 61 of 13" (now "Plot 6 (1 of 13)"); the hidden live region
  was 100 % wide (MUI `width: 1`) and made the page scroll sideways.
- **Open:** the Earth Map square is not the plot's shape; flags of decided plots other than
  "saved again" are not in the queue; reviewers trusted for the bulk rules include coordinators;
  a decision made in the differences list reaches the queue only on reload; a save received in
  the same millisecond as the decision is not "after" it (as Task 5).

- **Review (after 8a96aa44; supersedes the above where it says so):**
  - **Keys from the bulk dialog** (an MUI portal: React sends its keys up the component tree to
    the section) no longer decide the plot behind it: `QueueKey.inside` (the DOM target inside
    the section, `currentTarget.contains`) must hold. **A held key** decides once: 1/2/3 and C
    are ignored when `repeat` (J/K repeat). **IME:** nothing while `isComposing`. An
    announcement the same as the last is said again (the live region is emptied first).
  - **Earth Map draws the plot as Collect Earth does** (`src/plotShape.ts`, from the CEP's
    `project_definition.properties`, read with the survey's facts and cached per served file):
    SQUARE and SQUARE_CIRCLE a square of side `distance × ((int)√points + 1 − 2) + 2 ×
    boundary` (SquareKmlGenerator; the demo survey 49 points, 10 m, 5 m: 70 m), top-left first,
    clockwise; CIRCLE 130 vertices and HEXAGON 6 at `distance + 5 m` (CircleKmlGenerator's
    margin), each offset rounded to whole metres. Metres to degrees on the WGS84 ellipsoid
    (`outlineRing`, web; tests against the Java numbers). NFMA, the NFI circles and plot files
    with a polygon column (KML, WKT, GeoJSON in the first row, as KmlGeneratorService decides)
    give only the place: the 100 m marker square, and the link says "Open in Earth Map (the place
    only)" with a tooltip that it marks the place, not the plot's shape. (Drawing the file's own
    polygons was left out: their geometry would have to be kept per plot.) The feature is named
    by the id the collector sees (`visibleId`: the keys hidden from the record list left out, as
    KmlGenerator.getVisiblePlacemarkId; a unit already without its hidden round part stays as
    it is). `POST /quality/places` → `{ places: [{ plot, lat, lon, name }], outline,
    unsupportedSrs? }`.
  - **Pages by cursor:** `GET /quality/queue?after=<part>:<time>:<plot>` (the answer's `next`,
    null on the last page) replaces `offset`: the plots after that place in the order (plot
    order for differences, newest first then plot for the others), so plots decided meanwhile
    by someone else make none skipped (route test with two people deciding; unit tests across
    parts and from a cursor whose plot was decided). 400 for a cursor that is not one.
  - **Plots beyond the 500 listed** are read in one query (`store.getRecordSummaries(projectId,
    keys)`, summaries without XML, deleted ones too; both stores; Postgres a join on unnest):
    68 ms for 200 records in the smoke (was 212-272 ms with 200 `getRecord`). A pair whose
    records no longer differ (or one is gone) comes with `changed: true` and the page says the
    records changed since the figures and to show the newer ones.
  - **Pairs compact:** `DifferingPairs` (plot, first and check record keys as string arrays, a
    people table, `first`/`check` Uint32Array, `latest` Uint8Array), built without an object per
    pair, its arrays handed over from the worker like the flag table's (`tableBuffers`). At
    200,000 pairs (`MAX_PAIRS`, kept) about 22 MB of heap, against 53 MB as objects (measured with
    `--expose-gc`, strings copied as after a structured clone). The queue items keep pair indexes;
    objects are made only for the page shown.
  - **The person menu** names everyone in the queue whatever the filters (everyone's flags are
    worked out too when a person or a flag kind is asked for; flags of decided plots do not add
    their person).
  - **Bulk runs found as a whole:** migration **016** adds `quality_decisions.decided_batch
    UUID` (indexed); each bulk run has an id kept on its decisions and in its `decision.bulk`
    audit entry (`{ rule, decision, count, batch }`) and in the answer (`batch`). A single
    decision made afterwards clears it. Undoing a run is not built.
  - **Own plots** (Decision 3): a reviewer gets 409 `own_plot` deciding or undoing a plot of which
    they have a saved record (first assessment or check, drafts too, as the figures hold them;
    the figures are worked out for a reviewer when none are at hand); a coordinator may, and
    decisions carry `byAssessor` (GET /quality, the queue, the PUT answer), shown as "Decided by
    someone who assessed this plot" in the queue and the differences list. Limit: a record sent
    after the figures were worked out is not known yet.
  - **The bulk confirmation** says that reviewers and coordinators are counted by their role in
    the project now and that someone removed never counts.
  - **Texts:** 6 keys × 4 languages (`quality.ownPlot`, `quality.byAssessor`,
    `queue.answersChanged` in place of `queue.answersMissing`, `queue.earthMapPlace`,
    `queue.earthMapPlaceTitle`, `queue.bulkRoles`).
  - **Tests:** server 839 (was 829: `plotShape.test.ts` 5 — the square and circle numbers, the
    shapes given only as a place, polygon columns, visible ids; queue unit 6 (cursor, person
    menu); queue routes 6 (cursor with two deciders, own plot 409 / byAssessor, a changed pair
    with the figures kept, batch ids); places with outline and name), web 267 (was 262: keys
    held / IME / outside the section, the outline ring in metres for a square, a circle and a
    hexagon, the URL; the api's cursor, changed, byAssessor, outline, batch), tsc clean in both,
    web build ok.
  - **Postgres smoke:** 015 and **016** applied twice; the queue 41-51 ms, after the 3,000th
    differing plot (200 records in one query) 68 ms; bulk 833 plots in 42 ms, each with the
    run's id, the earlier single decision without one. ALL OK; the Task 1 smoke ALL OK.
  - **Chrome** (seeded memory server, built dashboard): 1, J and Escape pressed in the bulk
    dialog did not decide or move the plot behind it; a held 1 (repeat) did not decide, a held J
    moved, a plain 1 decided and the announcement said so; the Earth Map polygon of the demo
    survey 70 m wide; the reviewer pressing 2 on a plot she checked got "You made the first
    assessment or a check of this plot, so someone else decides it." No console errors besides
    that 409.

## Part C: following the work

### Task 8: Plot search (improvement 12)

**Files:**
- Create `src/routes/plotSearch.ts` and `web/src/pages/PlotPage.tsx`.
- Add a search box to the project header.

**Build:**
- **`GET /plots/search?q=`** matches plot ids by prefix, at most 20, using the plot
  files' parsed ids (`plotFileCache.ts`).
- **`GET /plots/:plot`** returns:
  - its file and its people (main and copy);
  - every record with its round and summary;
  - the decision and comment, the flags, and the coordinates;
  - links to the plot file page and the differences list.
- **Who sees it:** coordinators and reviewers. A collector gets 403 (blindness: a
  collector must not see who else has the plot).

**Tests:** the search limits, the role checks and that it stays inside the project.

### Task 9: Map of progress (monitoring Phase 5)

**Files:**
- Create `src/routes/plotsGeo.ts` and `web/src/project/MapTab.tsx`.
- Add `leaflet` and `leaflet.markercluster` with exact versions, plus the licence
  note.

**Build:**
- **`GET /plots/geo?file=&person=`** returns compact
  `[lat, lon, statusCode, personIdx]` arrays, paged by 20k, lat/lon files only.
  Other coordinate systems are listed as "not on the map".
- **Colours by status:** not started, started, submitted, accepted, needs another
  look, disagreement. The legend text does not rely on colour alone.
- **Clustering** above about 5k points. A popup shows the plot's people, status
  and a link to the plot page (Task 8).
- **Base map:** OpenStreetMap tiles with the attribution shown, no keys.

**Tests:** the status codes, paging, and files with other coordinate systems
excluded.

### Task 10: Activity log, weekly summary, CSV downloads (monitoring Phase 6, no email)

**Files:**
- Create `web/src/project/ActivityTab.tsx` and `src/routes/activity.ts`.
- Create a printable `web/src/pages/WeeklyPage.tsx`.

**Build:**
- **The log:** the audit log merged with record events, filterable by person, kind
  and date, paged by cursor. For example "14:02 maria submitted plot 17".
- **The weekly summary,** printable: progress, the people table, a quality summary
  and the flags count.
- **CSV downloads:** the people table, daily activity, review decisions and
  differences.
- **A bell** in the project header listing the "needs attention" items, with the
  read state per coordinator (a small `attention_reads` table, with RLS).

**Tests:** merge order and paging, CSV escaping (formula injection: prefix `= + - @`
with `'`), and the read state.

### Task 11: Server owner's panel (monitoring Phase 7)

**Files:** extend `src/routes/admin.ts` and `web/src/pages/ServerPage.tsx`.

**Build:**
- Totals only, never project names in charts:
  - users: the number, sign-ups per week, active in the last 30 days;
  - projects: the number, active in the last 30 days, the storage of the largest
    ones (names are allowed here, since the server owner already lists projects;
    check the existing rule §4b and follow it);
  - records received per day;
  - database size, version and migrations applied;
  - failed logins and rate-limit hits per hour (counted in memory since start).
- **Actions:** disable an account (it cannot log in, its sessions go).

**Tests:** no project data leaks into the responses; disabling an account.

## Part D: re-assessments that come by themselves

### Task 12: Send back for another look ("To check again" plot file)

**Files:**
- Modify `src/routes/assignments.ts` (`my-assignment`, content), `src/routes/quality.ts`,
  `src/store/*` and the migration (in 012 if not yet applied anywhere, else 013).

**Build:**
- **"Both need another look"** sends the plot back to both people:
  - each gets a generated plot file "To check again – <file>.csv" in
    `my-assignment`, holding only their plots sent back, with the same round column
    as their original rows;
  - it gets a stable id and a checksum like the divided files.
- **After re-submission:** when a person submits the plot again (its record's
  `modified_on` is after the decision), the queue (Task 7) shows "re-submitted".
  The file drops the plot once both have re-submitted.
- **The comment** is shown in the dashboard and on My work. It reaches Collect
  Earth only through Task 16.

**Tests:**
- The generated file's content and checksum.
- That it disappears.
- Blindness: no other person's data in it.
- The round column.

### Task 13: Automatic check sampling (improvements 1 and 2)

**Files:**
- Create `src/sampling.ts` (pure).
- Create `src/routes/sampling.ts`.
- Add a section to `web/src/project/PlotFilePage.tsx` or a new "Checks" section on
  the Quality tab.
- Add store methods for a rule and for the new copy holdings.

**Build:**
- **A rule per project (or per divided file)** sets:
  - the checkers: the people who may receive checks; default all collectors and
    reviewers;
  - "check the first N plots of every collector" (default off; 10 suggested);
  - "check X % of submitted plots" (default off; 10 suggested), drawn evenly per
    person and per ISO week with a seeded shuffle, so a draw can be repeated
    exactly.
- **What a draw does:** it adds copy holdings (`overlap = true`) of submitted plots
  to a checker other than the plot's main holder.
  - It balances the load between checkers.
  - Plots that already have a copy are never drawn again.
  - The checker's files change, so they get the plots on their next Refresh,
    blind, with round 2.
- **When draws happen:**
  - on intake, coalesced: at most once per project per 10 min, after a stored
    `submitted` event;
  - and with a "Draw now" button.
  - Each draw is audited (`sampling.drawn`, with counts).
- **Limits:**
  - only divided files can hold copies; whole files are listed as "assign them by
    plot to use checks";
  - when there are no checkers, the page says so.

**Tests:**
- The seeded draw is deterministic.
- Even per person and week.
- The first-N rule.
- No self-checks.
- No double copies.
- Load balance.
- The intake trigger is coalesced.
- Records then pair as round 1 and round 2 in `qualityReport`.

### Task 14: Reference plots (improvement 3)

**Files:**
- Create `src/reference.ts`.
- Add store methods and the migration.
- Add a section on the Quality tab.

**Build:**
- **Setting it up:**
  - the coordinator marks plots of a divided file as reference, and holds them
    (main holding);
  - the server adds a copy holding of each reference plot for every collector
    (`overlap = true`), so the plots reach everyone blind as round 2.
- **Accuracy:**
  - per person and per question, the share of their round-2 answers that match the
    coordinator's round-1 answer;
  - shown as "accuracy against the reference";
  - kept apart from agreement, and left out of the agreement figures so they are
    not counted twice.
- **Many checks per plot:** `qualityReport` must handle several round-2 records of
  one plot. Check how it pairs today; if it takes only one, pair each check with
  the main assessment.

**Tests:**
- The copies are added.
- Accuracy figures.
- Reference plots are excluded from agreement.
- A collector joining later gets the copies.

### Task 15: Plots in an order that keeps neighbours together (improvement 4)

**Files:** `src/division.ts` (`DivisionOrder` gains `'nearby'`), the division UI,
and `i18n.ts`.

**Build:**
- Order `'nearby'` sorts the file's plots along a Hilbert curve over their lat/lon,
  then deals contiguous chunks the way `'file'` does, so each person's plots form a
  compact area.
- The order of rows within a person's served file follows the curve too.
- It is only offered for lat/lon files.

**Tests:**
- Hilbert ordering on a grid.
- Each share's bounding box is smaller than with `'mixed'`.
- A stored distribution round-trips.
- `parseDivisionRequest` accepts `'nearby'`.

### Task 16: The coordinator's note inside the plot (improvement 5)

**Files:**
- Modify `src/cep.ts` (rewrite) and `src/plots.ts` (served columns).
- Add to the real Collect Earth test.

**Spike first, in the real Collect Earth, then build.** Can the CEP rewrite add a
read-only text attribute `coordinator_note`, filled from a plot-file column through
`collectearth:fromcsv` and shown in the form? And can the served plot file carry
that column without moving the existing extra columns (`extraColumns[n]` is
positional)?

**Build, if the spike passes:**
- Only before collection, as for `round`.
- The note column goes at the end of every served row; it is empty for normal plots
  and holds the "To check again" comment (Task 12).
- The form shows it read-only, labelled "Note from the coordinator".

**If the spike fails,** record why in this plan and keep comments in the dashboard
and My work.

**Tests:** the CEP rewrite (idempotent; skipped when records exist), the served
columns and checksum, and the real Collect Earth form.

## Part E: data out and people outside

### Task 17: Collect Earth backup download (improvement 13)

**Files:** create `src/collectBackup.ts` and a route next to `export.csv`; add a
button on the Data tab.

**Build:**
- **Spike:** read the desktop's import code ("Import data from XML" or the backup
  restore) for the exact zip layout it accepts. Build a zip of the survey and every
  record's stored XML in that layout with `zipCep`'s writer.
- **Options:**
  - round 1 only, or all rounds;
  - only records whose `round` key exists (otherwise imports show conflicts, as the
    Project file page already says).
- **Audited** as `export.downloaded`, with its kind.
- **Real Collect Earth:** import it with 0 conflicts and check the IPCC export
  counts, on the backed-up profile.

**Tests:** the zip layout against a fixture made by the desktop's own exporter (if a
test fixture exists, or make one with Collect Earth), the round filter, and XML
escaping.

### Task 18: A read-only progress link for funders (improvement 15)

**Files:** create `src/routes/publicProgress.ts` and `web/src/pages/PublicProgressPage.tsx`;
add a migration table `share_links` (`project_id, token_hash, created_by, created_at,
revoked_at`), with RLS by `project_id` and lookup by hash through a SECURITY DEFINER
function or the owner path already used for invites.

**Build:**
- **Coordinators** create and revoke links. A link shows:
  - the project name and the totals;
  - the progress chart and the forecast;
  - quality agreement as a single figure.
- **It never shows** names, answers or plot ids.
- **Limits:** rate-limited, `noindex`, no cookies.

**Tests:** no names or answers in the response, revocation, isolation, and that the
token is hashed.

### Task 19: Email digests (improvement 16)

**Files:**
- Create `src/mail.ts` (a transport interface: `log` in dev, SMTP when `SMTP_URL` is
  set, with `nodemailer` at an exact version).
- Create `src/digest.ts` and `POST /v1/internal/digest`, protected by
  `DIGEST_SECRET` in a header, compared in constant time.
- Add a section to DEPLOY.md.

**Build:**
- **Who gets what:**
  - coordinators get the weekly summary (Task 10's figures, as a short text and
    HTML mail with a link);
  - collectors get their personal week;
  - only for accounts with an email, and only after opting in on the account page.
- **Unsubscribing** takes one link with a signed token.
- **"Someone stopped syncing"** goes into the coordinator's digest, not into a mail
  of its own.
- **Sending:** DEPLOY.md shows the Cloud Scheduler command to call the endpoint
  weekly. It is not created.

**Tests:**
- Content in 4 languages.
- Opt-in respected.
- The secret check.
- The unsubscribe token.
- The log transport by default.

### Task 20: Join page and My work say what coordinators see

**Files:** `web/src/pages/JoinPage.tsx`, `i18n.ts` and the desktop "joined" message
**only if it is not Swing** (otherwise the web text only).

**Build:** one sentence: "Coordinators of this project see when and how much you
work, and your answers. You can see the same on My work."

**Tests:** the i18n keys exist in 4 languages.

## Part F: the desktop and the end

### Task 21: Collect Earth sends its version (improvement 6)

**Files:**
`collect-earth/collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/cloud/CloudApiClient.java`
and its test.

**Build:**
- The `User-Agent` becomes `CollectEarth/<version> cloud-sync`, with `<version>`
  from `UpdateIniUtils.getVersionNameInstalled()`, or `unknown`.
- The server parses `CollectEarth/(\S+)` in `activity.ts` (Task 1). The release that
  hides checks is the first one that sends a version, so any version sent counts as
  "hides checks", and the old agent `CollectEarth-cloud-sync` means older.
- **Dependency:** Task 2's "old Collect Earth" card uses this rule. Write it in
  `src/clientVersion.ts`, with tests.

**Tests:** desktop unit test of the header, server tests of the parsing, and the
desktop suites green (core 40, app 210+).

**As built** (cd121399)
- **Desktop:** `CloudApiClient.USER_AGENT` is computed once, when the class loads, by
  `userAgentFor(UpdateIniUtils.getVersionNameInstalled())`. That method never throws: it
  gives `unknown` when `update.ini` cannot be read (logged as an error, as before) and
  null when the file has no `version`; a dev build run from `collect-earth-app` reads that
  folder's `update.ini`, `0.00.00`. Whitespace is removed from the version, so it is one
  token; null or blank gives `unknown`. A RuntimeException also gives `unknown`.
  `CloudApiClientUserAgentTest` checks the formatting and that a real request (to a local
  `HttpServer`, `getJoinPreview`) carries it. No Swing class changed.
- **Server:** `src/clientVersion.ts`: `parseClientAgent(agent)` gives
  `{ kind: 'collect-earth', version, hidesChecks: true }` for an agent starting with
  `CollectEarth/<v>` (`version` null for `unknown`), `{ kind: 'old-collect-earth' }` for
  exactly `CollectEarth-cloud-sync`, and `{ kind: 'unknown' }` for anything else (a
  browser, none, `CollectEarth/` alone, other casing). `isCollectEarthAgent` is true for the
  first two.
- **Only Collect Earth's agent is kept:** `noteActivity` (`desktop` routes) sets
  `client_agent` only when `isCollectEarthAgent`, so a coordinator downloading a plot file
  or the CEP from the dashboard no longer replaces it (the download still counts).
- **Tests:** server 617 (was 611: 5 parser tests, 1 route test), typecheck clean; desktop
  core 40, app 214 (4 new).

### Task 22: Final review and real runs

- **A Chrome run of every new page,** with seeded data, at phone width and in dark
  mode.
- **A Postgres smoke with about 100k records,** with `/progress` and `/people` under
  300 ms.
- **Real Collect Earth,** on a backed-up profile:
  - the "To check again" file arrives;
  - a sampled check arrives blind;
  - the note shows (Task 16);
  - the backup imports with 0 conflicts (Task 17);
  - the version reaches the dashboard.
- **A final code review** of the whole range, then DEPLOY.md and this plan's "As
  built" notes.

## Order

Tasks 1 → 21 → 2 → 3, then Part B (4–7), then Part C (8–11), then Part D (12–16),
then Part E (17–20), then 22. Task 21 goes early, because Task 2 uses its rule.
