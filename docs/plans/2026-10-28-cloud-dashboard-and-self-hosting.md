# Collect Earth Cloud — web dashboard (option 1) and self-hosting (option 2)

Goal: a coordinator with no technical knowledge can run a distributed Collect Earth
project from a browser — either on a server hosted for them (option 1) or on one
they deploy themselves with a button (option 2). Everything they do today with
`curl` and an admin key moves into a web page.

**Hard constraint:** no change to the Java desktop client, above all nothing in the
Swing UI (another branch is replacing Swing with HTML). The dashboard must work with
the client exactly as it is: the client joins with an invite URL
(`<base>/join/<token>`), registers or logs in with `/v1/auth/*`, downloads the CEP
and syncs records. All work lives in `collect-earth-cloud/`, plus `render.yaml` at
the repository root and docs.

## Concepts

- **Platform admin**: the person who owns the server (the hosting organisation in
  option 1, the coordinator in option 2). Created once by the first-run setup.
  Manages server settings and can issue password-reset links. A platform admin is
  *not* automatically a member of any project and sees no project data (the
  §4b privacy rule stays: only members see a project).
- **Server settings** (stored in the database, edited by the platform admin):
  - `signupOpen` (default `false`): anyone can create an account from the sign-up
    page. Accounts made through an invite are always allowed.
  - `projectCreation` (default `"platform-admins"`): `"anyone"` lets every logged-in
    user create projects (the hosted model); `"platform-admins"` restricts it.
- **First-run setup**: while no platform admin exists the dashboard shows a setup
  page. It asks for the *setup code* and the new admin's username and password.
  The setup code is `SETUP_CODE` from the environment, or, if unset, a random code
  generated at boot and printed in the server log. This stops a stranger from
  claiming a freshly deployed public server.

## Server changes (`collect-earth-cloud/src`)

Migration `004_platform.sql`: `users.is_platform_admin BOOLEAN NOT NULL DEFAULT false`;
`server_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
`password_resets (token_hash TEXT PRIMARY KEY, user_id UUID REFERENCES users ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ)`;
`invites.revoked_at TIMESTAMPTZ`. Global tables, not under RLS (like 002).

New and changed endpoints (all JSON; errors `{error, reason?}`):

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/server-info` | none | `{needsSetup, signupOpen, projectCreation, version}` |
| `POST` | `/v1/setup` | setup code in body | `{setupCode, username, password}` → creates the platform admin, 201 `{token, userId, username}`; 409 `already_set_up`; 403 `bad_setup_code` |
| `POST` | `/v1/auth/signup` | none | `{username, password, email?}` → 201 session; 403 `signup_closed`; 409 `username_taken`; 400 `weak_password` / `bad_username` |
| `PUT` | `/v1/me/password` | session | `{currentPassword, newPassword}` → 204; 401 if current is wrong |
| `GET` | `/v1/me` | session | adds `isPlatformAdmin` |
| `POST` | `/v1/auth/reset` | reset token in body | `{token, newPassword}` → 204; 410 if used/expired. Revokes the user's sessions |
| `POST` | `/v1/projects` | session **or** `x-admin-key` | With a session: allowed if `projectCreation=anyone` or caller is platform admin (else 403 `project_creation_restricted`); creates the project, makes the caller its admin, returns 201 `{projectId, name}`. With `x-admin-key`: unchanged Phase-0 behaviour. Without either: allowed only when `ADMIN_API_KEY` is unset **and** `STORE_BACKEND=memory` (tests/dev); otherwise 401 |
| `PATCH` | `/v1/projects/:pid` | admin | `{name}` rename |
| `GET` | `/v1/projects/:pid/overview` | admin | `{name, cep: {bytes, updatedAt} \| null, members, csvFiles, plots, records: {total, submitted, byOperator: [{operator, total, submitted, lastModifiedOn}]}}` (deleted records excluded) |
| `GET` | `/v1/projects/:pid/invites` | admin | active invites `{id, role, maxUses, usedCount, expiresAt, createdAt}` (the link itself is only shown at creation) |
| `DELETE` | `/v1/projects/:pid/invites/:id` | admin | revoke (revoked invites fail preview/register like exhausted ones) |
| `GET` | `/v1/projects/:pid/export.csv` | admin | one row per non-deleted `(recordKey, operator)`: `record_key, operator, actively_saved, modified_on` (ISO 8601) then the union of `summary` keys, sorted; RFC 4180 quoting; UTF-8 with BOM so Excel opens it; `content-disposition: attachment` |
| `GET` | `/v1/admin/settings` / `PUT` | platform admin | read / update `{signupOpen, projectCreation}` |
| `GET` | `/v1/admin/users` | platform admin | `{users: [{userId, username, isPlatformAdmin, projects}]}` (project *count* only, no names: §4b) |
| `POST` | `/v1/admin/users/:uid/password-reset` | platform admin | 201 `{resetUrl, expiresAt}` (7 days, single use). Only the platform admin may do this: a project admin resetting a user who also belongs to another project would cross the tenant boundary |

Rules:
- Usernames 3–64 chars of `A-Z a-z 0-9 . _ - @`; passwords at least 8 chars. Applied
  to signup, setup, password change and reset — **not** to `/v1/auth/register`, which
  the desktop client uses and must keep accepting what it accepts today.
- `invite_exhausted`/`invalid_invite` semantics of `/v1/auth/register` are unchanged;
  a revoked invite answers like an invalid one.
- A small in-memory rate limiter (no new dependency) on `login`, `signup`, `setup`,
  `reset`, `register`: 10 requests per minute per IP, 429 `rate_limited`. Fastify
  `trustProxy: true` so the client IP is right behind Render / Cloud Run.
- Join links: `PUBLIC_BASE_URL`, else `RENDER_EXTERNAL_URL` (Render sets it), else
  derived from the request (`x-forwarded-proto` + host). Same for reset links.
- Both stores (memory and Postgres) implement every new Store method; RLS untouched.
- `test/isolation.test.ts` gets a case for every new project-scoped endpoint; new
  tests cover setup, signup modes, project creation modes, password change/reset,
  invite list/revoke, overview and export.

Static dashboard: the server serves `web/dist` (if present) at `/` with
`@fastify/static` (v7, Fastify 4), and returns `index.html` for any other `GET` that
is not under `/v1/` or `/health` and accepts HTML, so `/join/<token>`, `/projects/…`,
`/setup` and `/reset/<token>` all load the app. The Dockerfile becomes multi-stage:
build `web/`, then copy `web/dist` into the runtime image.

## Dashboard (`collect-earth-cloud/web`)

React 19 + MUI 9 + Vite + vitest, the same versions as
`collect-earth/collect-earth-app/src/main/frontend/package.json`. Own `package.json`.
Dev server proxies `/v1` to `http://localhost:8080`. The session token is kept in
`localStorage` and sent as `Authorization: Bearer`. Languages en, es, fr, pt from
the browser language with a switcher; plain words, no jargon ("plot files", not
"CSV assignments"; "people", not "members").

Pages:
1. **Setup** (when `needsSetup`): explains what the setup code is and where to find
   it (Render: the *Environment* tab; elsewhere: the server log), then creates the
   admin and logs in.
2. **Log in / Create account** (the latter only when `signupOpen`).
3. **My projects**: cards with name and role; "New project" when allowed.
4. **Project** (admin), tabs, each with an empty state that says what to do next:
   - *Overview*: a checklist that walks a new coordinator through the steps —
     upload the project file (CEP) → add plot files → invite people → assign plot
     files → follow progress; counts of plots, submitted plots per person.
   - *Project file*: upload the `.cep` by drag and drop or a button; shows when it
     was last updated. Explains that collectors receive it when they join.
   - *People*: invite (role, how many people can use the link, expiry) → shows the
     link with a copy button and the exact steps the collector follows in Collect
     Earth; list of open invites with revoke; list of people with role change and
     remove (the last-admin refusals shown as plain messages).
   - *Plot files*: upload CSVs, see plot counts; assign each file to people with a
     checkbox grid.
   - *Data*: download all collected data as CSV.
   - *Settings*: rename the project.
   Non-admin members see a short page saying their work is done in Collect Earth.
5. **Join** (`/join/<token>`, public): project name and role from `/v1/join/:token`,
   then the steps: install Collect Earth (link), open it, *File → Join cloud
   project…*, paste this link (copy button). Invalid/expired invites say so.
6. **Reset password** (`/reset/<token>`).
7. **Account**: change password. **Server** (platform admin): the two settings,
   users with "Make a reset link".

## Option 2: self-hosting

- `render.yaml` at the repository root (Render Blueprint): a Docker web service
  with `rootDir: collect-earth-cloud`, a Postgres database, `STORE_BACKEND=postgres`,
  `DATABASE_URL` from the database, `MIGRATE_ON_BOOT=true`, `SETUP_CODE` generated
  (`generateValue: true`), health check `/health`. Paid starter plans (Render's free
  Postgres is deleted after 30 days); the guide states the monthly cost.
- A **Deploy to Render** button in the guide and the README.
- `docker-compose.prod.yml` + `Caddyfile` for anyone with a small Linux server and a
  domain: Postgres with a volume, the app, Caddy with automatic HTTPS.
- `collect-earth-cloud/SELF-HOSTING.md`: a plain-language guide for someone who has
  never deployed anything: what it costs, create a Render account, press the
  button, find the setup code, open the dashboard, first project, inviting
  collectors, backups, updating. `DEPLOY.md` stays the technical reference and is
  updated for the new variables (`SETUP_CODE`, `RENDER_EXTERNAL_URL` fallback).

## Verification

- `npm test` and `npm run typecheck` in `collect-earth-cloud/` and in `web/`.
- Local end to end with Docker: `docker compose -f docker-compose.prod.yml` (or the
  image + the dev Postgres), fresh database → setup → project → CEP → invite →
  open the join link page; driven in Chrome.
- The desktop client is not changed; its join/register/sync API calls are covered by
  the existing tests, which must keep passing untouched.

## Later (not in this round)

Email (verification, self-service password reset), deleting a project, export of
record XML / a Collect backup, Phase C review workflow, argon2id.
