# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Collect Earth Cloud: the sync + coordination backend for the Collect Earth Java desktop client
(sibling directory `../collect-earth`), plus a React dashboard in `web/`. Plans live in
`../docs/plans/`. README.md (API tables, record envelope, tenancy) and DEPLOY.md (env vars,
migrations, RLS role, operations, known limitations) are the detailed references.

## Commands

Server (repo root, Node >= 20, TypeScript run directly with `tsx`, no build step):

```bash
npm install
npm test                         # vitest, all of test/**/*.test.ts, in-memory store
npx vitest run test/isolation.test.ts          # one file
npx vitest run test/isolation.test.ts -t "404"  # tests whose name matches
npm run typecheck                # tsc --noEmit (strict, noUnusedLocals/Parameters); there is no linter
npm run dev                      # tsx watch src/index.ts, STORE_BACKEND=memory by default, port 8080
npm run build:local              # esbuild bundle for local mode -> dist/server.mjs + dist/qualityWorker.mjs
```

Dashboard (`web/`, its own package.json):

```bash
cd web && npm install
npm run dev        # Vite on :5173, proxies /v1 and /health to localhost:8080 (API_TARGET to override)
npm test           # vitest, web/src/**/*.test.ts
npm run build      # tsc + vite build -> web/dist (served by the server at /)
```

The `Dockerfile` builds `web/` and then runs the server with `node --import tsx src/index.ts`
(production also runs the TypeScript directly, with no compile step).

PostgreSQL: `docker compose up -d`, then `STORE_BACKEND=postgres DATABASE_URL=postgres://ce:ce@localhost:5432/collect_earth_cloud npm run migrate` (and `npm run dev` with the same env).
Postgres smoke tests (`npm run smoke:pg*`, scripts in `scripts/pg-smoke-*.mts`) create and drop
their own databases/roles: only run them against a throwaway container, passing its port:

```bash
docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
npm run smoke:pg:sampling -- 55481
```

## Architecture

- **Entry points**: `src/index.ts` (process: picks the store, migrates if `MIGRATE_ON_BOOT`,
  listens, shuts down) → `src/server.ts` `buildServer({ store, config, ... })`, which builds the
  Fastify app and registers every `src/routes/*.ts` module. `BuildServerOptions` has test
  injection points (AI client, mailer, OIDC keys, logger). Config comes from env in `src/config.ts`.
- **Store abstraction**: `src/store/store.ts` defines the `Store` interface, implemented twice:
  `InMemoryStore` (`memory.ts`, dev, tests and local mode) and `PostgresStore` (`postgres.ts`).
  Any new store method must be implemented in both; the unit tests only exercise the memory
  store, the Postgres side is covered by the smoke scripts.
- **Tenancy** (project = tenant), enforced three ways:
  1. `src/plugins/projectAuth.ts` preHandlers resolve the bearer token to a membership and answer
     **404, not 403**, for another project's routes.
  2. Postgres Row-Level Security: project-scoped queries go through `PostgresStore.withProject`,
     which sets `app.current_project`. RLS binds only when the server runs as a non-owner role
     (`DATABASE_URL` = app role, `MIGRATION_DATABASE_URL` = owner; see DEPLOY.md). When
     `MIGRATION_DATABASE_URL` is set, `src/boot.ts` refuses to start if RLS would not bind, and
     removes the owner URL from the environment once migrations are done.
  3. `test/isolation.test.ts`: every project-scoped endpoint needs a cross-tenant 404 case there.
- **Auth**: two token kinds are accepted on project routes: Phase-0 project tokens
  (`adminToken`/`projectToken` from provisioning) and user session tokens (login, via
  `project_members`). The API is versioned under `/v1`; the Java client depends on that contract.
- **Sync**: `POST .../records:batch` (`routes/records.ts`), gzip bodies accepted. Conflict
  resolution is last-write-wins per `(projectId, recordKey, operator)` (`src/lww.ts`); deletes
  are soft tombstones. The envelope mirrors the Java `CloudRecordSerializer.RecordEnvelope`.
- **Migrations**: `migrations/NNN_*.sql`, idempotent, applied in order by `src/store/migrate.ts`
  under an advisory lock; a file is skipped when its sha256 is unchanged, so editing an applied
  migration makes it run again. Add new schema as a new numbered file.
- **Quality figures** are computed off the request thread: `qualityService.ts` caches them and
  `qualityWorker.ts` runs in a worker thread (bundled separately by `build:local`).
- **AI assistant** (`src/ai/`): Gemini on Vertex AI; `AI_FAKE=1` uses a development fake.
- **Mail** (`mail.ts`, `routes/mail.ts`): optional, `SMTP_URL`; nothing is sent without it.
- **Local mode** (`LOCAL_MODE=1`, `src/local.ts`): the server run by Collect Earth on the user's
  machine. 127.0.0.1 only, memory store, one account + one project created at start, prints one
  JSON `{"ready":true,...}` line on stdout (logs go to stderr). Routes about other people or the
  server are listed in `LOCAL_OFF_ROUTES` and answer 404; new such routes must be added there.
  `scripts/build-local.mjs` swaps cloud-only modules (Postgres, migrations, Gemini, nodemailer,
  Sentry) for the stand-ins in `src/localBuild/`, so the bundle needs no node_modules: don't
  import those modules from code that local mode reaches except through the swapped paths.
- **Wire types** (`src/wire/`): the types of the JSON the server and the dashboard send each other,
  written once. Routes build their answers against them (`satisfies`); `web/src/api.ts` imports them
  with `import type` and uses the answer as it comes, no clean-up function. Types only
  (`test/wire.test.ts`). Progress, the bell, progress links and the Settings tab's project calls are
  there so far; move another area of `api.ts` the same way when touching it (`src/wire/README.md`).
- **Dashboard** (`web/src`): React 19 + MUI, `api.ts` for calls, `pages/` and `project/` for
  screens, view logic in `*View.ts` files with their tests beside them. All UI text goes through
  `i18n.ts`, which holds en, es, fr and pt catalogues (typed `Catalogue`, so a key missing in one
  language fails the typecheck). Wording is deliberately plain for non-technical users
  ("people", not "members"; "plot files", not "CSV assignments"; "project file", not "CEP").

## Tests

`test/helpers.ts` `makeContext(configOverrides, options)` builds a server on a fresh
`InMemoryStore`; tests drive it with `ctx.app.inject(...)` and close it in `afterEach`.
`createProject` and `batchRequest` are the usual helpers for setting up a project and syncing
records.
