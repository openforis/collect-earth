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

## With PostgreSQL

```bash
docker compose up -d
cp .env.example .env            # sets DATABASE_URL for the compose Postgres
STORE_BACKEND=postgres DATABASE_URL=postgres://ce:ce@localhost:5432/collect_earth_cloud npm run migrate
STORE_BACKEND=postgres DATABASE_URL=postgres://ce:ce@localhost:5432/collect_earth_cloud npm run dev
```

## API (v1)

All project-scoped routes require `Authorization: Bearer <token>`.

Two token kinds are accepted interchangeably on project-scoped routes: **Phase-0
project tokens** (`adminToken`/`projectToken` from provisioning) and **Phase-A user
session tokens** (from login, access via `project_members`).

**Sync & provisioning (Phase 0)**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/projects` | `x-admin-key` (if configured) | Provision a project → `{projectId, adminToken, projectToken}` |
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
| `POST` | `/v1/projects/:pid/invites` | admin | Mint a join invite (role, maxUses, expiry) |
| `GET`  | `/v1/join/:token` | none | Invite preview (project name, role, validity) |
| `PUT`  | `/v1/projects/:pid/cep` | admin | Upload the CEP zip (raw `application/zip` body) |
| `GET`  | `/v1/projects/:pid/cep` | member | Download the CEP zip (join bootstrap) |
| `GET`  | `/v1/projects/:pid/members` | admin | List members |
| `PUT`  | `/v1/projects/:pid/members/:uid` | admin | Change role (last-admin demotion refused) |
| `DELETE` | `/v1/projects/:pid/members/:uid` | admin | Remove member (last-admin removal refused) |

**Plot CSVs & assignments (Phase B)**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `PUT`  | `/v1/projects/:pid/csv-files/:filename` | admin | Upload/replace a plot CSV (raw `text/csv`) → `{id,checksum,plotCount}` |
| `GET`  | `/v1/projects/:pid/csv-files` | admin | List CSV files |
| `GET`  | `/v1/projects/:pid/csv-files/:id/content` | member | Download CSV bytes (operator: only if assigned); checksum in `x-checksum-sha256` |
| `PUT`  | `/v1/projects/:pid/assignments` | admin | Replace the csv↔operator assignment set |
| `GET`  | `/v1/projects/:pid/assignments` | admin | Full assignment matrix |
| `GET`  | `/v1/projects/:pid/my-assignment` | member | The caller's assigned CSVs + download URLs + checksums |

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
   that forgot its `project_id` filter cannot cross tenants.
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
  plugins/projectAuth  membership preHandler (401 / 404 / 403)
  routes/projects.ts   provision, ping, survey upload
  routes/records.ts    records:batch intake
  store/               Store interface + InMemoryStore + PostgresStore + migrate
migrations/001_init.sql  schema + RLS
test/                  isolation + records behaviour (in-memory store)
```

## Not yet implemented (later phases)

User accounts/login, invites & join-by-URL, assignments, stats/overview, export
zip, review workflow, GCS for artifacts. Phase 0 uses project-scoped tokens; the
resolve-by-hash auth contract is unchanged when per-user tokens arrive.
