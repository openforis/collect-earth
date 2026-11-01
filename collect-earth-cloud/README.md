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

## Deployment

To run your own server on Google Cloud without technical knowledge, follow
[`SELF-HOSTING.md`](SELF-HOSTING.md): one button and one script.

For production (Cloud Run + Cloud SQL, or any Docker host + managed Postgres),
required env vars, and how to onboard projects, see [`DEPLOY.md`](DEPLOY.md).

## With PostgreSQL

```bash
docker compose up -d
cp .env.example .env            # sets DATABASE_URL for the compose Postgres
STORE_BACKEND=postgres DATABASE_URL=postgres://ce:ce@localhost:5432/collect_earth_cloud npm run migrate
STORE_BACKEND=postgres DATABASE_URL=postgres://ce:ce@localhost:5432/collect_earth_cloud npm run dev
```

Smoke test of the activity data (migration 012) on a throwaway PostgreSQL: it creates
and drops its own database and roles, so never point it at a real server.

```bash
docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
npm run smoke:pg -- 55481      # the port; prints one line per check, then ALL OK
npm run smoke:pg:progress -- 55481   # the Progress tab (migration 013), with GET /progress on 100,000 records and 20,000 checks
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
| `POST` | `/v1/projects/:pid/invites` | admin | Mint a join invite `{role?, maxUses?, expiresInDays?}` → `{inviteToken, joinPath, joinUrl, role, maxUses, expiresAt}` (`joinUrl` always absolute, see below) |
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
| `GET`  | `/v1/server-info` | none | `{needsSetup, signupOpen, projectCreation, version, termsUrl, contactEmail, serverName, aiAvailable}` (`termsUrl`, `contactEmail`, `serverName` `null` when not set; `aiAvailable`: the AI assistant is configured and allowed on this server) |
| `POST` | `/v1/setup` | setup code in body | `{setupCode, username, password}` → 201 `{token, userId, username}` (the platform admin, logged in); 403 `bad_setup_code`; 409 `already_set_up` / `username_taken`; 400 `bad_username` / `weak_password` |
| `POST` | `/v1/auth/signup` | none | `{username, password, email?, acceptTerms?}` → 201 `{token, userId, username}`; 403 `signup_closed`; 409 `username_taken`; 400 `bad_username` / `weak_password` / `terms_not_accepted` (when `termsUrl` is set and `acceptTerms` is not `true`; the acceptance time is stored as `users.terms_accepted_at`) |
| `POST` | `/v1/auth/reset` | reset token in body | `{token, newPassword}` → 204, revokes all the user's sessions; 410 `invalid_reset_token` (unknown, used or expired); 400 `weak_password` |
| `PUT`  | `/v1/me/password` | session | `{currentPassword, newPassword}` → 204; 401 `invalid_credentials`; 400 `weak_password` |
| `GET`  | `/v1/me/deletion` | session | What deleting the account would do: `{soleCoordinator: [{projectId, name}], deletedWithAccount: [{projectId, name}], lastPlatformAdmin}` |
| `DELETE` | `/v1/me` | session | `{password}` → 204: deletes the account (sessions, memberships, assignments, reset links) and the projects where it is the only member and coordinator. Records it uploaded stay in their projects. 401 `invalid_credentials`; 409 `last_platform_admin`; 409 `sole_coordinator` `{projects: [{projectId, name}]}` (only coordinator of a project others are in: hand it over or delete it first) |
| `POST` | `/v1/projects` | session | Allowed when `projectCreation` is `anyone` or the caller is a platform admin (else 403 `project_creation_restricted`); the caller becomes its admin → 201 `{projectId, name}`. 403 `project_limit_reached` `{limit}` when the caller already coordinates `maxProjectsPerUser` projects (platform admins exempt) |
| `PATCH` | `/v1/projects/:pid` | admin | `{name}` → `{projectId, name}` |
| `DELETE` | `/v1/projects/:pid` | admin | `{confirmName}` (must equal the project name, else 400 `confirm_mismatch`) → 204: deletes the project and all its data — records, CEP, plot CSVs, assignments, invites, memberships, Phase-0 tokens — in one transaction. Cannot be undone |
| `GET`  | `/v1/projects/:pid/overview` | admin | `{name, cep: {bytes, updatedAt} \| null, members, csvFiles, plots, records: {total, submitted, byOperator: [{operator, total, submitted, lastModifiedOn}]}, storage: {usedBytes, limitBytes \| null}}` — deleted records excluded from the counts, times in epoch ms; `storage` = CEP + CSV bytes + stored record xml/summary bytes |
| `GET`  | `/v1/projects/:pid/progress?days=90&tz=Europe/Rome` | admin, reviewer | The Progress tab: `{timeZone, today, totals: {plots, assigned, notAssigned, submitted, started, notStarted}, daily: [{date, submitted, cumulative}], forecast, attention: [...] \| null, settings}` — totals per plot unit (first assessments only), `daily.submitted` = the plots submitted now whose first assessment was first submitted that day in `tz` (checked against the IANA list, else UTC; `timeZone` says which was used), so the bars and the cumulative line add up to `totals.submitted`, `days` 14-366; `attention` (the cards that name people) is null for a reviewer |
| `GET`/`PUT` | `/v1/projects/:pid/progress/settings` | admin | `{deadline: "YYYY-MM-DD" \| null, targetPlots: 1-10000000 \| null, quietDays: 1-365}` (defaults null, null, 3); a change is audited as `settings.changed` |
| `GET`  | `/v1/projects/:pid/invites` | admin | Open invites (not revoked, expired or used up) `{invites: [{id, role, maxUses, usedCount, expiresAt, createdAt}]}` — the token is only shown at creation |
| `DELETE` | `/v1/projects/:pid/invites/:id` | admin | Revoke → 204 (404 if not an open invite of this project) |
| `GET`  | `/v1/projects/:pid/export.csv` | admin | One row per non-deleted `(recordKey, operator)`: `record_key, plot, round, assessment, final, operator, actively_saved, modified_on` (ISO 8601; `assessment` is `main`, `check` or `other`; without `round` in the key, round is 1 or 2 from who holds the plot as a quality-check copy; `final` is `yes`/`no` for the answer a coordinator's decision accepted, `recheck`, or empty) + the sorted union of summary keys; RFC 4180, UTF-8 BOM, `content-disposition: attachment` |
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
(`RATE_LIMIT_PER_MINUTE`, default 10) → 429 `rate_limited`. The server trusts
`x-forwarded-*` (it runs behind a proxy). Join and reset links use
`PUBLIC_BASE_URL`, else `RENDER_EXTERNAL_URL` (if the host sets it), else the request's proto/host.

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

**Quality, reports and the AI assistant** (see `docs/plans/2026-10-29-reassessment-round.md`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/v1/projects/:pid/quality` | admin | The quality figures: `plotsChecked`, `plotsDiffering`, agreement by `questions`, `confusions`, `people`, `weeks`, `differences` (≤ 500), `problems` (≤ 500, `problemsTotal`), plus `decisions`, `notes`, `settings: {margins}`, `options` (answer labels), `computedAt`, `stale`. Counts are checks; rates are null below 20 checks. 503 `busy` (`Retry-After: 10`) while the figures are worked out for other projects; 500 `quality_failed` |
| `PUT`  | `/v1/projects/:pid/quality/settings` | admin | `{margins: {questionKey: percent 0–100}}` for number questions (replaces the set) |
| `PUT` / `DELETE` | `/v1/projects/:pid/quality/decisions/:plot` | admin | `{decision: 'first' \| 'check' \| 'recheck', comment?}`: which answer is right for a plot (the export's `final`); DELETE undoes it |
| `GET` / `POST` | `/v1/projects/:pid/quality/notes` | admin | Guidance notes `{questionKey, firstValue?, checkValue?, text (≤ 2000)}` |
| `PUT` / `DELETE` | `/v1/projects/:pid/quality/notes/:id` | admin | Edit or delete a note |
| `POST` | `/v1/projects/:pid/quality/places` | admin | `{plots: [ids]}` (1–200) → `{places: [{plot, lat, lon}]}` from the plot files (latitude/longitude only; otherwise `{places: [], unsupportedSrs}`) |
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

## Not yet implemented (later phases)

Email (verification, self-service password reset), export of
record XML / a Collect backup, the Phase C review workflow, argon2id, GCS for
artifacts.
