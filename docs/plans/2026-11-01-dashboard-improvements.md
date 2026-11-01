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

**As built** (a05cd9dc; differs from the above)
- **`change`** (`recordChange`, `src/lww.ts`): a first upload already actively saved is
  `submitted`, not `created` (Collect Earth mostly syncs after Save, and Task 2 counts
  `submitted`); a record coming back after a tombstone is `created`/`submitted` again; a
  submitted plot saved again is `updated` (so re-saves do not count as new submissions;
  Task 12 can find them as `updated` with `activelySaved`). **The same save sent again**
  (same `modifiedOn`, `deleted` and actively saved: a retried batch) logs nothing.
- **The backfill** gives each record the change a first upload would have had
  (`submitted` with its summary, `created`, or `deleted`), not always `created`. It runs
  only while `record_events` is empty (migrations run on every boot): records written by
  an older instance during a rolling deploy, after it ran, get no event.
- **The event is written after the record, in its own transaction**; a failed event write
  is logged and the record still answered `stored`.
- **`member_activity`** also references `project_members` (ON DELETE CASCADE), and the
  upsert writes only for a member, so a coalesced write after a removal adds nothing.
  `last_seen_at` is any answered request of a member with a session (an `onResponse`
  hook), not only the four routes; `client_agent` is taken only from those four
  (`records:batch`, `my-assignment`, a plot file's content, `GET /cep`), so the dashboard's
  browser does not replace Collect Earth's. A coordinator downloading a plot file or the
  CEP from the dashboard still sets it. `records_received` counts the records stored.
  The coalescer (`ActivityRecorder`, `app.activity`) writes a member's first call at once
  and the rest a minute after that write; `flush()` for tests, written on close.
- **Audit actions:** added `assignments.set` (the whole-file assignment grid), not in the
  list. `settings.changed` has `{ setting: 'quality' | 'round' | 'ai' | 'name' }`.
  Guidance notes are not audited. The `CHECK` lists every action of the plan (later tasks'
  too), named `audit_log_action_check` to widen later. `at` is the server's clock, as
  `received_at`.
- **Store:** `listRecordEvents(projectId, { from, to, operator?, limit, before? })`,
  `listAudit(projectId, { limit, before?, actor?, action? })`, newest first; `before` is a
  cursor `{ at, id }` (ids are BIGSERIAL, as strings), so rows at the same time are
  neither lost nor repeated between pages. `listAudit` gives the actor's username too.
  `appendAudit(projectId, { actorUserId, action, details })`.
- **No grants in 012:** `prepareAppRole` grants every table and sequence on each boot.
- **Postgres** (throwaway `postgres:16`, the server as a NOSUPERUSER NOBYPASSRLS app role;
  the repository has no smoke script, so it is a scratch script like the earlier tasks'):
  the backfill on a 001-011 database with records, once; the grants; every route; events,
  activity and audit read back with paging and filters; `removeMember`, `deleteUser` and
  `deleteProject`; with A set, B's rows not read, changed or deleted and B rows refused;
  with `''`, no rows and no error. 52 checks, all ok. The whole suite on that store (as
  the app role) fails only the tests that reach into the memory store or set up twice.

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
