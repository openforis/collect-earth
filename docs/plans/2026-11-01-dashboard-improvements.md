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
4. **Collectors are told** on the join page and on "My work" that coordinators see
   when and how much they work (as the monitoring plan says).
5. **Email** is built behind a transport that is off unless SMTP is configured; the
   weekly job is an HTTP endpoint for Cloud Scheduler, documented but not created.

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
