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
   **Their review queue leaves out the plots they assessed** (the 409's rule: a saved, not
   deleted record of a known round, first assessment or check, drafts too), before the counts,
   the people and the cursor; the page says how many ("Plots you assessed are left out (N):
   someone else decides them."). Coordinators keep the full queue.
   **Plot search (Task 8):** reviewers search plots and open a plot's page, trimmed: the plot
   files are named only (no main holders, copies or whole-file assignment lists), no deleted
   records, no time the server received each record; drafts stay (they are the queue's
   material). They decide from the page under the same rules. Coordinators see everything.
   **Map (Task 9):** reviewers see every plot's place and status, but no names: no person
   filter, no holders in the answer or the popups. What can still be inferred: a plot file
   divided by area shows where each block is, and the plot page (above) names who made each
   record, so a reviewer who opens plots one by one can work out whose they are, as plot
   search already allows.
4. **Collectors are told** on the join page and on "My work" that coordinators see
   when and how much they work (as the monitoring plan says).
5. **Email** is built behind a transport that is off unless SMTP is configured; the
   weekly job is an HTTP endpoint for Cloud Scheduler, documented but not created.
6. **“None” is an answer.** In survey health, an option labelled “None” / “Ninguno” /
   “Aucun” / “Nenhum” alone (“None (no disturbance)”) is a real answer, not a catch-all:
   its share is shown apart for information and is never a reason to reword. “None of the
   above” and its translations stay catch-alls with “other”, “unknown” and “no data”.
7. **Check sampling's share is cumulative per person (Task 13).** “Check X % of submitted
   plots” asks round(all of a person's submitted plots × X / 100), a half up, less the plots
   of theirs already covered (a copy or a check record); the ISO week only spreads the picks:
   the week with the fewest checks for its plots first, then the seeded order. So a part-time
   collector (4 plots a week at 10 %) gets checks (4 over 10 weeks), and a draw stays
   repeatable.

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

**As built** (differs from the above where it says so)
- **Search, from the plot files only** (`src/plotSearch.ts`, pure; `src/routes/plotSearch.ts`):
  an index per project of every plot unit of its files (`plotIdsOf`, the cache the other routes
  use), searched by the unit **and by the id the collector sees** (`visibleId`, as Earth Map's
  names: the keys hidden from the record list left out; an own round hidden from the list makes
  "17,2025" findable as "17"), case ignored. Keys sorted once; a search is a binary search and
  one pass over the ids starting with what was typed, the shortest first ("1", "10"…"19",
  "100"), each plot once, at most 20 (`MAX_SEARCH_RESULTS`), with `more`. The index is kept
  (`PlotIndexCache`, 4 projects) under a version of the files (id, checksum, name), the key count
  and the hidden keys, so a change of files or survey rebuilds it; one build at a time per
  project. Never a record read per keystroke.
- **`GET /v1/projects/:pid/plots/search?q=`** → `{ plots: [{ plot, name, files: [{id,
  filename}] }], more }` (400 for q over 1000 characters; blank q: none). **`GET
  /v1/projects/:pid/plots/:plot`** (the unit, URL-encoded; `/plots/search` without `q` is the
  page of a plot named "search") → `{ plot, name, files: [{ id, filename, divided, main,
  copies }], records: [{ operator, recordKey, round, assessment (main|check|other), submitted,
  deleted, modifiedOn, receivedAt, answers }], questions [{key,label}] (the survey's order,
  `excluded` keys such as ids and plot-file columns left out, keys the survey lacks after),
  labels, options, decision (no `seen`; `byAssessor` from the plot's records), ownPlot, flags,
  differences, figures {computedAt, stale}, place {lat, lon, name}, outline, unsupportedSrs? }`;
  404 for a plot in no plot file. Both `requireProjectMembership('reviewer')`: coordinators and
  reviewers; collectors and project tokens 403 (blindness); another project's member 404.
- **Plots in several files:** every file is listed with its people: a whole file → the people
  given it (the assignment grid) as main; a divided file → its main holders and its quality-check
  copies (`plot_assignments` of that plot).
- **Only that plot's records:** `rounds.recordKeysOfUnit(unit, info)` gives the keys the unit's
  records can have (the unit; the added round's codes put back, "1" and the reassessment code
  first; an own round's unit and the same plot with the reassessment code), read with the new
  **`store.listRecordsByKeys(projectId, keys)`** (any operator, summaries, no XML, deleted too;
  Postgres `record_key = ANY` on the primary key) and resolved with the figures'
  `recordResolver` over the plot's own units (an own round: the plot's other rounds, found in the
  index) and copy holders from the new **`store.listPlotHolders(projectId, fileIds, plotKeys)`**
  (`csv_file_id = ANY AND plot_key = ANY`, primary key). Drafts and deleted records are shown
  (marked). A record key with more parts than the survey has keys (a data problem) is not found
  this way.
- **Flags and differences from `QualityService.peek` only** (never awaited): `patternFlags`
  takes a `plot` option (that plot's flags whatever their age, beyond the newest 500; counts
  unchanged); the differing pairs are the report's `pairs` of the plot, their answers worked out
  with `pairFields` from the records just read (`changed` as in the queue). Without figures at
  hand both are null and the page says to open the Quality tab.
- **Deciding from the page:** coordinators and reviewers, through the same `PUT`/`DELETE
  /quality/decisions/:plot` (own-plot 409 unchanged). `ownPlot` (a reviewer with a non-deleted
  record of the plot) hides the buttons and says "someone else decides it". "Check is right" only
  with a submitted check.
- **Place:** the shared `PlotPlaceReader` (now one per server, given to the quality routes and
  plot search; `surveyFacts` public): Google Earth and Earth Map links with the plot's outline
  and visible name, as in the queue.
- **Web:** `components/PlotSearchBox.tsx` (MUI Autocomplete, asks 250 ms after the last key,
  stale answers dropped, Enter opens the first; each option says its files; "Only the first 20
  are listed: type more of the id.") in the project header beside the name, for coordinators and
  reviewers only (collectors' project page has no header search). `pages/PlotPage.tsx` at
  `/projects/<id>/quality/plot/<plot>` (route `plot`, under the Quality tab for both roles; the
  Quality tab clicked there goes back): back link, map links, a link to the Quality tab (queue
  and differences), Decision, Records (each with kind, person, round, state, saved time by the
  collector's clock) and an answers table with a column per record (answers by their labels,
  differing rows shaded), Worth a look, Answers that differ from a check, Plot files and people
  (file links to the plot file page for coordinators). `plotView.ts` (pure, tested). 38 keys × 4
  languages (`i18n.ts`, `api.ts`, `api.test.ts`, `router.ts`, `App.tsx`, `ProjectPage.tsx`
  written with CRLF kept).
- **Tests:** server 850 (was 839: `plotSearch.test.ts` 5 — prefix, shortest first, the 20 cap
  and `more`, case, visible ids and units each once, plots in several files, 200,000 ids;
  `plotSearch.routes.test.ts` 4 — search with limits, the index rebuilt for a new file, the page
  (files and people, records with rounds, only that plot's, no figures → null, then decision,
  flags, difference, ownPlot and the 409, 404), roles (collectors and project token 403 on both,
  another project 404 and nothing of this one), an own round (the check under the reassessment
  code); `recordKeysOfUnit`; flags of one plot beyond the 500; isolation list), web 274 (was 267:
  `plotView.test.ts` 4, the api, router cases), tsc clean in both, web build ok.
- **Postgres smoke** (`npm run smoke:pg:progress`, now also plot search): on the 100,000-plot
  divided file, `GET /plots/search?q=1` 47-52 ms the first time (index built; the ids already
  parsed), then 9-11 ms; `GET /plots/15` (divided, a copy, its difference) 155-173 ms the first
  time, another plot 48-56 ms; the two new store reads 7-10 ms; nothing of another project. ALL
  OK; the Task 1 smoke ALL OK. Docker stopped after.
- **Chrome** (seeded memory server, built dashboard): the coordinator typed "1" in the header
  box (20 plots, plot 1 "In north_region_plots.csv, checks.csv", the note to type more), Enter
  opened plot 1: both files with maria to assess and ben's copy, the two records and the answers
  table (Land use shaded), the very-fast flag, the difference, the map links; "Check is right"
  with a comment showed "By coord" at once. The reviewer rita at phone width: search "12", her
  own checked plot says someone else decides it, no buttons; no page-wide horizontal scroll; no
  console errors.
- **Open:** the "more" note under the box moves the header down while the list is open; the plot
  page loads the whole decision list to find one decision; `quality.outline` reads the served
  project file to hash it on each page (as the other quality routes); flags of a plot are worked
  out by a full `patternFlags` pass (~10-40 ms at 100k); a plot whose id is only in a record (no
  plot file) cannot be found (the queue's "plot in no file" problems still list them).

- **Review (after 8f5d9d1a; supersedes the above where it says so):**
  - **A reviewer's queue leaves out the plots they assessed** (Task 7 follow-up, Decision 3):
    `GET /quality/queue` gives `reviewQueue` the reviewer's plots (`plotsOf(figures.flags,
    username)`, the same rule as the 409's `plotOperators`) as `excluded`; they are dropped before
    the counts, the total, the person menu and the cursor, and the answer says how many
    (`excludedOwn`, plots that would be in the queue, whatever the filters). The page says "Plots
    you assessed are left out (N): someone else decides them." Coordinators: 0, the full queue.
  - **One rule for "assessed this plot"**: `assessesPlot(record, assessment)` (`src/flags.ts`: not
    deleted, a known round) builds the flag table's saved records (hence `plotOperators`, `plotsOf`
    and the 409) and the plot page's `ownPlot` and `byAssessor`.
  - **The reviewer's plot page is trimmed** (Decision 3): `files` = `{ id, filename, divided }`
    only (no `main`, no `copies`, no whole-file assignment list), no deleted records, no
    `receivedAt`; drafts stay. The page then titles the section "Plot files". Coordinators get
    everything.
  - **Enter never opens an older search's plot:** the box keeps each answer with the text it was
    for, and offers matches only for what is typed now (`shownMatches`); while the new answer is on
    its way the list is empty (loading).
  - **"Type more" is the list's last row** (a disabled option, read out), no longer a helper text
    that moved the header. A visually hidden live line says "N plots found." / "1 plot found." /
    "No plot found." once a search is answered (`foundMessage`).
  - **Shaded rows** compare only the first assessments and checks (a record of another round does
    not shade a row).
  - **Own round:** the index keeps each plot's units (`PlotIndex.byPlot`, built with the key
    shape), so a plot's other rounds are a map lookup (`unitsOfPlot`), not a scan of every unit.
  - **A plot file that cannot be read:** the index built without it is kept only `INDEX_RETRY_MS`
    (5 s, `PlotIndexCache` options `retryMs` / `now`), then built again; a complete index is kept
    until the files change.
  - **Route tests:** a plot named "search" (`/plots/search` without `q`), ids with a slash, spaces
    and non-ASCII letters (search and page), and the round the server added through the route.
  - **Texts:** 4 keys × 4 languages (`plotSearch.found`, `plotSearch.foundOne`,
    `plotSearch.foundNone`, `queue.ownLeftOut`); comments and the README say peek is "never
    awaited".
  - **Tests:** server 856 (was 850: queue unit 1 and route 1 for the left-out plots; plot search
    unit 1 (`unitsOfPlot`), routes 3 (the reviewer's shape and the shared rule with a deleted
    record, odd ids and "search", the index back-off)), web 276 (was 274: `shownMatches`,
    `foundMessage`; the shading rule, the api's `excludedOwn` and files without people), tsc clean
    in both, web build ok.
  - **Postgres smoke** (`npm run smoke:pg:progress`): ALL OK; `GET /quality/queue` 35-48 ms (the
    coordinator's; the smoke has no reviewer session), `GET /plots/search` 41 ms first, then 8-9 ms;
    `GET /plots/15` 165 ms, another plot 51 ms. The Task 1 smoke ALL OK. Docker stopped after.
  - **Chrome** (seeded memory server): the reviewer rita's queue says "Plots you assessed are left
    out (1)" and lists only plot 1; typing "1" listed 20 plots and the disabled last row "Only the
    first 20 are listed…", the live line said "20 plots found."; typing "2" and Enter at once did
    not navigate (then "11 plots found."); her plot page names the two files without people. No
    console errors.
  - **Open:** `plotsOf` scans the flag table's saved records once per reviewer request (not
    measured at 100k: the smoke has no reviewer session; one pass over ~120,000 entries).

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

**As built** (differs from the above where it says so)
- **Route `GET /v1/projects/:pid/map/plots?file=&person=&offset=&size=`**, not `/plots/geo`:
  `/plots/geo` would be static and shadow the page of a plot named "geo" (`GET /plots/:plot`).
  `src/routes/plotsGeo.ts` (thin) over `src/plotsGeo.ts` (pure). `requireProjectMembership
  ('reviewer')`: coordinators and reviewers; collectors and project tokens 403; another
  project's member 404 (isolation list extended). Answer: `points` `[lat, lon, status, holder]`
  and `plots` (each point's unit, for its page), at most `GEO_PAGE_SIZE` 20,000 a page (`size`
  1..20,000, `offset`, `next` null on the last page), a `version` (state version, survey SRS,
  filters, role) the same on every page of one map, and on every page `statuses` (the names of
  the codes), `counts` per status (the filters' plots, those off the map included), `notOnMap`,
  `files [{id, filename, plots, onMap}]`, `figures {computedAt, stale} | null`, `asOf` (the
  project state's time when stale), `unsupportedSrs?`. 400 for a bad offset/size, a file id
  not of the project, file/person over 1000 characters.
- **Statuses** (`geoStatus`, per plot unit, from `ProjectStateCache`'s `plotUnits`, which now
  also gives `started`, the set behind the totals' count; `isPlotUnit(info)` shared): 0 not
  started, 1 started, 2 submitted (the Progress tab's counts); a submitted plot decided
  first/check is 3 accepted, decided recheck 4 needs another look; else 5 disagreement when the
  figures at hand (`QualityService.peek`, never awaited) have a differing pair of it (the
  report's `pairs`). **Decisions come from the store, so they show without figures** (the plan
  note said only the first three without figures): only "disagreement" needs the figures, and
  the page says so ("Until then those plots show as submitted; decisions already made are
  shown"). A decided plot taken back to edit shows its own state (started).
- **Places** as `PlotPlaceReader` reads them (now `filePlaces`, kept per file checksum): the two
  columns after the keys, decimal comma accepted, lat/lon only; a plot in several files takes
  the first file listed that gives it a place, or the file asked for. A survey whose first SRS
  is not WGS84 puts nothing on the map (`unsupportedSrs`, every file `onMap` 0, the counts
  still there). Rounded to 6 decimals.
- **People (Decision 3):** coordinators get `people` (everyone holding a plot or with a first
  assessment: the person filter) and `holders` (distinct sorted groups of main holders, whole
  files and divided ones; `holder` indexes it, -1 nobody). The person filter = plots they hold
  or assessed first. Reviewers get `people`/`holders` null, every `holder` -1, and `person` is a
  403; their popup has status and the link only. Copies (checks) are not shown on the map.
- **Base map as a server setting:** `MAP_TILE_URL` (https with `{z}{x}{y}`, http only for
  localhost), `MAP_TILE_ATTRIBUTION` (needed with the URL, plain text ≤ 300),
  `MAP_TILE_ATTRIBUTION_URL`, `MAP_TILE_MAX_ZOOM` (1-22); unset = `OSM_TILES`
  (`tile.openstreetmap.org`, "© OpenStreetMap contributors" linked to the copyright page, zoom
  19); a bad value stops the boot with the reason. Sent as `mapTiles` in `GET /v1/server-info`;
  the web falls back to OSM for anything unusable (`toMapTiles`). DEPLOY.md "The map's base map":
  the tile usage policy (attribution, the browser's referrer, only tiles in view, `keepBuffer`
  1, `referrerPolicy` strict-origin-when-cross-origin), heavy use needs another source and how
  to set one (a key in the URL is public).
- **Web:** a **Map** tab (`PROJECT_TABS` after Plot files; reviewers: Progress, Map, Quality),
  `web/src/project/MapTab.tsx`. Leaflet 1.9.4 (BSD-2-Clause) and leaflet.markercluster 1.5.3
  (MIT), exact versions, released 2023-05 and 2021-10, `@types/leaflet` 1.9.22 and
  `@types/leaflet.markercluster` 1.5.6 (dev); bundled, loaded only on the Map tab
  (`project/leaflet.ts`, dynamic import; markercluster extends the global `L`, set first):
  chunks of 149 kB + 34 kB + 16 kB CSS, the main bundle unchanged. Licence texts in
  `web/public/third-party-licenses.txt` (copied into `web/dist`, served at
  `/third-party-licenses.txt`) and a README section (the repo kept no third-party notices
  before). `getMapPlots` reads the pages into typed arrays (`Float64Array` lat/lon, `Uint8Array`
  status, `Int32Array` holder), reads again from the start when a page's version differs (at most
  3 times), reports progress. Circle markers on one canvas renderer, one options object per
  status; from `CLUSTER_FROM` 5,000 shown plots a `markerClusterGroup` (grey numbered circles,
  compact numbers, not a status colour; clustering off from zoom 16), added to the map before
  `addLayers` so `chunkedLoading` keeps the page answering ("Placing the plots on the map: N of
  M…"). Statuses: Okabe-Ito colours plus a different fill/outline/dash/size each
  (`STATUS_STYLE`, a test checks no two differ by colour only), named in words in the legend
  table with the symbol, how it is drawn, the count and a checkbox to hide it. Popup built as DOM
  (no data as HTML): plot, status with its symbol, "Given to: …" (coordinators), "Open the plot's
  page" (in-app navigation to Task 8's page). Filters: plot file, person (coordinators). Notes:
  no figures, stale figures, as-of, other SRS, files with plots off the map (linked to the plot
  file page for coordinators), "type its id in the search box" for one plot. Keyboard: the map
  is a labelled region (Leaflet's arrows and +/−; the cluster circles are buttons); everything
  else is outside it. `mapView.ts` pure. 46 keys × 4 languages (`i18n.ts`, `api.ts`,
  `api.test.ts`, `router.ts`, `ProjectPage.tsx` written with CRLF kept).
- **Tests:** server 872 (was 856: `plotsGeo.test.ts` 7 — statuses, order and first place,
  holders and counts, filters, reviewer, checks and other SRS off the map, paging, 100,000 plots;
  `plotsGeo.routes.test.ts` 5 — statuses through decisions and figures, paging with one
  version and the 400s, filters, roles (reviewer without names, person 403, collector and project
  token 403, other project 404), another SRS; config 3 and server-info 1 for the tiles;
  isolation), web 285 (was 276: `mapView.test.ts` 6, api 2 — tiles, the pages into typed arrays
  with a restart; router), tsc clean in both, web build ok.
- **Timings** (memory store, seeded 100,000-plot divided file over Ghana, 47,000 records, 2,000
  checks, 60 decisions): `GET /map/plots` first page 417 ms cold (the project state built), then
  54-110 ms a page of 20,000 (~600 kB, gzip not on in the dev server). **Chrome, 100,001
  plots**: the six pages read by 0.54 s after navigation, Leaflet loaded by 0.6 s, every plot
  placed (clustered) at **1.13 s**; longest main-thread task 259 ms (it was a 3.4 s freeze
  before adding the group to the map first); JS heap 93 MB; hiding "Not started" (45,000
  left) 199 ms.
- **Chrome** (built dashboard): coordinator at desktop width (clusters over Ghana, the legend
  table, extra.csv's 2 plots off the map listed and linked, the file filter with one plot, its
  popup "Plot X-3 / Not started / Given to nobody", the link opened the plot page); the reviewer
  rita at phone width (Progress/Map/Quality tabs, no person filter, no name anywhere on the page,
  no horizontal scroll, zoomed in through the clusters to single dots, popup without people).
  No console errors from the page (a 401 of the login page before logging in).
- **Open:** plots at the same place show one popup (no spiderfy; the seed's duplicate places
  showed it); the map is reloaded by hand ("Load again"), not on a timer; Postgres not measured
  (no SQL added: the state and the places are the cached reads the Progress tab and plot search
  already make); checks' copies and plots in no plot file are not on the map; the per-status
  counts follow the filters, while the file list and person menu stay whole.

- **Review (after c7e165b8; supersedes the above where it says so):**
  - **One build per map, pages are its slices:** the first page (no `version`) builds the map
    and answers its `version` (a build id); the next pages send `?version=` and are served from
    that build (kept `GEO_BUILD_TTL_MS` 2 min, `MAX_GEO_BUILDS` 8, least recently used out), so
    decisions or records arriving meanwhile change no page of it. A build the server no longer has
    (expired, pushed out, another instance), or asked with other filters or another role, is 409
    `map_changed`. `getMapPlots` then reads the map again from the start, at most 3 times, and
    then throws that error ("The map changed while it was being read. Load it again."): a map is
    never returned in part (api test where every later page is a 409).
  - **Places per project, not through `PlotPlaceReader`'s shared cache** (which kept 8 files /
    250,000 places across all projects, so 9+ files or a big project made every page read the
    files again and pushed other projects out): `GeoPlaces` keeps each project's places of every
    plot file under its files' ids and checksums and the key count (4 projects), reading the files
    in parallel (`placesOfPlotFile`, now shared with the reader); a file that cannot be read is not
    kept. Route tests: 12 more files, pages 2..n read no file, a new map with the same files reads
    none, another project's map does not push this one out.
  - **Placing stops when the map goes:** markercluster's chunked loading cannot be stopped once
    started, so the plots are handed to the group 10,000 at a time (`PLACE_SLICE`), the next slice
    only when the last is placed and the map is still shown; leaving the tab or changing the map
    stops at the next slice. While plots are read or placed the filters, "Load again" and the status
    switches are disabled. Checked in Chrome by counting `addLayers` calls: leaving the tab after
    two slices, no further call and no long task. The first empty step markercluster reports when
    the group is added to the map is ignored.
  - **Tiles:** the map is made again only when the URL, attribution, its link or the zoom change,
    and `ready` is reset when it is removed. `MAP_TILE_URL` may hold only Leaflet's placeholders
    `{z} {x} {y} {-y} {s} {r}` (an unknown one such as `{apikey}` stops the boot).
  - **Submitted again:** a plot decided "both need another look" and submitted again since, by the
    review queue's rule (`resubmittedAfterRecheck` on the figures at hand), is status 6 "Submitted
    again, waiting for a look" (light blue, thick dotted border); without figures it stays "Needs
    another look". "Submitted" is now "Submitted, no decision", and a note under the table says that
    it, accepted, needs another look, submitted again and disagreement together are the Progress
    tab's submitted.
  - **Popups** show the plot as plot search lists it (`17,2025 (17)` when the collector sees
    another id): the answer has `names` (the visible ids) only when one differs from its plot id.
  - **Announcements:** the live line says "Placing the plots on the map…" once and the result once;
    the running count beside it is not read out.
  - **Decision 3** has a note on what reviewers can still infer from the map. **DEPLOY.md** Known
    limitations: no CSP header; with one, `img-src` must allow the tile host and `style-src` inline
    styles.
  - **Tests:** server 875 (was 872: route 2 — one build across pages with a decision made between
    them, the 409s, 12 files read once and kept apart from another project; the resubmitted status
    through the route; pure: resubmitted and names; config: placeholders), web 286 (was 285: the
    map never in part; 409 restart, names, the popup label), tsc clean in both, web build ok.
  - **Timings** (memory store, 100,000 plots in **12 plot files**, 47,000 records): first page cold
    384 ms, a new map warm 123 ms, next pages 10-55 ms. **Chrome:** every plot placed 1.03 s after
    opening the tab, longest task 144 ms, heap 101 MB; hiding "Not started" (45,000 left) 333 ms;
    the switches disabled while placing and enabled after; no console errors. Seeded server
    stopped, port free.
  - **Open (added):** decisions made between two maps (or within a build's 2 minutes, on its later
    pages) are not on that map: its counts can differ slightly from the Quality tab until "Load
    again". In a route test, a plot sent again with other answers but a `modifiedOn` before the
    decision was not counted as submitted again by the queue's rule either (the test now saves after
    the decision); worth a look in Task 7's `savedAgain`.

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

**As built** (differs from the above where it says so)
- **Coordinators only** (Decision 3): every route below is `requireProjectMembership('admin')`;
  reviewers and collectors 403, another project's member 404 (isolation list extended).
  `src/routes/activity.ts` (thin) over `src/activityLog.ts` and `src/weekly.ts` (pure).
- **The log: `GET /v1/projects/:pid/activity?person=&kind=&from=&to=&cursor=&limit=`** (limit
  1-200, default 50) → `{ items, next, people, files, persons }`. Both lists are read newest
  first by their own store calls and merged (`logPage`): a page takes up to `limit` rows from
  each list after its own position, merges them by time (a coordinator's action first at the
  same time), and the **cursor holds both positions** (`<events>_<audit>`, each `s` not started,
  `e` read to its end, or `<at>.<id>`), so rows at the same time in either list are never lost
  nor repeated, and rows added at the top meanwhile do not move the next pages (unit tests over
  page sizes 1-50 with many ties; route test pages 1/2/3/5). A cursor that is not one is a 400
  (also the store's `InvalidCursorError`).
  - **Kinds** (`LOG_KINDS`): `all`; Collect Earth's `records`, `submitted`, `resubmitted`,
    `draft` (created/updated), `unsubmitted`, `deleted`; the coordinators' `coordinators`,
    `decisions`, `people` (invites, removals, roles), `files` (project file, survey, plot files,
    assignments, division, moves), `settings`, `downloads`. **Store:** `listRecordEvents` takes
    `changes`, `listAudit` takes `actions`, `from` and `to` (both stores; Postgres `= ANY`).
  - **Person** = a username: their records by operator, their actions by their account (someone
    removed has none left: `removeMember` nulls the actor). **Dates**: `from`/`to` in ms, the
    browser's local midnights (`dayStartMs`/`dayAfterMs`). Record events are timed by
    `modifiedOn` (the collector's clock, as the store orders them), actions by the server's `at`;
    the page says so.
  - **Rows:** a record event → `{ type: 'record', at, receivedAt, person, change, plot (its unit
    for the plot page, null in no file), name (the id the collector sees: `visibleId` of the
    record key, the added round hidden), assessment, round }` resolved with the project state's
    `recordResolver` (coordinators only, so a check says so: "maria submitted the quality check
    of plot 17"). An action → `{ type: 'audit', at, person (null: a project key or someone no
    longer in the project), action, details, plotName? }`; ids in the details are named at read
    time in `people` (`{ name, removed }`: members as now; others by their account, marked
    removed; a deleted account has no name) and `files` (null: a file since removed).
  - Sentences are built in the web (`activityView.logSentence`): "maria submitted plot 17",
    "…started plot 17 (saved, not submitted)", "…saved plot 17 again, not submitted", "…submitted
    plot 17 again", "…changed plot 17 after submitting it (not submitted now)", "…deleted plot 17";
    "ana divided plots-north.csv between 4 people", "ana removed ben (no longer in the project)
    from the project", "ana decided plot 18: Both need another look", "ana decided 12 plots at
    once: First is right", "ana downloaded the daily activity"…; later tasks' actions fall back
    to "ana: link.created".
- **Weekly summary: `GET /weekly?week=YYYY-Www&tz=`** (no week: the viewer's current one; a week
  that does not exist 400) → `{ week, start, end, current, progress { days [7: plots first
  submitted and checks], submitted, checks, before, byEnd, totals (now) }, people [{ submitted,
  checks (that week), status and plots (as the People table has them now) }], quality {
  available, computedAt, stale, week (the report's `weeks` row of that ISO week: the check's
  last save, in UTC), overall, decided { first, check, recheck, total } (decisions whose
  `decidedAt` is in the week; a decision changed since keeps its last time), flags { counts,
  total } }, asOf }`. Plots and checks by the local day of their first submission, as Progress
  and People (`ProjectStateCache`); **the quality figures only from `QualityService.peek`**
  (route test: never worked out by this page). The week's flags: `patternFlags` got a `when`
  option (counts and lists only flags whose time passes it; the report's data problems, which
  have no time, are then left out; unit test). Printable page `web/src/pages/WeeklyPage.tsx`
  (`/projects/<id>/activity/week[/<YYYY-Www>]`, the report frame with Back and Print, week
  before/after/this week hidden when printed): plots done with a day table, each person's week
  (people with plots or work that week; "Done now"/"Status now" said to be today's), quality
  (decisions, agreement of the week and so far, flags of the week by kind, or a note to open the
  Quality tab), the zone.
- **Downloads: `GET /exports/:kind?tz=`**, `kind` people | daily | decisions | differences
  (else 404), each **audited `export.downloaded { kind, rows }`**. The server gives rows; the
  **CSV is written in the browser** by one writer, `web/src/csv.ts` (`csvCell`'s formula escaping
  of `= + - @` tab CR, the language's separators `,`/`.` or `;`/`,`, CRLF, BOM), which the people
  CSV now uses too (`peopleCsv` → `csvText`); the People tab's "Download as CSV" now goes through
  `GET /exports/people` so it is audited (`project/useDownload.ts`, shared).
  - `people`: the People table's rows. `daily`: per local day and person, plots and checks first
    submitted (the state), and from the record events submitted again, saves without submitting
    (created/updated), changed after submitting, deleted — **`store.recordEventCounts`** counts
    events by person, change and quarter of an hour (every zone's days start on one), the days
    worked out in JS. `decisions`: plot (visible id), decision, comment, by, when, by someone who
    assessed it (null without figures), decided in a bulk run. `differences`: one row per
    differing question of every differing pair of the figures at hand (the listed differences
    as they are, the pairs beyond them from one `listRecordSummaries` and `pairFields`), with
    the labels and options (answers written "Forest (F)"); **409 `no_figures`** when none are at
    hand (never computed for a download; the page says to open the Quality tab).
- **The bell** (`components/AttentionBell.tsx`, in the project header beside plot search,
  coordinators): `GET /attention` → `{ items: [{ key, read, item }], unread }`, the Progress
  tab's attention items (`attentionReader`, extracted from the progress route and shared), and
  `POST /attention/read { keys: [1-50] } | { all: true }` (a project key 403: read state is per
  person). **Key** = kind + 16 hex of sha256 of what the item says (count, people's names, level,
  quiet days, unknown versions; times and bytes left out), so a read item is new again when what
  it says changes. On each write only keys of the items there now are kept. **Migration 017**
  `attention_reads (project_id, user_id, item_key ≤ 100, read_at)`, PK of the three, FK to
  `project_members` ON DELETE CASCADE, RLS with the NULLIF policy; `removeMember`, `deleteUser`
  and `deleteProject` delete its rows (both stores; Postgres unit test). Store:
  `listAttentionReads`, `setAttentionReads` (replace, members only). Badge with the unread count,
  a popover dialog with each item's text (`attentionText`), "Go to …", "Mark as read", "Mark
  all as read"; asked again on open and 2 min after each load while visible.
- **Task 7 edge case fixed:** a record of a plot decided "both need another look", received after
  the decision with answers the decision did not see, is "submitted again" even saved before it
  (an offline edit synced later). The rule was already there; it missed answers that differ only
  in **calculated** questions (the demo survey's land use): `seen`'s hash, shared with "same as
  before", leaves calculated answers out. The flag table now also keeps `full` (every answer,
  calculated ones too) and decisions keep it in `seen` (`{ operator, hash, full }`); a decision
  kept before (no `full`) compares `hash` alone. The same rule serves `edited_after_decision`,
  the review queue and the map. Tests: flags (an offline edit, a calculated answer only, the same
  answers synced late, an old decision without `full`, the edited flag), the queue route (a late
  sync of the seen answers is not back, the offline edit is), the map route (now with a
  `modifiedOn` before the decision).
- **Web:** an **Activity** tab (`PROJECT_TABS` before Settings; coordinators): weekly summary
  link, the log (person, kind grouped as Collect Earth / Coordinators, from/to dates, "Show
  older ones" by cursor with a polite announcement, "Open the plot" links), the four downloads.
  `activityView.ts` pure (sentences, ISO weeks in the browser's calendar, day bounds, CSVs).
  154 keys × 4 languages (French "parcelle", Spanish tab "Avance"… as the catalogue has them);
  `i18n.ts`, `api.ts`, `api.test.ts`, `router.ts`, `App.tsx`, `ProjectPage.tsx` written with CRLF
  kept.
- **Tests:** server 897 (was 875: `activityLog.test.ts` 7 — merge over page sizes with ties, one
  list, rows added meanwhile, cursors, kinds, the memory store's filters; the bell's keys;
  `weekly.test.ts` 3; `activity.routes.test.ts` 7 — the log with names, paging/person/kind/
  window/400s, removed people, roles, the weekly summary from figures at hand only, the four
  downloads and their audit, the bell's read state through changes and removal; memory store
  reads and counts; flags 2; queue route 1; isolation; Postgres unit), web 300 (was 286:
  `activityView.test.ts` 7, api 4, router), tsc clean in both, web build ok.
- **Postgres smoke** `npm run smoke:pg:activity -- <port>` (`scripts/pg-smoke-activity-log.mts`,
  README): 017 twice, RLS of `attention_reads` (with B set A's rows neither read nor written; with
  `''` none), reads gone with the member; **100,000 record events + 2,000 actions: all 102,000
  rows read once over 510 pages of 200, a page 11-29 ms (median 13)**; a first page of 50 12 ms,
  a person 11 ms, a rare kind (deleted, 100 of 100,000) 20 ms, decisions 11 ms, a date window
  10 ms, person + kind 9 ms; the weekly summary 16-20 ms; the daily download 290-300 ms (4,200
  rows, the drafts and deletions add up). ALL OK; the Task 1 and progress smokes ALL OK. Docker
  stopped after.
- **Chrome** (seeded memory server, built dashboard): the Activity tab at 1920 and 500 px (no
  page-wide horizontal scroll), the log with "Show older ones" (rita's checks named as quality
  checks, ben "no longer in the project"), the bell (4 new, one marked read → 3), the weekly
  summary of week 44 (61 plots, 20 checks, 70 % agreement), the four downloads (the comment
  "=look again" written "'=look again", answers "Wetland (W)") and the four "downloaded" rows in
  the log. No console errors from the page. Fixed after looking: the filters took the whole width
  (the theme's TextField `fullWidth`), the empty person filter showed no "Everyone", the title
  read "Week 2026 · 44".
- **Open:** the log's record rows are timed by the collector's clock (a clock ahead puts a save
  above later actions); the plot and round of a record are resolved with the holdings as they
  are now; the weekly agreement is the report's UTC week; checks of removed people are not in the
  weekly per-day checks; the bell refreshes every 2 min, not on push; read keys of a coordinator
  demoted to reviewer stay until they leave.

- **Review (after 718fac88; supersedes the above where it says so):**
  - **Line endings:** 718fac88 had turned nine LF files into CRLF (a Python script on Windows
    writing in text mode); a separate commit put them back to LF with no other change (`git diff
    --ignore-all-space` empty), the new files written with CRLF too. Every other file touched keeps
    its ending (CRLF: `i18n.ts`, `api.ts`, `api.test.ts`, `router.ts`, `App.tsx`,
    `ProjectPage.tsx`). Two literal NUL bytes in `memory.ts` (`recordEventCounts`' key) and an
    \x01 in the differences' key are escapes again; no other control bytes in the files touched.
  - **Times Postgres cannot hold are a 400, not a 500:** `isStoredTime` (`MIN_STORED_TIME`
    −210,866,803,200,000 ms, timestamptz's first day; `MAX_STORED_TIME` 8.64e15, a JS Date's
    last; a valid Date). `checkCursor(cursor, { from, to })` checks a cursor's time and a window's
    bounds in both stores (so `listRecordEvents` / `listAudit` refuse them before any query, for
    every caller), `decodeLogCursor` refuses such a time, and the route's `from` / `to` too.
    Tests: the route (`?cursor=9000000000000000.1_s`, `?cursor=s_-300000000000000.1`,
    `?from=9000000000000000`, `?to=-8000000000000000`), the memory store, the Postgres unit test
    (no query sent) and the smoke.
  - **A list none of whose rows a page showed** resumes below what was shown (`{ at: the last
    row's time, id: 999999999999999999 }`, or where it was when that is further down), not from
    its top: a row arriving there meanwhile (newer than what was shown) is no longer shown below
    older ones (unit test).
  - **Check sentences agree in gender** in es, fr and pt: `activity.check.*` (six sentences, "el
    control de calidad … (guardado, sin enviar)", "le contrôle … (enregistré, pas envoyé)", "o
    controle … sem enviá-lo") beside `activity.record.*` for plots ("la parcela … guardada");
    `activity.plot`, `checkOf` and `plotRound` gave way to `activity.roundOf` ("17 (ronda 2025)").
  - **Differences download:** the figures now keep the **margins they were worked out with**
    (`ServedReport.margins`), and a pair beyond the listed differences is compared with those
    (also in the review queue and the plot page), not with margins changed since; a pair whose
    record was deleted since is a row `status: 'gone'`, one that no longer differs `'changed'`
    (key and answers null), both named in the CSV's question column, instead of being left out.
    Number questions' answers are numbers in the CSV (the language's decimal: "12,5"), not text
    (`numbers` in the answer); other text keeps the formula escaping. Route test with 510 pairs
    (margin 0 when worked out, 50 since; one check deleted, one corrected).
  - **"Mark all as read"** sends the keys of the items shown, so one that arrived or changed
    since the list was loaded stays new.
  - The time zone fallback (UTC) stays as it is.
  - **Tests:** server 899, web 301, tsc clean in both, web build ok. **Postgres smoke** ALL OK
    (the four out-of-range queries 400, the store refusing the cursor itself; pages of 200 in
    13 ms median, 33 ms max). Docker stopped after, ports free.

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

**As built** (differs from the above where it says so)
- **§4b decides the names: none.** The task allowed project names "since the server owner
  already lists projects", but they do not: §4b (platform plan) and the dashboard plan say a
  platform admin is not a member of any project and sees accounts and project *counts* only,
  and `/v1/admin/ai-usage` already lists projects by id. So the panel shows the largest projects
  **by id and size only**; no project name, no person's name, no answer, no file name.
- **`GET /v1/admin/overview`** (platform admin; 401 / 403 otherwise) → `{ asOf, users { total,
  disabled, platformAdmins (enabled), active, signupsByWeek [12 ISO weeks, UTC, empty ones too:
  { week "2026-W45", start, count }] }, projects { total, active, storageBytes, largest [10 × {
  projectId, storageBytes }] }, records { received, receivedByDay [30 UTC days, today included] },
  database { backend, sizeBytes, version, migrations { applied, shipped, latest, newestAppliedAt,
  missing } | null }, server { version, startedAt }, security { since, totals { failedLogins,
  rateLimited }, hours [{ hour, failedLogins, rateLimited }] } }`. Pure assembly in
  `src/serverPanel.ts` (`buildOverview`, `statsWindow`, ISO weeks); the route is thin.
  - **Active** = in the last 30 days. An account: a session created (logged in) or
    `member_activity.last_seen_at` in any project. A project: a member seen or a record event
    received. **Records received** = `record_events` by `received_at` (stored uploads; a plot
    saved 3 times counts 3, the page says so). **Storage** = what the storage limit counts
    (`getProjectStorage`: CEP, plot files, records' XML and summary).
  - **RLS is not weakened.** `store.platformStats` reads the global tables (users, sessions) on
    the pool as counts, and each project's data under its own `app.current_project` in one
    read-only transaction (`eachProject`, as `aiUsageSince`); `storageOf(client, pid)` is shared
    with `getProjectStorage`. No SECURITY DEFINER function, no owner pool.
  - **Database:** `pg_database_size`, `server_version`; **migrations applied** from a new
    `schema_migrations (name, first_applied_at, last_applied_at)` (018): there was no migrations
    table (the files are idempotent and run every boot), so `runMigrations` now records every file
    after running them (`migrationFiles()` exported), and the panel compares with the files the
    server ships (`missing`). Before 018 runs, "not recorded yet"; the memory store: nulls ("data
    in memory").
  - **Failed logins and refusals per hour:** `src/serverCounters.ts` (`ServerCounters`, in
    memory, hours of the last 7 days kept, totals since start). Failed logins counted in the
    login route (wrong username or password); refusals = the rate limiter's 429s
    (`RateLimiter` got `options.onRefused`, called by `guard`) plus the login-failure lock's 429s.
    Per instance and since its start; the page says so.
- **Disabling an account:** `POST /v1/admin/users/:uid/disable` and `/enable` → `{ user }` (the
  account list's row). **Migration 018:** `users.disabled_at`, `users.disabled_by` (FK, ON DELETE
  SET NULL); users stay a global table (002/004: not under RLS, read by key or as counts).
  - Disabling deletes the account's sessions and reset links in one transaction; login with the
    right password answers **403 `account_disabled`** with a sentence ("This account has been
    disabled by the administrator of this server. Ask them to enable it again."); a wrong
    password still answers 401 as before (no hint without the password). `resolveSession` also
    refuses a disabled account's session (joined with users), so a session made in a race does
    not pass. Register/sign-up with its name: `username_taken` as before (the name stays taken);
    there is no "join with an existing account" route. A reset link for a disabled account: 409
    `account_disabled`.
  - Refused: yourself (409 `own_account`), the last enabled platform admin (409
    `last_enabled_admin`; `disableUser` checks it under an advisory lock and `FOR UPDATE`, so two
    admins disabling each other at once leave one: smoke). `countPlatformAdmins` now counts
    enabled ones, so deleting your account while the only other admin is disabled is refused.
  - **Audit: the server log, not a table.** `audit_log` is per project and RLS-bound; an account
    is global. A platform table for two actions would be one more thing to clean in
    `deleteUser` and to show; instead each disable / enable is a structured server-log line
    (`account.disabled` / `account.enabled`, actor and target ids; Cloud Logging keeps it) and the
    account row keeps who and when (`disabledAt`, `disabledBy` in the list). Password resets were
    not audited either.
  - **Collect Earth (checked in the code, no change):** there is no re-login prompt on a sync
    401. `CloudSyncService.uploadAndApply` takes a 401 as a whole-batch failure: logged once as
    "offline", each record marked failed with exponential back-off up to 1 hour, so it does not
    loop; the plots stay in the queue. The collector logs in again from the cloud settings
    (`CloudLoginDialog`, Swing, untouched), which shows the exception text: "Login failed with
    HTTP 403: {"error":"account_disabled","reason":"This account has been disabled…"}" (the
    server's sentence is readable inside it). After enabling and logging in, the queue goes.
- **Web (`ServerPage.tsx`):** a "How the server is doing" card first: five figures (accounts with
  disabled and administrators, active accounts, projects with active ones, space, saves received),
  saves per UTC day and new accounts per week (the People pages' `ColumnChart` with a Chart / Table
  switch), largest projects by id, the database, failed logins and refusals (totals and a table of
  the hours that had any). Accounts: a "Disabled" chip with who and when, Disable (confirm dialog
  saying what happens, Collect Earth included) / Enable, not on your own row; no reset link for a
  disabled account. `api.ts`: `getServerOverview`, `setUserDisabled`, `AdminUser.disabledAt/By`,
  three error codes. 53 keys × 4 languages (`i18n.ts`, `api.ts`, `api.test.ts` CRLF kept).
- **Tests:** server 914 (was 899): `serverPanel.test.ts` 10 (platform admin only; no project name,
  username, answer or XML in the answer; counts, sign-ups by ISO week, active accounts and projects
  with a fake clock; database on memory; failed logins; rate-limit refusals; disable → sync 401,
  `/me` 401, login 403 with the sentence, wrong password 401, no reset link, listed with who,
  enable → login and sync; own account, unknown, non-admin; another admin yes, the last never; ISO
  weeks over year ends), `serverCounters.test.ts` 3, `migrate.test.ts` (schema_migrations
  recorded under the lock), `postgresStore.test.ts` 2 (each project's reads under its own setting,
  read-only; the lock before the account read), `dashboard.test.ts` (the new fields). Web 302 (api
  test of the overview, disable/enable and the codes). tsc clean in both; web build ok.
- **Postgres smoke** `npm run smoke:pg:panel -- <port>` (`scripts/pg-smoke-server-panel.mts`,
  README): 018 twice, `schema_migrations` with all 18 files; **the overview on 100,000 records and
  their events in 5 projects: 109-125 ms** (5 runs); received and storage equal to SQL, no project
  name, username or answer in the body, the per-day query on the new `(project_id, received_at)`
  index; the app role still bound by RLS (with B set none of A's records or events; with '' none);
  disable/enable through the server; a raced session refused; two admins disabling each other at
  once leave one. ALL OK; the Task 1 and Task 10 smokes ALL OK. Docker stopped after, port free.
- **Chrome** (memory server, built dashboard, 2 projects, 4 collectors, 355 saves): the panel at
  1400 px and at 500 px (no page-wide horizontal scroll once laid out), Disable ben through the
  dialog → chip "Disabled", "Disabled on … by owner", Enable button, status message; ben's login
  then 403 with the sentence. Fixed after looking: "1 server administrators" (now "Server
  administrators: 1"). The page has no dark theme of its own (as before).
- **Open:** counters are per instance and lost on restart (by design; no table); the panel is
  read on demand (no cache): about 110 ms at 100,000 records, it reads every record's size per
  project, so a server with millions would want the sizes cached; `schema_migrations` knows
  only runs from 018 on (the first records all files at once); Collect Earth shows the 403 inside
  its generic "Login failed with HTTP 403: {json}" text: parsing `reason` in `CloudApiClient`
  (not Swing) would read better, left for a desktop task; Task 22's real run should check that
  logging in again from Collect Earth's settings lets the queued plots go.

- **Review (after fd099cc5; supersedes the above where it says so):**
  - **The last enabled admin on deletion too:** `deleteUser` (both stores) takes the same
    advisory lock as `disableUser`, reads the account `FOR UPDATE`, counts the other enabled
    admins and returns `'last_platform_admin'` (changing nothing) when there are none; the memory
    store checks and deletes with no await in between. `DELETE /v1/me` now deletes the account
    first and only then the projects only that person was in, so a refusal deletes nothing.
    Tests: two admins deleting their accounts at once through the route (one 204, one 409), the
    store's refusal, the Postgres SQL order; smoke: two racing deletions leave one admin. DEPLOY.md
    gives the SQL that enables an admin again if a database edit left none.
  - **The overview is kept 60 s per instance** (`asOf` says when it was worked out, the card says
    "Figures as of …", at most once a minute), dropped when an account is disabled or enabled, and
    the route is behind the rate limiter (`admin` bucket). Smoke: 128 ms worked out, 3-4 ms kept.
  - **Reset links only for an enabled account, in one statement:** `createPasswordReset` returns
    null for a disabled (or unknown) account (`INSERT … SELECT … WHERE disabled_at IS NULL`; the
    memory store the same); the route answers 409 `account_disabled`.
  - **Projects see a flag:** `listMembers` gives `disabled` (a flag only, not when or by whom); the
    member list shows "Disabled by the server administrator"; the People tab's status is
    **"Account disabled"** (`{ kind: 'disabled' }`, said before anything else), and the Progress
    tab's "quiet" and "never downloaded" leave disabled members out. Open: a project whose only
    coordinator is disabled cannot be managed until the server owner enables them (DEPLOY.md).
  - **Active accounts leave disabled ones out** (both stores).
  - **`newestAppliedAt`** (was `lastAppliedAt`): when the newest recorded migration first ran.
  - **Keyboard focus:** the Disable / Enable and confirm buttons stay enabled (a second press while
    one is on its way does nothing); after the change, and after Cancel, the focus goes to the
    row's Disable / Enable button; the Disable button gives up the focus before the dialog opens,
    and the dialog does not restore it, so Chrome no longer warns about aria-hidden on a focused
    element (checked in Chrome: focus on "Enable" after disabling, on "Disable" after enabling and
    after Cancel, no console warning).
  - **pt:** "próxima inicialização", "Peça ao administrador".
  - **`schema_migrations` read-only for the app role:** `prepareAppRole` revokes INSERT, UPDATE,
    DELETE and TRUNCATE on it after the blanket grant, on every boot (`runMigrations` writes it as
    the owner, before). Smoke: the app role's INSERT is refused (42501), its SELECT works.
  - **Tests:** server 924, web 304; tsc clean in both; web build ok. Panel smoke ALL OK (new: the
    member flag, no reset link, not active, the read-only table, racing deletions); the Task 1 and
    Task 10 smokes ALL OK. Docker stopped, ports free.

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

**As built** (differs from the above where it says so)
- **Nothing stored, no migration:** the files are worked out on each request from the decisions
  and the records (`src/sendBack.ts`). Undoing the decision (`DELETE`) or changing it to first /
  check takes the plots out at once; deciding "Both need another look" again (a new `decidedAt`)
  sends the plot back again to everyone. The audit stays the decision's `decision.set`.
- **Who gets it:** everyone with a record of the plot that is not deleted and of a known round,
  first assessment or check, drafts too (`assessesPlot`, the rule of the figures' saved records
  and of the queue's `plotOperators`): the main assessor and every checker, each only their own
  plots. **Per person, not "once both have":** a person's plot leaves *their* file as soon as they
  submit it again (`countsAsSavedAgain`, now exported from `src/flags.ts` and used by
  `savedAgain` itself, so the queue, the map and the files share one rule: submitted now, received
  after the decision, with answers the decision did not see or saved after it). The other person
  keeps it until they submit too. Their records are read live by key (`listRecordsByKeys` of
  `recordKeysOfUnit` for every recheck plot), not from the figures, so the file follows the
  records at once; their answers are hashed as the flag table does (`answerDigests`, tested equal
  to the figures' `seen` hashes with and without an outline, on a subset of the records).
- **The file:** one per plot file, named `To check again – <file name>` (en dash, U+2013, English
  for everyone: the server does not know the collector's language), id `recheckFileId(csvFileId)`
  (a UUID v5-shaped sha256 of the plot file's id: the same for both people and on every call),
  listed in `my-assignment` **after** the person's other files, with `checksum`, `plotCount` and
  `downloadPath …/csv-files/<id>/content?mine=1&v=<checksum>` like the divided files (409
  `changed` when it changed between the list and the download; 404 for anyone with no plot in it,
  coordinators too: it is per person). Its rows are the plot file's header and the rows of the
  person's plots in file order, with **the round column of their own record**
  (`roundColumnOf(info, checks)`): the round the server adds gets 1 on a first assessment and 2 on a
  check; an own round with a reassessment code gets that code on a check; without a round the rows
  are as uploaded (a checker's record still resolves as a check through their copy). So a sent-back
  check is served exactly as the copy was: blind, and its key is the checker's record key. Where a
  plot is in several plot files, the first (files' order) in which the person holds it (a whole file
  given to them or a holding of a divided one), else the first that has it. A plot in no plot file
  is in no file (My work still lists it). Built files are kept in the same LRU as the divided files
  (`recheck:` keys).
- **Content-Disposition:** a header may hold nothing beyond Latin-1, so the "–" would have made
  every download of the file a 500 (as any uploaded name beyond Latin-1 already did): now
  `attachment; filename="<ASCII, others as _>"; filename*=UTF-8''<percent-encoded>` for all plot
  files (`attachment()`); Collect Earth does not read this header.
- **What Collect Earth does with it (checked in the desktop code; the real run is Task 22):**
  - `CloudApiClient.getMyAssignments` reads `csvFileId, filename, checksum, downloadPath,
    plotCount` of each entry; only the plot settings use it (`SampleDataPanel`: a combo filled on
    opening the settings and on Refresh, label "<filename> (<plotCount>)"). Nothing else in the
    desktop calls it: the file appears on the next Refresh or the next time the settings are
    opened, never by itself.
  - `populateAssignments` selects the entry whose `filename` the path of the plot file in use ends
    with, the **last** such entry, else the first entry. "…/To check again – north.csv" also ends
    with "north.csv", so the generated file is listed after the others: then the right entry is the
    one *selected*. **But two downloads race (corrected in the review below):** `removeAllItems`
    then the first `addItem` into the empty combo selects entry 0 by itself
    (`DefaultComboBoxModel.addElement`), which fires the listener and starts its download; then
    `setSelectedItem` (or `setSelectedIndex(0)`) fires it again for the entry chosen. Whichever
    download ends last sets the plot file field. So someone on "To check again – north.csv"
    (listed last) can find the field showing "north.csv" after reopening the settings, likely when
    north.csv is the bigger file. The person chooses the entry and presses Apply, as for any plot
    file.
  - `downloadAssignedCsv` writes it to `<project folder>/assignments/<filename>` (`new
    File(filename).getName()`, refused outside that folder) and checks its sha256 against the
    listed checksum. **It never deletes a file**: a file that leaves the list (all its plots
    submitted again, or the decision undone) stays on disk and stays the plot file in use until the
    person picks another; its plots are then already submitted. Downloading again overwrites it.
  - **The name on Windows:** "–" and accented letters are fine in NTFS names and in Java's `File`.
    The plot file's path is kept in `earth.properties` (`LocalPropertiesService`: `FileReader` /
    `FileWriter` with `Properties.load/store(Reader/Writer)`, the JVM's default charset both ways:
    UTF-8 on JDK 18+; "–" also exists in windows-1252), the KML's description (`plotFileName`,
    `loadApp.fmt`) and the balloon's `plot_file` parameter (`BalloonServlet`) carry it as text.
    The same holds for any non-ASCII name a coordinator uploads.
- **My work and the person page:** `quality.sentBack` now comes from the same function
  (`sentBackTo`, given the project state's plot context) instead of the decisions and
  `OperatorWork.mainGroups` (removed): the plots sent back to them, first assessments and checks
  alike, each `{ plot, comment, decidedAt, decidedBy (coordinators only), submittedAgain, file }`
  (`file`: the "To check again" file it is in, while waiting). Never `assessment` or anything that
  says which is a check (route test serializes My work; smoke too). The pages add "Submitted again"
  or "In Collect Earth: the plot file “…” in the plot settings (press Refresh there to see it)."
  The comment reaches Collect Earth only through Task 16.
- **The review queue** (`GET /quality/queue`): an item decided recheck has `waiting`: the people
  with a record of the plot in the figures (`plotOperators`) who have not submitted it again
  (`resubmittedAfterRecheck`); the card says "Still to submit it again: jose." or "Everyone it was
  sent back to has submitted it again.". The parts of the queue are unchanged (a plot comes to
  "submitted again" when anyone has). The comment field (queue and differences list) now says that
  with "Both need another look" each person who assessed the plot reads the comment on My work, and
  not to say which of them made the check.
- **Texts:** 5 keys × 4 languages (`person.sentBackFile`, `person.sentBackAgain`,
  `queue.waitingFor`, `queue.allSubmittedAgain`, `quality.commentSeen`); `i18n.ts`, `api.ts`,
  `api.test.ts`, `QualityDifferences.tsx`, `server.ts` written with CRLF kept.
- **Tests:** server 932 (was 924: `test/sendBack.test.ts` 8 — pure: who, their assessment,
  deleted, submitted again or a draft; the file per plot file and the held file first; the id; the
  route: both people's files parsed with `parsePlotFile` as Collect Earth reads them (keys `2,1` /
  `2,2`, checksum, a quoted field and CRLF kept, a non-ASCII file name, the Content-Disposition), listed last,
  stable, a second plot (the old checksum 409), nobody else's (404, coordinators too); per person
  after submitting again (the seen answers synced late and a tabs-only draft do not count), the
  queue's `waiting`; undo and change; an own round (the check with the reassessment code); a whole
  file without a round, the check from its divided file, My work and the person page; flags 1 — the
  hashes; people updated), web 304 (two cases extended: the queue's `waiting`, the sent-back fields), tsc clean in both, web
  build ok.
- **Postgres smoke** (`npm run smoke:pg:progress`, no new SQL; now also Task 12 on the 100,000-record
  project): plot 15 sent back, op15 (first) and op16 (check) each get "To check again – big.csv"
  with only plot 15 under one id, op17 nothing; op16's My work lists it with the comment and the
  file, saying nothing of a check; op15 submits again: gone for op15 only; undone: gone for op16.
  **GET /my-assignment 259-337 ms** for someone with a plot sent back (the plot context: the
  100,000-plot file and 20,000 holdings read again each call), 62 ms for op17 (decisions and the
  plot's records only), 26 ms with no recheck decision. ALL OK. Docker stopped after.
- **Open:** my-assignment (and the download after it) loads the plot context again for a person
  with plots sent back (~0.3 s at 100k; could share `ProjectStateCache`'s); the file's name is
  English in every language; a coordinator's file literally named "To check again – x.csv" would
  share the local file name with a generated one; Collect Earth keeps an emptied file on disk (it
  never deletes); the queue's `waiting` comes from the figures at hand (the file from the records
  now), so they can differ until the figures catch up; the comment shown to both people is the
  coordinator's text (the field says not to name the check); no Chrome run of the three small page
  changes (lines of text).

- **Review (after c6f3902b; supersedes the above where it says so):**
  - **The desktop's two downloads (not changed: Swing).** See the corrected bullet above. This
    race is Collect Earth's for anyone whose plot file in use is not first in the list (two
    divided files already showed it); when the entry chosen *is* entry 0, both downloads write the
    same file at once. **No server-side mitigation found:** listing the generated file first would
    make the right entry 0 for someone on it, but then "…/To check again – north.csv" ends with
    "north.csv" listed after it, so the *last* match is north.csv and the wrong entry is selected
    outright; and someone on north.csv would race against the generated file instead. The order
    stays (generated files last). DEPLOY.md's known limitations now tell coordinators and
    collectors to look at the plot file field before pressing Apply; Task 22 checks it.
  - **The project state's plot context** (`ProjectStateCache`, now passed into
    `registerAssignmentRoutes` as `states`; created before it in `server.ts`) for my-assignment
    and the download, as My work and the person page already used it; `loadPlotContext` only when
    no cache is given. **Nothing is loaded when nothing can be waiting:** `sentBackTo({ waitingOnly
    })` (my-assignment, the download) first looks at the person's records of the recheck plots
    (not deleted), matched to the decisions by `recordKeysOfUnit`: a record submitted, received
    and saved after the decision is submitted again whatever its answers; only another case reads
    the outline and hashes (`mayWait`), and only a record that may still wait loads the context and
    the person's holdings. My work and the person page keep the whole list (submitted again too).
    Unit test with a counting `context`/`outline`: no decision, all submitted again, someone
    else's records only: 0 loads.
  - **`waiting` names only members now and not disabled** (`listMembers`); the others are
    `left` ("No longer in the project, not waited for: …") and never block "Everyone in the
    project it was sent back to has submitted it again." (route test: disabled, enabled again,
    removed).
  - **A generated file emptied between the list and the download** (submitted again, decision
    undone) is **409 `changed`** when the request has `?v=` (only my-assignment gives it) and the
    person is given the plot file whole or holds a plot of it; else 404 (someone who never had it;
    test with a person holding nothing in it). Limit: a person sent back a plot of a file in which
    they hold nothing (it came from the first file that has it) gets 404 there.
  - **One Content-Disposition helper** (`src/download.ts` `attachment(name, fallback)`) for the
    export (`routes/projects.ts`, its own copy removed) and every plot file: the plain name keeps
    letters, digits, `.`, `_`, `-` and makes every other character one `_` (a space too, as the
    export did; an emoji one `_`, not two); `filename*` has the real name; a lone surrogate becomes
    U+FFFD instead of making `encodeURIComponent` throw. Tested with quotes, a backslash, CR/LF,
    beyond Latin-1, emoji, `'()*` and an empty name.
  - `test/auth.test.ts`: the CEP stand-in's bytes 0x03 0x04 are written as `\x03\x04` escapes (was
    raw control bytes in the source).
  - **Tests:** server 938 (was 932: download 4; sendBack 2 — the loads, `left`; the emptied 409 and
    the 404 in the existing test), web 304 (`left` read), tsc clean in both, web build ok.
  - **Postgres smoke** (`npm run smoke:pg:progress`): **GET /my-assignment** with a plot sent back
    **680 ms on a fresh server** (the project state built: every record's state, as /progress
    cold), **then 56 ms, and 91 ms for op16**; op17 (no record of it) 47 ms; op15 after submitting
    it again (nothing waiting, no context) 27 ms; after the undo 23 ms. ALL OK; Docker stopped
    after. The state is shared with the Progress and People pages, so it is usually warm; a state
    older than 30 s whose records changed is built again before answering, as for those pages.
  - **Open (added):** the desktop race above (Swing, not changed here); records saved from the
    generated file carry `plot_file` "…/To check again – north.csv" (Task 22 checks exports, the
    KML description and the balloon with the "–").

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

**As built** (differs from the above where it says so)
- **Storage (migration 019):** `sampling_rules` (one row per project: `rule JSONB` = `{ checkers,
  firstN, percent, seed, files }` with ids and numbers only, `active`, `updated_at`, `due_since`,
  `last_auto_draw_at`, `last_draw JSONB`), RLS with the NULLIF policy of 001, deleted by
  `deleteProject`; and **`plot_assignments.sampled_at`**: a copy a draw added carries the time of
  its draw, every other holding null (`PlotAssignment.sampledAt`, absent when null). Store:
  `getSampling`, `setSamplingRule(projectId, rule, active)`, `claimSamplingDraw(projectId, { now,
  markDue, minIntervalMs })` (one `UPDATE … RETURNING`: marks a draw due and claims the automatic
  draw when the last one is ≥ 10 min old; a row is written only when something changes),
  `addSampledCopies(projectId, copies, draw, dueBefore)` (one transaction under a per-project
  advisory lock; each copy only while its file is divided, its holder a member, the plot has no
  copy in the file and the holder does not hold it; keeps `last_draw` with the counts of what was
  added; ends a due draw marked at or before `dueBefore`). Inserting holdings bumps
  `records_version` (009's trigger), so the project state, the quality figures and the served
  files follow.
- **The rule** (`src/sampling.ts`, pure): per project, and per divided file `{ use: 'off' }` or
  `{ use: 'own', checkers, firstN, percent }` (a file on the project's rule is not stored).
  `checkers` null = every collector and reviewer (never a disabled account); a chosen list may
  name coordinators. `firstN` 1-1000, `percent` 1-100 (whole numbers), null = off; both off =
  inactive (kept). The seed is made once (`randomInt`) and kept when the rule is saved again.
  **Saving draws nothing by itself and makes nothing due** ("Draw now" applies it to the plots
  already submitted; the first version made a draw due on save, and the next plot list then drew
  nothing and used up the 10 minutes before the first submission).
- **The draw** (`drawChecks`): plots = units of the divided files in scope whose first assessment
  is submitted (the project state's `byOperator.mainSubmitted`: earliest first submission; the
  rule's scope = the files on the project's rule together, each own-rule file apart; a plot in
  several files once, in the first). A plot is *covered* when it has a copy holder in any divided
  file or a check record (submitted or not). First N: each person's first N plots by first
  submission, those not covered. X %: per person and **ISO week (UTC)** of the first submission,
  `round(n × X / 100)` (a half up) must be covered, those covered (first N included) count, the
  rest is taken in the order of a 32-bit FNV-1a hash of (seed, plot): the same draw again picks
  the same plots, and a plot added later moves no other. Each pick goes to the checker with the
  **fewest open checks** (copies held, each unit once, whose check by them is not submitted, plus
  this draw's), ties by a hash of (seed, plot, user): never the assessor, anyone with any record
  of the plot (any round, drafts), anyone holding it in the file (main or copy) or as main
  elsewhere (whole files too), nor (own round) anyone with a copy of another round of the plot.
  A plot nobody can take is counted (`noChecker`) and tried again next time. Copies go in the file
  the plot was found in, as `overlap` holdings: the checker's served file (`ownFile`) gives them
  round 2 / the reassessment code as for any copy, so the checksum changes and the next
  my-assignment (Refresh, or opening the plot settings) lists it; without a round the copy holder
  tells the check apart, as before. **Load = open checks**: checks already done do not count (in
  the smoke, the 8 people holding the division's 20,000 checked copies got the same share of the
  draw as the others).
- **When** (`src/samplingService.ts`): `records:batch`, after the loop and before answering, when a
  stored upload's event was `submitted` (a first submission), calls `claimSamplingDraw(markDue)`;
  claimed, the draw runs **inline, awaited up to 5 s** (`SAMPLING_INLINE_MS`; past that the request
  answers and the draw goes on; its copies are one transaction). `my-assignment` calls the claim
  without `markDue` first, so a draw put off by the 10 minutes is made at the latest when someone
  next asks for their plot files, a checker's Refresh included. Why: Cloud Run gives a request CPU
  only until its answer (Task 1), so nothing runs after it; the batch is Collect Earth's background
  sync (30 s timeout), and a draw costs about 1 s on 100,000 plots at most once per project per 10
  min, across instances (the claim is in the database). A coordinator's page never draws by
  itself (only "Draw now"), so a project nobody opens still gets its checks. A failed draw leaves
  the draw due. One draw at a time per project per server (`running`), the advisory lock across
  servers. A draw reads the project state **fresh** (`ProjectStateCache.get(…, { fresh: true })`
  never serves a stale state and builds again when a build from older inputs was running) and the
  holdings as stored now. `config.samplingIntervalMs` (tests); the clock is the server's `now`.
- **Audit:** `sampling.drawn` (already in 012's CHECK list) `{ automatic, drawn, firstN, percent,
  noChecker, checkers }`: always for "Draw now" (actor = the coordinator), for an automatic draw only
  when it added copies (actor null). The rule's save: `settings.changed` `{ setting: 'sampling',
  active, firstN, percent }`. The activity log lists `sampling.drawn` under "Project file and plot
  files" ("ana drew plots for checks (12 plots)", "Plots drawn automatically for checks (3 plots)").
- **Re-division and moves (decided):** a new division of the file (`PUT /distribution`, any mode but
  whole) **keeps the drawn copies**: `divide(…, drawn)` adds them after what is dealt and before the
  new overlap picks, so they count towards the overlap share and their plots get no other copy;
  one whose holder is now dealt the plot as main goes (nobody checks their own plot), and a copy
  kept for a check its holder submitted stays marked drawn. **Whole again drops them** with every
  holding (whole files hold no copies). `move-unfinished` moves a drawn copy as any copy and keeps
  it drawn; a drawn copy made the receiver's main plot loses the mark. Replacing a file's content
  keeps the holdings of the plots it still has, drawn ones too.
- **Routes** (`src/routes/sampling.ts`, coordinators only; reviewers, collectors 403):
  `GET /v1/projects/:pid/sampling` → `{ rule, active, intervalMinutes, due, dueSince,
  nextAutomaticAt, lastDraw (+ by: username), pending: { drawn, firstN, percent, noChecker } (what a
  draw now would add: the draw computed, not stored), files: [{ csvFileId, filename, use, own, plots,
  submitted, sampledCopies, divisionCopies, pending }], wholeFiles, checkers: [{ userId, username,
  role, eligible, disabled, open, done, sampled }], members, noCheckers, asOf }`; `PUT` the rule
  (400 `bad_request` with a reason: unknown people, a whole or unknown file, out of range); `POST
  /sampling/draw` → `{ draw, view }`, 409 `no_rule` when nothing is on. The distribution summary's
  `PersonShare` gains `sampled` (of the copies, those drawn).
- **Web:** an "Automatic checks" section on the **Quality tab** (after the review queue), chosen
  over the plot file page because the rule is the project's and spans files, and its outcome (the
  agreement, the queue) is on that tab; the plot file page shows each person's drawn copies apart
  ("Drawn for checks: N" under the copies). `QualityChecks.tsx`: the two switches with their numbers
  (10 suggested), who may check (all / ticked people), a table of the divided files (follows the
  project's rule / no checks / its own first N and %, with submitted, drawn and division copies),
  the whole files listed ("give their plots one by one (divide them) to use checks"), no checkers
  said, the last draw (when, automatic or by whom, how many, plots nobody could take), "Draw now"
  with what it would add, the next automatic draw's time while one is due, and the checks per
  person (to do, done, of them drawn). `checksView.ts` (pure, tested): form ↔ rule, whole numbers.
  51 keys × 4 languages (`checks.*`, `divide.drawnCopies`, `activity.audit.sampled[Auto]`,
  `activity.setting.sampling`); `api.ts`, `i18n.ts`, `config.ts`, `server.ts` written with CRLF kept.
- **Blindness:** nothing in a collector's answers says a plot was drawn: `listPlotHoldings` /
  my-assignment never carry `sampledAt`, the entry of a checker's file looks like any other, My work
  folds copies into plots (Task 3); route test serializes ana's and maria's My work and fails on
  check/copy/overlap/sampl.
- **Tests:** server 960 (was 938: `test/sampling.test.ts` 14 — no rule, repeatable/seeded, % per
  person and ISO week with rounding, first N by first submission, no self-check (assessor, records,
  holders, main elsewhere), no double copies (a copy or a check record covers), load balance by open
  checks, default/chosen/disabled checkers, per-file off/own, own round's plots, the drawn copies
  paired as round 1/round 2 in `qualityReport` with the added round and without one, migration 019,
  `parseSamplingRule`; `test/sampling.routes.test.ts` 6 — roles, validation, seed kept, audit, the
  first submission draws at once, coalesced within 10 min (fake clock), the next plot list after
  them draws, the checker's file with round 2 and a new checksum, the assessor's file unchanged,
  "Draw now" repeats nothing, blindness, the figures pair the checks, re-division keeps / whole
  drops, per-file rules and nobody to check, isolation; `division.test.ts` 2 — divide keeps drawn
  copies, move and summary; existing expectations given `sampled: 0`), web 309 (was 304:
  `checksView.test.ts` 5, the activity sentences), tsc clean in both, web build ok.
- **Postgres smoke** (`npm run smoke:pg:sampling -- <port>`, `scripts/pg-smoke-sampling.mts`, README):
  019 twice; the app role (NOBYPASSRLS); a first submission's batch drew 2 copies in **69 ms**,
  audited, the checkers' files with round 2, ana's list changed; within 10 min a batch with first
  submissions **20 ms** (claim refused), due; after them a plot list drew (**43 ms**); two "Draw now"
  at once: no plot with two copies; RLS: with B set, A's rule neither read, inserted nor updated,
  `''` no rows, `addSampledCopies` under B adds nothing. **100,000 plots** (40 collectors, 20 %
  copied and checked, 30 % a week + first 10): `GET /sampling` cold (state built) **910-1015 ms**;
  **"Draw now" 2.5-2.9 s** for 23,904 copies (the draw with the fresh state and the insert ~1.5 s,
  then the view again); drawn copies per collector 597-598; no double copies, no checker with a
  record of the plot; drawing again 0 in 0.8-1.0 s; an automatic draw from a first submission
  after 10 min inside records:batch **~1.0 s** (under the 5 s bound). ALL OK; Docker stopped after.
- **Chrome** (seeded memory server, built dashboard): the section at desktop and 500 px (the
  narrowest window here; no page-wide horizontal scroll, tables scroll in their frame), "Draw now"
  (2 added, then "A draw now would add nothing"), a file's own rule refused at 150 % and saved at
  50 %, the per-file selects named "Checks: <file>", no console errors.
- **Open:** a draw that finds nothing still uses up the 10 minutes; the week is UTC, not the
  viewer's zone; "Draw now" on a large project takes seconds (the coordinator waits, the button is
  disabled meanwhile); a draw put off is made only on a later first submission or plot list (a
  checker who never refreshes gets nothing anyway); the per-file own rule takes the project's
  checkers in the web (the API takes its own list); a concurrent re-division and draw could leave
  a drawn copy the new division did not plan (valid: never its main holder's, by the PK); no Spanish
  /French/Portuguese Chrome pass (texts only); `sendBack.test.ts`'s "loads the plot context" test
  failed once under the full parallel run and passed alone and in the next full run (not touched
  here; fixed in the review below).

- **Review (after d67da3f2; supersedes the above where it says so):**
  - **The share is cumulative per person** (Decisions, item 7): `round(n × X / 100)` over all of
    the person's plots in the rule's scope, less those covered; the picks go to the week with the
    fewest checks for its plots (compared as done × plots, no division), ties by the seeded hash of
    the week's best plot, then that plot. The per-week version gave nobody under 5 plots a week a
    check at 10 %. Test: 4 plots a week × 10 weeks → 4 checks in 4 weeks, repeatable; 20 plots → 2.
    In the smoke the 100,000-plot draw now adds 24,000 copies (600 per collector).
  - **A mark during a draw is no longer lost:** `sampling_rules.last_marked_at` (019, also added
    with `ADD COLUMN IF NOT EXISTS`) is written by every mark (`claimSamplingDraw` with `markDue`
    now always writes, `GREATEST`); `addSampledCopies` ends the due draw only when
    `COALESCE(last_marked_at, due_since) <= dueBefore`, the service's clock read just before the
    draw reads its fresh state. Before, B2's mark during B1's draw left `due_since` as it was and
    B1 cleared it. Tested in the memory store (B1 claims, B2 marks, B1 ends: still due; a later
    read ends it; inputs read before the first mark: still due) and on Postgres (smoke).
  - **Failures and slowness:** the claim and the draw are waited for together, at most
    `samplingInlineMs` (config, 5 s by default); any error is logged and never reaches the
    request. Tests: `addSampledCopies` throwing → the batch answers 200 with its results and the
    draw stays due; a draw that never ends with 50 ms → the batch answers at once.
  - **Disabled checkers:** a drawn copy whose holder is disabled and has not submitted its check
    (`stale`) covers nothing (their check drafts neither) and is dropped, in the same transaction
    (`addSampledCopies(…, drop, …)`, only `sampled_at` rows), when its plot is drawn again; audited
    `replaced`. A removed member's holdings already go with `removeMember`, so the plot is drawn
    again as any uncovered one. Tests: route (the copy moves to the other checker) and smoke.
  - **Own round:** a copy or check record of a plot's reassessment-code unit ("18,R") covers its
    other units ("18,1"): `isCheckUnit` (= not `isPlotUnit`) and `plotOf` in the input. Test.
  - **"Draw now" never joins an automatic draw:** it waits for the one running on this server and
    then makes its own, always audited with the coordinator as actor; an automatic draw still
    joins whatever runs. Test with a held automatic draw (two `addSampledCopies` calls, two audit
    entries).
  - **`last_draw` is the last draw that added copies;** `last_checked_at` (019) is when any draw
    last looked. The page says "Last looked for plots to check: … ; none was due then." when that
    is newer than the last draw. `SamplingState.lastCheckedAt`, `GET /sampling` `lastCheckedAt`.
  - **`setDivision` (so `move-unfinished` and `PUT /distribution`) takes the sampling advisory lock**
    first (Postgres): a draw's copies land before or after a division, never in between (unit test
    on the statements).
  - **Web:** the form refills only when the saved rule changes by value (JSON), so "Draw now" or a
    reload keeps what is being typed (Chrome: typed 7, pressed Draw now, still 7); the checkers'
    radio group has `aria-labelledby`; a refused save moves the focus to the field (each number
    field has an id; Chrome checked); the share's texts in 4 languages say it counts all of a
    person's plots and spreads the checks over the weeks; one key more (`checks.lastChecked`).
  - **`sendBack.test.ts`:** the flaky case compared plots in the order of `decidedAt` (newest
    first): two decisions in different milliseconds swapped them. It now compares them sorted.
  - **Tests:** server 969 (was 960: sampling 3 more, routes 5 more, Postgres store 1), run twice in
    full, both green; web 309; tsc clean in both; web build ok.
  - **Postgres smoke** (`npm run smoke:pg:sampling`, extended: the B1/B2 interleaving on the SQL
    path, a disabled checker's copies replaced and audited): ALL OK. A first submission's batch
    that drew 57 ms; a refused claim 25 ms; a plot list that drew 88 ms; 100,000 plots: `GET
    /sampling` cold 1,078 ms, "Draw now" 2,948 ms (24,000 copies, the view after included),
    again 1,044 ms, an automatic draw inside records:batch 1,209 ms. Docker stopped after.
  - **Open (still):** the week used for spreading is UTC; "Draw now" on a large project takes ~3 s;
    an automatic draw that finds nothing uses up the 10 minutes (it is now shown as "last looked").

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

**As built** (differs from the above where it says so)
- **Storage (migration 020):** `reference_plots` (`project_id, csv_file_id, plot_key, assessor_user_id,
  added_at, added_by`, PK per file and plot; RLS with the NULLIF policy of 001; the 009 version
  triggers, so marking bumps `records_version` and the figures, the project state and the served
  files follow; `deleteProject`, whole again and a replaced file that lost the plot delete rows;
  the assessor's account deleted cascades). **No new column on `plot_assignments`:** a copy of a
  plot listed there *is* a reference copy (told apart from the division's copies and the drawn
  ones, `sampled_at`, by the table). Store: `listReferencePlots` (with the assessor's username, also
  once they left the project; divided files only) and `changeReferencePlots(projectId, { unmark,
  dropCopies, mark, addCopies, at, by })`, one transaction under the check sampling's advisory lock
  (no draw nor division in between): marking makes the assessor the plot's main holder in the file
  and every other holding of it there a copy (no longer drawn); copies are added only for a
  reference plot of a divided file, to a member other than its assessor who does not hold it.
- **Who assesses (decided):** the coordinator picks a **reference assessor** among the project's
  coordinators and reviewers (not disabled), themselves by default; refused for a collector (400
  `bad_assessor`). **Who gets copies:** every collector (role operator, not disabled), never the
  assessor; reviewers do not (they review, and may be assessors).
- **Which plots can be marked** (`checkMark`, 400 with a `code` and up to 20 plots): plots of a
  divided file (`whole_file`), in the file (`unknown_plots`), not an own round's re-assessment unit
  (`not_a_plot`), in no other plot file (`in_other_file`: records are paired by unit across files),
  with no first assessment (submitted or a draft) by anyone but the assessor
  (`assessed_by_others`: the reference must be the only first assessment); at most
  `MAX_REFERENCE_PLOTS` 500 per project (`too_many`; 500 × the collectors are copies). A collector's
  existing check of the plot (a division or drawn copy) stays and is measured. **At random:**
  `random: N` picks N plots nobody has any record of, in a seeded order (`pickReference`; `none_free`
  when none). The copies go out at once (blind anyway); only plots whose reference assessment is
  submitted are measured, the page says how many.
- **Keeping the copies right** (`referenceCopyPlan`, pure): every mark and removal also adds the
  copies missing and drops those of someone who would not get one now (no longer a collector,
  disabled) **unless they have a record of the plot** (without its copy, a record without a round
  would be taken for a second first assessment). **A collector who joins later** (or becomes one)
  gets theirs in `my-assignment` before the list is built (adds only, their own; one
  `listReferencePlots` per plot list, nothing written when nothing is missing), so on their next
  Refresh. A removed member's holdings already go with `removeMember`.
- **Removing** (`POST /reference/remove`, plots or all): the plot is no longer a reference plot; the
  copies whose holder has no record of it go, checks made stay (and then count as ordinary checks
  in the agreement figures: the dialog says so); the assessor keeps the plot. A previous main
  holder is not given it back.
- **Divisions:** a new division (`PUT /distribution`) does not deal the reference plots again: they
  keep their assessor and copies (left out of `divide`, added back); `move-unfinished` never moves
  them; whole again unmarks them with every holding.
- **The figures** (`src/reference.ts` `referenceFigures`, in the quality worker's job, cached with
  the report: `QualityFigures.reference`, `ServedReport.reference`): `QualityInput.reference` (unit →
  assessor username, from `loadPlotContext` → `PlotContext.reference`). For each reference plot the
  assessor's latest submitted first assessment is the reference; each other person's latest
  submitted check is compared question by question by `compareAnswers` (new in `quality.ts`: the
  pair rule of `qualityReport`: same questions, margins, blanks on both sides not compared). Per
  person: plots where every compared answer matches (`plots: Rate`) and per question (`label`
  included); per question for everyone; `byPlot` (assessed, checks). Rates under `MIN_PLOTS` 20 are
  null ("Too few plots to judge"). Only records whose key can be a reference plot's are resolved
  (`recordKeysOfUnit`), so the cost is the reference records only.
- **Left out of (not counted twice):** `qualityReport` skips reference groups when pairing
  (agreement by question/person/week, confusions, differences, `pairs` → the review queue's
  differences, the bulk decisions, the map's "disagreement", plot search's differences, survey
  health's agreement and "changed by decisions" via `onCheckedPlot`, the AI's figures); two
  first assessments are still a data problem. The check sampling never draws a reference plot (its
  units leave the draw's files and each person's share) and reference copies are no open checks
  (load); the Checks section counts them apart ("Reference plots: N copies"). **Kept (decided):**
  the reference assessments stay in the answers per person, the pattern flags and survey health's
  empty/other shares: they are first assessments of the project's data (exported, the most
  trusted), and leaving them out would make the answers per person describe less than the data;
  the collectors' reference checks are checks and were never in those. People/Progress count
  reference copies as checks to do (they are work).
- **Routes** (`src/routes/reference.ts`): `GET /v1/projects/:pid/reference` (coordinators and
  **reviewers**; collectors 403; figures worked out when needed, 503 busy as the other sections):
  `{ coordinator, count, figures: { plots, assessed, checks, questions, people, computedAt, stale } }`;
  coordinators also `{ max, plots: [{ csvFileId, filename, plot, assessor, assessorInProject, addedAt,
  assessed, copies, checked }], files, wholeFiles, assessors, collectors, people: [{ username, copies,
  checked }] }` and `figures.byPlot`. **Reviewers get the accuracy, never which plots are reference
  plots** (no list, no `byPlot`) and cannot change the set. `POST /reference/plots` `{ csvFileId,
  assessorUserId, plots | random }` and `POST /reference/remove` `{ plots: [{csvFileId, plot}] | all }`
  (coordinators): `{ result: { unmarked, marked, copiesAdded, copiesDropped }, …view }`, audited
  **`reference.changed`** (already in 012/015's CHECK list: verified) `{ csvFileId, added, removed,
  assessorUserId, random, copiesAdded, copiesDropped }`; the activity log lists it under "Project file
  and plot files" ("ana marked plots of north.csv as reference plots (20 plots)").
- **Plot page:** `reference: { assessor } | {} | null` (the assessor for coordinators only); the
  page says it is a reference plot measured on the Quality tab, not listed as differences.
- **Person page (coordinators):** `quality.reference` (their accuracy, weakest questions), from the
  figures at hand (peek). **Never on My work nor the personal report, and nothing tells a
  collector which plots are reference plots:** their file entry and rows are those of any copy
  (round 2), My work folds copies into plots (route test and smoke search My work and the plot
  lists for "referen"/"accura"). **Later option, not built:** a collector's own accuracy against
  the reference on My work (useful feedback, but it says reference plots exist and, plot by plot,
  could reveal them; the owner decides).
- **`my-assignment` and copies:** `copiesServedAsMain` read *every* record summary of the project
  for any copy holder (with a round column) on each plot list; with reference plots every collector
  holds copies, so it now reads only the records the copies' plots can have (`listRecordsByKeys`
  of `recordKeysOfUnit`). Smoke: the old read was 442-492 ms on 120,050 small records; op10's whole
  plot list (5,050 holdings) is now 160 ms, 61 ms again.
- **Web:** `project/QualityReference.tsx`, "Reference plots" on the coordinator's Quality tab (after
  Automatic checks) and the reviewer's (last, read-only, the reviewer note says so): explanation and
  the blindness note, the count and figures' time (stale/busy asked again as the other sections),
  "Accuracy against the reference" (people lowest first, too few last, "Differs most on" the 3
  weakest questions; by question for everyone), the reference plots (link to the plot page,
  assessor, reference submitted or not, "submitted by collectors N of M", Remove / Remove all with
  a confirmation dialog), each collector's progress (a `<details>`), and "Add reference plots" (a
  divided file, the assessor, at random N or ids one per line; refusals as sentences naming the
  plots, the field focused). `referenceView.ts` (pure, tested), api types and calls, the person
  page line, the plot page note, the Checks section's reference copies, the activity sentences. 67
  keys × 4 languages and the reviewer note (`i18n.ts`, `api.ts`, `ProjectPage.tsx`, `server.ts`
  written with CRLF kept).
- **Tests:** server 994 (was 969: `test/reference.test.ts` 19 — accuracy per person/question with
  margins and the 20-plot rule, only submitted references, drafts/deleted, one check per person,
  never against someone else's first assessment, checks by copy without a round, left out of
  `qualityReport` and survey health while the answers keep them, the copy plan (collectors only,
  drops without a record, one person only), `checkMark` codes, `pickReference`, `parsePlotList`,
  migration 020; `test/reference.routes.test.ts` 6 — roles and blindness (round 2 file, My work,
  reviewer without plots), refusals and at random, accuracy and exclusion from /quality, the queue,
  the plot page and person page, a newcomer's copies and a demoted collector's, removal, re-division,
  move and whole again, the sampling never drawing them; isolation list), web 314 (was 309:
  `referenceView.test.ts` 5, activity sentences), tsc clean in both, web build ok.
- **Postgres smoke** (`npm run smoke:pg:reference -- <port>`, `scripts/pg-smoke-reference.mts`,
  README): 020 twice with RLS, policy and triggers; the app role (NOBYPASSRLS); marking 2 plots
  69 ms, holdings as expected, version bumped, audited; ana's file with round 2; the accuracy
  through the worker; /quality without them; a reviewer without the plots; a newcomer's first plot
  list adding the copies 42 ms; removing keeps a check made; RLS (with B set A's rows neither read,
  inserted, changed nor deleted; `''` no rows; the store under B changes nothing); whole again and
  deleteProject empty the table. **100,000 plots, 40 collectors:** 50 random reference plots
  marked in **1.5 s** (fresh state, 1,900 copies added, 100 converted), 2,000 checks measured by the
  worker: `GET /reference` cold **2.4 s** (the whole worker job), warm **17 ms**; /quality 19,000
  checked plots (the 2,000 reference checks out); a plot list adding 50 copies **64 ms**; "Draw now"
  2.6 s drawing none of them; remove all 0.8 s. ALL OK; Docker stopped after.
- **Chrome** (seeded memory server, built dashboard): the coordinator's section (accuracy 64 % /
  95 % / too few, 22 of 25 measured), ids already assessed refused with their names, two plots
  added, one removed through the dialog; the plot page's note; jose's person page line; the
  reviewer at the narrowest window (500 px): figures only, no page-wide horizontal scroll (tables
  scroll in their frame). No console errors besides the intended 400s.
- **Open:** a record arriving between the check and the mark (someone's first assessment of a plot
  just marked) is not refused (two first assessments, shown as a data problem); a demoted or
  disabled collector's untouched copies are dropped only at the next mark/removal; the reference
  plot of a removed assessor stays (the page says they left) and is measured against their
  records; removing does not give the plot back to its previous holder; per-person "mix-ups"
  (which answer instead of the reference's) not built; the week/day of the checks is not shown;
  no Spanish/French/Portuguese Chrome pass (texts only).

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
  - reopen the plot settings while on the "To check again" file; confirm which file the plot
    file field shows (Task 12's review: two downloads race in `populateAssignments`);
  - records saved from the generated file carry `plot_file` "…/To check again – …": check the
    exports, and the KML description and the balloon with the "–";
  - a sampled check arrives blind;
  - the note shows (Task 16);
  - the backup imports with 0 conflicts (Task 17);
  - the version reaches the dashboard.
- **A final code review** of the whole range, then DEPLOY.md and this plan's "As
  built" notes.

## Order

Tasks 1 → 21 → 2 → 3, then Part B (4–7), then Part C (8–11), then Part D (12–16),
then Part E (17–20), then 22. Task 21 goes early, because Task 2 uses its rule.
