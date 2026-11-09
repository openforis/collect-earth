# Collect Earth Cloud

Cloud sync + coordination backend for [Collect Earth](../collect-earth). This is
**Phase 0**: the minimal viable record-sync service the Java desktop client talks
to. The management platform (projects dashboard, assignments, review) layers on
top later — see [`../docs/plans/2026-07-06-collect-earth-cloud-platform-plan.md`](../docs/plans/2026-07-06-collect-earth-cloud-platform-plan.md).

> This directory is self-contained (its own `package.json`) and is intended to be
> split into its own repository / release train once it stabilises. It pins an API
> version contract (`/v1`) that the Java client depends on.

## Stack

- **Fastify** (TypeScript, run directly via `tsx` — no build step)
- **PostgreSQL** for projects/records (Cloud SQL in production)
- Deploys as a single **Cloud Run** container; scales horizontally, one shared
  multi-tenant instance hosted by FAO/OpenForis.

An **in-memory store** (`STORE_BACKEND=memory`) is provided for development and
the test suite, so the API and its tenancy rules can be exercised without a
database.

## Quick start (no database)

```bash
npm install
npm test          # isolation + sync behaviour, against the in-memory store
npm run dev       # STORE_BACKEND defaults to "memory"
```

## Local mode (the dashboard inside Collect Earth)

`LOCAL_MODE=1` runs the server for one person on their own computer: Collect Earth starts it and
feeds it (docs/plans/2026-11-03-desktop-dashboard.md, `src/local.ts`). It listens on 127.0.0.1
only (any other `HOST` is refused), keeps everything in memory, and makes at start one account
(`LOCAL_USER`, the person's name; the username is made from it) and one project (`LOCAL_PROJECT_ID`,
a uuid the desktop keeps; `LOCAL_PROJECT_NAME`) with the account as its coordinator. The routes
about other people or the server (sign-up, invitations, roles, division, assignments, checks,
reference plots, the review queue, progress links, mail, the AI, `/v1/admin/*`) answer 404
(`LOCAL_OFF_ROUTES`); `/v1/server-info` says `localMode: true`. The database, mail and AI
settings are not read in this mode.

Once listening it prints one JSON line on stdout (its log goes to stderr):
`{"ready":true,"port":…,"projectId":…,"username":…,"signInUrl":…,"apiToken":…}`. `PORT=0`
(the default here) picks a free port. `apiToken` is the account's session: Collect Earth sends
records:batch, the CEP and the plot files with it (`Authorization: Bearer`). `signInUrl`
(`/local-sign-in/<token>`) opens the dashboard in the browser, signed in, once, within 15 minutes;
`POST /v1/local/sign-in-links` (with `apiToken`) gives a new one.

```bash
npm run build:local                         # dist/server.mjs + dist/qualityWorker.mjs (esbuild)
LOCAL_MODE=1 LOCAL_USER="Ana María" WEB_DIR=web/dist node dist/server.mjs
```

The bundle needs no node_modules: the Postgres store, the migrations, the AI client and SMTP
mail are replaced by the stand-ins of `src/localBuild/`, so it runs the memory store only.
`WEB_DIR` says where the built dashboard is (default: `web/dist` beside the package).

`LOCAL_EXIT_WITH_STDIN=1` makes the server end when its stdin ends. Collect Earth sets it and keeps the
stdin open as a pipe, so the dashboard ends with Collect Earth, even when Collect Earth is killed.

## Deployment

To run your own server on Google Cloud without technical knowledge, follow
[`SELF-HOSTING.md`](SELF-HOSTING.md): one button and one script.

For production (Cloud Run + Cloud SQL, or any Docker host + managed Postgres),
required env vars, and how to onboard projects, see [`DEPLOY.md`](DEPLOY.md).

**Emails** are optional (`SMTP_URL`, DEPLOY.md "Weekly emails (optional)", which covers every mail). With mail set up the
server sends: the link that confirms an account's address; the weekly emails people turn on
(with one-click unsubscribe); the password reset link of "Forgot your password?" (1 hour,
single use); and two security notices, only to a confirmed address: "your password was
changed" (account page or any reset link) and, to the **old** address, "the email address
of your account was changed/removed" (the new one shown only in part). Without
`SMTP_URL` none is sent, and "Forgot your password?" says to ask the server's administrator.

## With PostgreSQL

```bash
docker compose up -d
cp .env.example .env            # sets DATABASE_URL for the compose Postgres
STORE_BACKEND=postgres DATABASE_URL=postgres://ce:ce@localhost:5432/collect_earth_cloud npm run migrate
STORE_BACKEND=postgres DATABASE_URL=postgres://ce:ce@localhost:5432/collect_earth_cloud npm run dev
```

Smoke tests on a throwaway PostgreSQL (the activity data of migration 012, then one
per later feature): each creates and drops its own database and roles, so never point
one at a real server. They take the container's port as their argument, so one
container serves them all, run one after the other (each script's own default port,
used when none is given, differs: 55481 to 55486).

```bash
docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
npm run smoke:pg -- 55481      # the port; prints one line per check, then ALL OK
npm run smoke:pg:progress -- 55481   # the Progress and People tabs (migration 013), with GET /progress, /people and /people/:userId on 100,000 records and 20,000 checks, then the Quality tab's answers per person and pattern flags on them
npm run smoke:pg:activity -- 55481   # the Activity tab (migration 017): the bell's read state with RLS, the log on 100,000 record events paged by cursor (timings), the weekly summary and the daily activity download
npm run smoke:pg:panel -- 55481      # the server owner's panel (migration 018): GET /v1/admin/overview on 100,000 records in 5 projects (totals against SQL, no names, timings), RLS still binding the app role, disabling and enabling an account, two admins disabling each other at once
npm run smoke:pg:sampling -- 55481   # the automatic checks (migration 019): a first submission draws, the 10 minutes' coalescing, the checker's round-2 file, two draws at once, RLS of sampling_rules, a draw on 100,000 plots timed
npm run smoke:pg:reference -- 55481  # reference plots (migration 020): marking, every collector's copy, the worker's accuracy, removing, a newcomer's copies, RLS of reference_plots, 50 reference plots × 40 collectors on 100,000 plots timed
npm run smoke:pg:backup -- 55481     # the Collect Earth backup: getRecordXml and the records without XML under RLS (another project invisible), the summary, a link used once, then 100,000 records of 17 KB streamed and timed
npm run smoke:pg:links -- 55481      # progress links (migration 021): RLS of share_links, share_link_lookup (SECURITY DEFINER) giving only ids, the token kept hashed, the public page without names, revoked and unknown alike, the lookup and the page on 100,000 records timed
npm run smoke:pg:mail -- 55481       # weekly emails (migration 023): the account tables global as users, the address confirmed by its link, two instances at once sending each mail once, a failed mail put back, one-click unsubscribe, a run timed over 40 subscribers of 100,000 records and 10,000 unconfirmed
npm run smoke:pg:final -- 55481      # the final review's fixes (migration 024): migrations skipped when unchanged, an edited one run again, 015 widening an older constraint, lock_timeout on a busy table, listRecordsByKeys by operator under RLS, removeMember and putCsvFile waiting for the sampling lock, a draw's timeouts
docker stop ce-pg-smoke
```

## API (v1)

All project-scoped routes require `Authorization: Bearer <token>`.

Two token kinds are accepted interchangeably on project-scoped routes: **Phase-0
project tokens** (`adminToken`/`projectToken` from provisioning) and **Phase-A user
session tokens** (from login, access via `project_members`).

**Sync & provisioning (Phase 0)**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/projects` | `x-admin-key`, session, or none (dev) | With `x-admin-key` = `ADMIN_API_KEY`: provision → `{projectId, adminToken, projectToken}`. With a session: see the dashboard table. With neither: only when `ADMIN_API_KEY` is unset **and** `STORE_BACKEND=memory`, else 401 |
| `GET`  | `/v1/projects/:pid` | member | Ping / metadata (desktop "Test connection") |
| `PUT`  | `/v1/projects/:pid/survey` | admin | Upload survey IDML `{surveyUri, surveyName?, idmlBase64}` |
| `POST` | `/v1/projects/:pid/records:batch` | member | Upload record/tombstone envelopes (gzip body) → per-record `stored\|stale\|conflict\|error` |
| `GET`  | `/health` | none | Liveness |

**Accounts, invites & coordination (Phase A)**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/auth/register` | invite token in body | Create account + membership, auto-login |
| `POST` | `/v1/auth/login` | none | `{username,password}` → session token |
| `POST` | `/v1/auth/logout` | session | Revoke the session |
| `GET`  | `/v1/me` | session | Profile + memberships |
| `GET`  | `/v1/projects` | session | The caller's projects (only) |
| `POST` | `/v1/projects/:pid/invites` | admin | Mint a join invite `{role?, maxUses?, expiresInDays?, forUserId?}` → `{inviteToken, joinPath, joinUrl, role, maxUses, expiresAt}` (`joinUrl` always absolute, see below). With `forUserId` (a member): a link for that person to get the new project file (Collect Earth: Join cloud project, then Log in: not used up, role unchanged), always a collector link, 1 use, 7 days; audited with `forUserId` |
| `GET`  | `/v1/join/:token` | none | Invite preview `{projectId, projectName, role, valid}` (`valid:false` when expired, used up or revoked) |
| `PUT`  | `/v1/projects/:pid/cep` | admin | Upload the CEP zip (raw `application/zip` body) → `{ok, bytes, round}` (`round`: what the server did about round, see `GET /round`). With no records yet, an id-only survey gets a hidden `round` key added and the upload is kept as the original. 413 `storage_limit_reached` over the project's space limit, 413 `too_large` for a zip that unzips too big; 409 `round_removed` / `round_codes_changed` / `key_shape_changed` when records exist and the new file would change the key shape they were collected with, 409 `plots_divided` when it would change how divided plot files are read |
| `GET`  | `/v1/projects/:pid/cep` | member | Download the CEP zip (join bootstrap): the served version, with `round` when the server added it |
| `GET`  | `/v1/projects/:pid/cep/original` | admin | The CEP as uploaded (404 when the served file is the upload) |
| `GET`  | `/v1/projects/:pid/round` | admin | `{state: 'added' \| 'own' \| 'none', refusal, keyCount, roundIndex, roundCodes, reassessmentCode}`, or `null` before any upload |
| `PUT`  | `/v1/projects/:pid/round` | admin | `{reassessmentCode: code \| null}`: which code of a survey's own round marks a re-assessment (400 unless `state` is `own` and the code is one of its codes) |
| `GET`  | `/v1/projects/:pid/members` | admin | List members |
| `PUT`  | `/v1/projects/:pid/members/:uid` | admin | Change role (last-admin demotion refused) |
| `DELETE` | `/v1/projects/:pid/members/:uid` | admin | Remove member (last-admin removal refused) |

**Web dashboard & server administration**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/v1/server-info` | none | `{needsSetup, signupOpen, projectCreation, version, termsUrl, contactEmail, serverName, aiAvailable, selfServiceReset}` (`termsUrl`, `contactEmail`, `serverName` `null` when not set; `aiAvailable`: the AI assistant is configured and allowed on this server; `selfServiceReset`: the server sends email, so "Forgot your password?" mails a reset link) |
| `POST` | `/v1/setup` | setup code in body | `{setupCode, username, password}` → 201 `{token, userId, username}` (the platform admin, logged in); 403 `bad_setup_code`; 409 `already_set_up` / `username_taken`; 400 `bad_username` / `weak_password` |
| `POST` | `/v1/auth/signup` | none | `{username, password, email?, acceptTerms?}` → 201 `{token, userId, username}`; 403 `signup_closed`; 409 `username_taken`; 400 `bad_username` / `weak_password` / `terms_not_accepted` (when `termsUrl` is set and `acceptTerms` is not `true`; the acceptance time is stored as `users.terms_accepted_at`) |
| `POST` | `/v1/auth/forgot` | none | `{login, language?}` (a username or an email address) → always 202 `{accepted: true}`, answered before anything is looked up. When mail delivers and the account (or each enabled account whose **confirmed** address it is, at most 5) has a confirmed address and is not disabled, a reset link (`/reset/<token>`, single use, **1 hour**) is mailed to it in `language` (else the account's mail language). Quiet limits: 3 mails an hour per account, 10 requests an hour per client IP, 100 mails an hour per instance; plus the shared per-minute limit (429). 400 `bad_request` (no login, or over 254 characters); 409 `not_available` where the server sends no email |
| `POST` | `/v1/auth/reset` | reset token in body | `{token, newPassword, language?}` → 204, revokes all the user's sessions and mails the "password changed" notice to the confirmed address; 410 `invalid_reset_token` (unknown, used or expired); 400 `weak_password` |
| `PUT`  | `/v1/me/password` | session | `{currentPassword, newPassword, language?}` → 204: every **other** session of the account ends (Collect Earth's too: it signs in again), the one making the change stays, and the "password changed" notice goes to the confirmed address; 401 `invalid_credentials`; 400 `weak_password` |
| `GET`  | `/v1/me/deletion` | session | What deleting the account would do: `{soleCoordinator: [{projectId, name}], deletedWithAccount: [{projectId, name}], lastPlatformAdmin}` |
| `DELETE` | `/v1/me` | session | `{password}` → 204: deletes the account (sessions, memberships, assignments, reset links) and the projects where it is the only member and coordinator. Records it uploaded stay in their projects. 401 `invalid_credentials`; 409 `last_platform_admin`; 409 `sole_coordinator` `{projects: [{projectId, name}]}` (only coordinator of a project others are in: hand it over or delete it first) |
| `POST` | `/v1/projects` | session | Allowed when `projectCreation` is `anyone` or the caller is a platform admin (else 403 `project_creation_restricted`); the caller becomes its admin → 201 `{projectId, name}`. 403 `project_limit_reached` `{limit}` when the caller already coordinates `maxProjectsPerUser` projects (platform admins exempt) |
| `PATCH` | `/v1/projects/:pid` | admin | `{name}` → `{projectId, name}` |
| `PUT` | `/v1/projects/:pid/status` | admin | `{status}` → `{projectId, status}`: the project's lifecycle (migration 029). `draft` → `active` → `closed`, `closed` → `active` (reopen) or `archived`, `archived` → `closed` (restore); any other move 409 `bad_transition`. Logged as `settings.changed` `{setting: 'status', from, status}`. Projects are `active` unless made as a copy (a `draft`). A draft refuses `records:batch` with 409 `project_draft`; a closed or archived project refuses every change (any method but GET/HEAD, except this route, the deletion and the reading or personal POSTs) with 409 `project_closed` `{error, reason}`: Collect Earth shows the reason and keeps the records to send later. `GET /v1/projects`, `/v1/me` memberships and `GET /v1/projects/:pid` carry `status`; the dashboard hides archived projects unless asked |
| `POST` | `/v1/projects/:pid/copy` | admin, session | `{name, members?}` → 201 `{projectId, name, status: 'draft'}`: a new project from this one (a template, `src/projectCopy.ts`), the caller its coordinator: the survey, the CEP (served and as uploaded, with its round info), the plot files, the progress and quality settings; with `members: true` also the members (same roles), whole-file assignments and divisions (the dealt plots, not the copies drawn by the checks or of reference plots). Never records, decisions, notes, flags, reference plots or training sets; the AI switch stays off. The rules of `POST /v1/projects` apply (403 `project_creation_restricted` / `project_limit_reached`); 403 `user_session_required` with a project token. Logged in the copy as `settings.changed` `{setting: 'copy', from}`. Works from a closed or archived project |
| `DELETE` | `/v1/projects/:pid` | admin | `{confirmName}` (must equal the project name, else 400 `confirm_mismatch`) → 204: deletes the project and all its data — records, CEP, plot CSVs, assignments, invites, memberships, Phase-0 tokens — in one transaction. Cannot be undone |
| `GET`  | `/v1/projects/:pid/overview` | admin | `{name, cep: {bytes, updatedAt} \| null, members, csvFiles, plots, records: {total, submitted, byOperator: [{operator, total, submitted, lastModifiedOn}]}, storage: {usedBytes, limitBytes \| null}}` — deleted records excluded from the counts, times in epoch ms; `storage` = CEP + CSV bytes + stored record xml/summary bytes |
| `GET`  | `/v1/projects/:pid/progress?days=90&tz=Europe/Rome` | admin, reviewer | The Progress tab: `{timeZone, today, totals: {plots, assigned, notAssigned, submitted, started, notStarted}, daily: [{date, submitted, cumulative}], forecast, attention: [...] \| null, settings}` — totals per plot unit (first assessments only), `daily.submitted` = the plots submitted now whose first assessment was first submitted that day in `tz` (checked against the IANA list, else UTC; `timeZone` says which was used), so the bars and the cumulative line add up to `totals.submitted`, `days` 14-366; `attention` (the cards that name people) is null for a reviewer |
| `GET`/`PUT` | `/v1/projects/:pid/progress/settings` | admin | `{deadline: "YYYY-MM-DD" \| null, targetPlots: 1-10000000 \| null, quietDays: 1-365}` (defaults null, null, 3); a change is audited as `settings.changed` |
| `GET`  | `/v1/projects/:pid/people?tz=` | admin | The People tab: `{timeZone, today, quietDays, quality: {available, computedAt, stale}, people: [{userId, username, role, plots: {assigned, submitted, started, remaining, done}, checks: {assigned, submitted, remaining}, submittedLast7, medianPerDay, lastSyncAt, lastPlotsDownloadAt, lastSubmittedAt, agreement, status: {kind, days?, level?}}], invites, week: {days, mostActive, leastActive}}`; plots counted as `/progress` counts them (checks apart); `agreement` from the quality figures at hand only (null when none: never computed here); reviewers and collectors 403 |
| `GET`  | `/v1/projects/:pid/people/:userId?tz=` | admin | One person's page: `{person, calendar: [{date, plots, checks}], hours[24], files: [{csvFileId, filename, divided, plots, checks, list (≤1000), truncated}], speed: {submissions, sessions, gaps, medianGapMs, veryFast, buckets}, sync: {lastSyncAt, lastPlotsDownloadAt, lastCepDownloadAt, oldProjectFile, collectEarth, …}, quality: {available, asFirst, asChecker, sentBack}}`; 404 for someone not in the project |
| `GET`  | `/v1/projects/:pid/my-work?tz=` | any member with a session | The same page about the person asking ("My work"): nothing tells which plots are quality checks (copies are counted, listed and drawn as plots; no `checks`, no `kind`, no `asChecker`), agreement only over plots certainly theirs, no names of who decided, no `removal`; answered again from the last answer within 5 s |
| `GET`  | `/v1/projects/:pid/invites` | admin | Open invites (not revoked, expired or used up) `{invites: [{id, role, maxUses, usedCount, expiresAt, createdAt}]}` — the token is only shown at creation |
| `DELETE` | `/v1/projects/:pid/invites/:id` | admin | Revoke → 204 (404 if not an open invite of this project) |
| `GET`  | `/v1/projects/:pid/export.csv` | admin | One row per non-deleted `(recordKey, operator)`: `record_key, plot, round, assessment, final, operator, actively_saved, modified_on` (ISO 8601; `assessment` is `main`, `check` or `other`; without `round` in the key, round is 1 or 2 from who holds the plot as a quality-check copy; `final` is `yes`/`no` for the answer a coordinator's decision accepted, `recheck`, or empty) + the sorted union of summary keys; RFC 4180, UTF-8 BOM, `content-disposition: attachment` |
| `GET`  | `/v1/projects/:pid/export.geojson`, `export.kml`, `export.shp.zip` | admin | The same rows and columns as map files: each record's plot as the survey's plot shape (square or circle, `plotShape.ts`) as a polygon, a point when the shape is unknown, no geometry when the plot has no place (or the survey is not in latitude/longitude). The shapefile zip: `plots.shp/.shx/.dbf/.prj` (WGS84), `plots.cpg` (UTF-8) and `fields.csv` (DBF field name → column; names cut to 10 characters, made unique; columns past 255 have no field). Audited `export.downloaded {records, format}` |
| `GET` / `PUT` | `/v1/admin/settings` | platform admin | `{signupOpen, projectCreation: "anyone" \| "platform-admins", maxProjectsPerUser, maxProjectStorageMb, termsUrl, contactEmail, serverName, aiEnabled, aiReportsPerDay, aiFollowUpsPerDay, aiMonthlyTokens, aiConfigured}` (`aiConfigured` read-only: the server has its AI settings; never the key; the AI limits are per project, 0 = none allowed) — limits are whole numbers, 0 = no limit; `termsUrl` http(s) only; text fields `null`/`""` clear them. PUT takes any subset, 400 `bad_request` on a bad value, returns the result |
| `GET`  | `/v1/admin/users` | platform admin | `{users: [{userId, username, isPlatformAdmin, projects, coordinatedProjects}]}` — project **counts** (any role / as coordinator), no names (§4b) |
| `POST` | `/v1/admin/users/:uid/password-reset` | platform admin | 201 `{resetUrl, expiresAt}` — single use, 7 days |
| `GET`  | `/v1/admin/ai-usage` | platform admin | This UTC month's AI use per project: `{month, from, until, projects: [{projectId, runs, reports, followUps, questions, failed, refused, inputTokens, outputTokens, tokens}], totals}` — project ids only, no names or content |

`GET /v1/me` also returns `isPlatformAdmin`. A platform admin owns the server
(created by the first-run setup) but is **not** a member of any project and sees
no project data. Admin routes answer 401 without a session and 403 for a
non-platform-admin.

Username/password rules (3–64 characters of `A-Z a-z 0-9 . _ - @`; passwords at
least 8) apply to setup, signup, password change and reset — **not** to
`/v1/auth/register`, which the desktop client uses and which keeps accepting what
it always did.

`login`, `register`, `signup`, `setup` and `reset` are rate limited per client IP
(`RATE_LIMIT_PER_MINUTE`, default 60; failed logins also 10 a minute per account) → 429 `rate_limited`. The server trusts
`x-forwarded-*` (it runs behind a proxy). Join and reset links use
`PUBLIC_BASE_URL`, else `RENDER_EXTERNAL_URL` (if the host sets it), else the request's
protocol (`x-forwarded-proto`) and `Host` (`X-Forwarded-Host` only with `TRUST_FORWARDED_HOST`; see DEPLOY.md).

**Limits.** `maxProjectStorageMb` refuses coordinator uploads (`PUT …/cep`, `PUT …/csv-files/:filename`)
that would take the project over the limit with 413 `storage_limit_reached` `{usedBytes, limitBytes}`
(a replaced CEP or same-name CSV is not counted twice). Collectors' `records:batch` uploads are
**never** refused because of it — losing field data is worse; the overview shows the space used
and the dashboard warns from 90 % and above 100 %.

The built dashboard (`web/dist`, built from [`web/`](web)) is served at `/`; any
other `GET` that accepts HTML and is not under `/v1/` or `/health` returns its
`index.html`, so `/join/<token>`, `/setup`, `/reset/<token>` load the app. Without
`web/dist` the server is API-only. Unknown routes answer JSON `{"error": "not_found"}`.

**Plot CSVs & assignments (Phase B)**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `PUT`  | `/v1/projects/:pid/csv-files/:filename` | admin | Upload/replace a plot CSV (raw `text/csv`) → `{id,checksum,plotCount,distribution}`; 413 `storage_limit_reached` over the project's space limit. A divided file keeps the holdings of the plot ids still in it |
| `POST` | `/v1/projects/:pid/plot-design` | admin | Plot design: `{geojson: text} \| {shapefile: base64 zip}` (polygons in WGS84; holes and multipolygons) → `{features, fields, areaKm2, max}`; with `design` (`{method: 'random', count}` \| `{method: 'grid', spacingMeters, randomOffset}` \| `{method: 'stratified', field, allocation: 'equal'\|'proportional', count}`) and optional `seed` → also `{plots, tooMany, strata, seed}`; with `generate: true` → the plot file (text/csv, `x-plot-count`): key columns (id; the survey's own round key gets its first code), `YCoordinate, XCoordinate`, then the survey's extra plot-file columns in its order (Collect Earth reads them by position; elevation, slope, aspect 0, the others empty; without a project file just those three); when stratified, the stratum goes in the survey's own `stratum` column (any case), else in a `stratum` column after them all. Same seed, same plots. At most 50,000 plots. The dashboard then uploads it with `PUT …/csv-files/:filename`. 400 `bad_request` with `code` `bad_area` / `bad_design` / `too_many` / `several_keys` |
| `GET`  | `/v1/projects/:pid/csv-files` | admin | List CSV files `{csvFiles: [{id, filename, checksum, plotCount, distribution, divided, dividedPeople}]}` (`dividedPeople` = people holding ≥ 1 plot, 0 for a whole file) |
| `GET`  | `/v1/projects/:pid/csv-files/:id/content` | member | Download CSV bytes; checksum of what is served in `x-checksum-sha256`. Whole file: operator only if assigned. Divided file: the caller's own file (header + their plots; 404 if they hold none) — an admin gets the full file unless `?mine=1`. While the survey has a round the server fills in, every file a person gets has it (round added: a `round` column after the id, `1` main, `2` on quality-check copies; own round with a reassessment code: that code on copies). `?v=<checksum>`: 409 `changed` when what would be served now has another checksum |
| `PUT`  | `/v1/projects/:pid/assignments` | admin | Replace the csv↔operator assignment set (pairs of divided files are ignored) |
| `GET`  | `/v1/projects/:pid/assignments` | admin | Full assignment matrix |
| `GET`  | `/v1/projects/:pid/my-assignment` | member | The caller's assigned CSVs + download URLs + checksums; also the divided files where they hold plots (`checksum`/`plotCount` of their own file, `downloadPath` `…/content?mine=1&v=<checksum>`); with a round column, whole files are listed the same way. A file that cannot be built is left out (logged) |

**Dividing a plot file between people** (see `docs/plans/2026-10-29-dividing-plots.md`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/v1/projects/:pid/csv-files/:id/columns` | admin | `{plotCount, hasHeader, separator, columns: [{index, name, distinctCount, values: [{value, count}] \| null}]}` — `values` (by value, `""` last) only up to 200 distinct values, never for the id column |
| `GET`  | `/v1/projects/:pid/csv-files/:id/distribution` | admin | `{distribution \| null, plotCount, unassigned, people: [{userId, username, plots, overlap, submitted}]}` (`plots` includes the `overlap` copies) |
| `PUT`  | `/v1/projects/:pid/csv-files/:id/distribution` | admin | `{mode: 'whole'}` \| `{mode: 'even', people, order: 'file'\|'mixed', overlapPercent?, seed?}` \| `{mode: 'column', column, groups: [{value, people}], order, overlapPercent?, seed?}`, optional `dryRun: true` → the GET shape (the `seed` used is in `distribution`); 400 `bad_request` `{reason}` |
| `POST` | `/v1/projects/:pid/csv-files/:id/move-unfinished` | admin | `{fromUserId, toUserId}` → the GET shape + `moved`, `notMoved`, `droppedChecks`; plots `from` has done stay (a main plot when they did its main assessment, a copy when they did its check); a copy `to` holds becomes their main plot unless `to` already checked it (then it stays, `notMoved`); `from`'s copies of `to`'s main plots go (`droppedChecks`); a whole file is divided first (mode `manual`) |
| `GET` | `/v1/projects/:pid/sampling` | admin | the automatic checks (Task 13): `{rule, active, intervalMinutes, due, nextAutomaticAt, lastDraw, pending, files, wholeFiles, checkers, members, noCheckers}` |
| `PUT` | `/v1/projects/:pid/sampling` | admin | `{checkers: [userId] \| null, firstN: 1-1000 \| null, percent: 1-100 \| null, files?: {<divided file id>: {use: 'project' \| 'off' \| 'own', ...}}}` → the GET shape; the seed is kept; audited `settings.changed` `{setting: 'sampling'}`; draws nothing by itself |
| `POST` | `/v1/projects/:pid/sampling/draw` | admin | "Draw now" → `{draw, view}`; 409 `no_rule` when no rule is on; audited `sampling.drawn` with its counts |
| `GET` | `/v1/projects/:pid/reference` | reviewer | reference plots (Task 14): `{coordinator, count, figures: {plots, assessed, checks, questions, people, computedAt, stale}}`; coordinators also `{max, plots, files, wholeFiles, assessors, collectors, people}` and `figures.byPlot` |
| `POST` | `/v1/projects/:pid/reference/plots` | admin | `{csvFileId, assessorUserId, plots: [id]}` or `{…, random: 1-500}` → `{result, …view}`: the assessor (a coordinator or reviewer) holds them as main, every collector a copy; 400 `bad_request` with `code` (`whole_file`, `unknown_plots`, `not_a_plot`, `in_other_file`, `assessed_by_others`, `too_many`, `bad_assessor`, `none_free`); audited `reference.changed` |
| `POST` | `/v1/projects/:pid/reference/remove` | admin | `{plots: [{csvFileId, plot}]}` or `{all: true}` → `{result, …view}`; copies whose holder has no record of the plot go; audited `reference.changed` |

**Quality, reports and the AI assistant** (see `docs/plans/2026-10-29-reassessment-round.md`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/v1/projects/:pid/quality` | admin | The quality figures: `plotsChecked`, `plotsDiffering`, agreement by `questions`, `confusions`, `people`, `weeks`, `differences` (≤ 500), `problems` (≤ 500, `problemsTotal`), plus `decisions`, `notes`, `settings: {margins}`, `options` (answer labels), `computedAt`, `stale`. Counts are checks; rates are null below 20 checks. 503 `busy` (`Retry-After: 10`) while the figures are worked out for other projects; 500 `quality_failed` |
| `PUT`  | `/v1/projects/:pid/quality/settings` | admin | `{margins?: {questionKey: percent 0–100}, fastSeconds?: 1–120}`: number margins (replaces the set) and the "very fast" flag's threshold; the one left out stays |
| `GET`  | `/v1/projects/:pid/quality/flags?person=&kind=` | reviewer | Plots worth a look (Task 5): `{fastSeconds, plots, counts, people, total, flags: [{kind, plot, operator, at, details}], requiredQuestions, computedAt, stale}`; kinds `very_fast`, `same_as_before`, `required_empty`, `edited_after_decision`, `two_main`, `no_plot` |
| `PUT` / `DELETE` | `/v1/projects/:pid/quality/decisions/:plot` | admin | `{decision: 'first' \| 'check' \| 'recheck', comment?}`: which answer is right for a plot (the export's `final`); DELETE undoes it |
| `GET` / `POST` | `/v1/projects/:pid/quality/notes` | admin | Guidance notes `{questionKey, firstValue?, checkValue?, text (≤ 2000)}` |
| `PUT` / `DELETE` | `/v1/projects/:pid/quality/notes/:id` | admin | Edit or delete a note |
| `POST` | `/v1/projects/:pid/quality/places` | admin | `{plots: [ids]}` (1–200) → `{places: [{plot, lat, lon}]}` from the plot files (latitude/longitude only; otherwise `{places: [], unsupportedSrs}`) |
| `GET`  | `/v1/projects/:pid/plots/search?q=` | reviewer | plot search: `{plots: [{plot, name, files: [{id, filename}]}] (≤ 20, ids starting with q, unit or the id the collector sees, case ignored, shortest first), more}`; from the plot files' ids (an index kept per version of the files), never the records; collectors 403 |
| `GET`  | `/v1/projects/:pid/plots/:plot` | reviewer | one plot: `{plot, name, files: [{id, filename, divided, main, copies}], records: [{operator, recordKey, round, assessment, submitted, deleted, modifiedOn, receivedAt, answers}], questions, labels, options, decision, ownPlot, flags, differences, figures, place, outline, unsupportedSrs?}`; only that plot's records are read; flags and differences from the quality figures at hand (`QualityService.peek`, never awaited; null without); reviewers get the files without people (no `main`/`copies`), no deleted records and no `receivedAt`; 404 for a plot in no plot file; collectors 403 |
| `GET`  | `/v1/projects/:pid/map/plots?file=&person=&offset=&size=&version=` | reviewer | map of progress: the plots with a latitude and longitude as `points` `[lat, lon, status, holder]` with their `plots` ids and `names` (the id the collector sees; null when it is the id), at most 20,000 a page (`offset`, `next`). The first page (no `version`) builds the map and gives its `version`; the next pages send it and are slices of that build (kept 2 min, 8 builds), 409 `map_changed` when the server no longer has it. Also `statuses` (`notStarted, started, submitted, accepted, recheck, differs, resubmitted`; 2-6 together are Progress's submitted), `counts` per status (plots off the map included), `notOnMap`, `files [{id, filename, plots, onMap}]`, `figures`, `asOf`, `unsupportedSrs?`; coordinators also get `people` (the person filter: plots they hold or assessed first) and `holders` (groups of names `holder` indexes), reviewers neither (`person` is 403 for them); disagreements and plots submitted again after "both need another look" only from the quality figures at hand (peek, never awaited); collectors 403. Not `/plots/geo`: that is the page of a plot named "geo" |
| `GET`  | `/v1/projects/:pid/my-quality` | member with a session | The caller's own figures as first assessor and up to 3 mix-ups with the matching notes; no other person's name |
| `GET`  | `/v1/projects/:pid/quality/team-report` | admin | Agreement by question, the 10 most mixed-up answers with example plots, the notes; no names |
| `GET` / `PUT` | `/v1/projects/:pid/ai` | admin (PUT: with a session) | `{enabled, available}`; PUT `{enabled}` (409 `ai_unavailable` to switch on when the server does not allow it; switching off always works) |
| `POST` | `/v1/projects/:pid/ai/runs` | admin with a session | `{kind: 'report'}`, `{kind: 'follow_up', parentRunId, findingIndex, action: 'explain' \| 'draft_note' \| 'recheck'}` or `{kind: 'question', parentRunId, question (≤ 300)}`, optional `language` → 202 `{runId}`. 409 `busy` / `ai_unavailable` / `ai_not_enabled`; 429 `ai_daily_limit` / `ai_monthly_limit` with `resetsAt` (null when the limit is 0) |
| `GET`  | `/v1/projects/:pid/ai/runs` | admin with a session | The runs, newest first (`?limit=` 1–200), without results |
| `GET`  | `/v1/projects/:pid/ai/runs/:id` | admin with a session | One run: status, progress (tool names), the result with real names, the error code or the refusal |

The record batch body is **gzip-compressed** (the Java `CloudApiClient` sends
`Content-Encoding: gzip`); the server gunzips it in a `preParsing` hook.

Passwords are hashed with **scrypt** (`node:crypto`, no native deps) so the
scaffold builds everywhere; production should swap `src/password.ts` for argon2id
(only that module changes — the stored-string shape is private to it).

### Record envelope

Mirrors `CloudRecordSerializer.RecordEnvelope` on the client:

```jsonc
{
  "recordKey": "123,456",     // comma-joined key attributes
  "surveyUri": "http://…",
  "operator": "maria",
  "modifiedOn": 1720000000000, // epoch ms (or null)
  "activelySaved": true,
  "step": 1,
  "xml": "<record>…</record>", // null for tombstones
  "summary": { "id": "123", "…": "…" },
  "deleted": false,            // true = tombstone (soft delete)
  "payloadVersion": 1
}
```

### Conflict resolution

Last-write-wins per `(projectId, recordKey, operator)`. Keying by operator means
two operators on the same plot never clobber each other. An incoming envelope
older than the stored row is reported `stale` (the client still marks it synced);
newer or equal overwrites. Deletions are **soft** (`deleted=true` + `deletedOn`);
a later re-upload resurrects the record.

## Tenancy & isolation

The project is the tenant boundary. See §4b of the platform plan. Enforcement:

1. **Membership middleware** (`plugins/projectAuth.ts`): every `/v1/projects/:pid/*`
   route resolves the bearer token to a membership and 404s if it is not for
   `:pid` — a non-member cannot even confirm the project exists.
2. **Postgres Row-Level Security** (`migrations/001_init.sql`): a second fence —
   each project-scoped query runs with `app.current_project` set, so even a query
   that forgot its `project_id` filter cannot cross tenants. It binds the server only
   when it runs as its own role, not the tables' owner (`MIGRATION_DATABASE_URL` for
   the owner, as `deploy.sh` sets up; DEPLOY.md, "Row-Level Security and the database
   role").
3. **Isolation test gate** (`test/isolation.test.ts`): logs in as project A and
   asserts 404 against project B for every endpoint. New endpoints add a case here.

## Layout

```
src/
  config.ts            env → Config
  server.ts            buildServer(store) — Fastify app, gunzip hook (inject-testable)
  index.ts             process entrypoint (picks store, listens, graceful shutdown)
  local.ts             LOCAL_MODE: the one account and project, the routes off, the sign-in links
  localBuild/          the local bundle's stand-ins for the cloud-only modules (scripts/build-local.mjs)
  auth.ts              token generate / sha256 hash / bearer parsing
  lww.ts               last-write-wins decision
  types.ts             wire + row types
  accountRules.ts      username/password rules, setup code, public base URL
  rateLimit.ts         in-memory per-IP limiter for the auth endpoints
  export.ts            records -> CSV
  plots.ts             plot file parser (as Collect Earth reads it) + one person's own file
  division.ts          dividing a file's plots between people, move-unfinished
  limits.ts            per-project storage limit checks (projects-per-account is in routes/projects.ts)
  plugins/projectAuth  membership / session / platform-admin preHandlers (401 / 404 / 403)
  routes/projects.ts   provision, ping, survey upload, rename, overview, export
  routes/platform.ts   my projects, invites, CEP, members
  routes/admin.ts      server info, setup, signup, reset, /v1/admin/*
  routes/auth.ts       register, login, logout, /me, password change
  routes/assignments.ts plot CSVs and assignments
  routes/division.ts   columns, distribution, move-unfinished
  routes/records.ts    records:batch intake
  routes/quality.ts    quality figures, settings, decisions, notes, reports, overlap (plot places in plotPlaces.ts)
  routes/plotsGeo.ts   the map of progress (plotsGeo.ts: statuses and pages)
  routes/ai.ts         the AI switch and runs
  cep.ts               reading a CEP and adding the hidden round key
  rounds.ts            each record's plot and round
  surveyOutline.ts     the survey's questions, answer options and help texts
  quality.ts           agreement figures (qualityService.ts, qualityWorker.ts: cache and worker thread)
  qualityReports.ts    the personal and team reports
  ai/                  the AI assistant: client (Gemini on Vertex AI), tools, runs, limits, development fake
  store/               Store interface + InMemoryStore + PostgresStore + migrate
migrations/*.sql       schema + RLS (004: platform admin, settings, resets, invite revocation; 005: terms_accepted_at; 006: plot_assignments, csv_files.distribution; 007: rounds; 008: quality decisions and notes; 009: quality version counter; 010: retired usernames; 011: AI runs)
test/                  isolation, sync, accounts, dashboard (in-memory store)
web/                   the React dashboard (own package.json; built into web/dist)
```

## Third-party software in the dashboard

The dashboard bundles (no CDN) [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause,
© 2010-2023 Volodymyr Agafonkin, © 2010-2011 CloudMade) and
[Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3 (MIT,
© 2012 David Leaver) for the map of progress, loaded only on the Map tab. Their licence
texts are in `web/public/third-party-licenses.txt`, which the build copies into `web/dist`
(served at `/third-party-licenses.txt`); update it with the versions in `web/package.json`.
The base map is OpenStreetMap's tiles (© OpenStreetMap contributors, ODbL), with the
attribution shown on the map; see DEPLOY.md, "The map's base map".

## Not yet implemented, and known limitations

Not built: argon2id for passwords (scrypt is used, `src/password.ts`), GCS for
artifacts, undoing a bulk decision run, bounce handling for the weekly emails.

Known limitations (details in DEPLOY.md, "Known limitations"):
- **Desktop, plot settings** (Collect Earth's Swing dialog, not changed here): opening
  it or pressing "Refresh assignments" can download two plot files at once, so the plot
  file field may end on another file (and a download may fail its checksum); its preview
  table shows the `round` column, so a collector who opens it can tell the drawn checks
  apart.
- **Desktop, form:** a plot sent back a second time shows the comment the record was
  saved with at the top of the form, not the new one (the balloon shows the new one).
- **A comment that looks like a shape** (WKT or GeoJSON) becomes the plot's shape in
  polygon projects.
- **Per-instance limits** (rate limits, confirmation mails an hour, the reset mails of
  "Forgot your password?", one backup at a time and the used backup links, the server panel's counts, one weekly email run at a
  time) count on each Cloud Run instance on its own.
- **The map's pages**: an instance whose quality figures differ and that cannot work
  out the same ones answers 409 `map_changed` (the dashboard reads the map again from the start a few
  times before it says the map changed).
- **Reference plots can be guessed from gaps:** a reviewer never sees a reference plot
  on the map, in plot search or in the plot places, but where plot ids run in sequence,
  the ids missing from what they see are the reference plots. Only plot ids that do not
  show an order would close this.
- **Blind checks need the Collect Earth release after 1.23.19.**

The decisions still open for the owner are listed in
`docs/plans/2026-11-01-dashboard-improvements.md`, section "Owner decisions pending".
