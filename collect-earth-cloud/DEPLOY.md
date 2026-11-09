# Deploying Collect Earth Cloud

Technical reference. For a plain-language, step-by-step guide (with the
**Open in Cloud Shell** button), see [SELF-HOSTING.md](SELF-HOSTING.md).

The service is a single stateless container (Fastify + `tsx`, no build step for
the server; the Dockerfile builds the web dashboard in a first stage) that talks
to a PostgreSQL database. The supported path is **Google Cloud Run + Cloud SQL**
through `deploy/gcp/deploy.sh` (Option A); it also runs on any Docker host with a
managed Postgres (Option B).

> **Never run production on `STORE_BACKEND=memory`**: the in-memory store keeps
> nothing across a restart. It exists only for local dev and the test suite.

## Environment variables

| Var | Required | Example | Purpose |
| --- | --- | --- | --- |
| `STORE_BACKEND` | yes (prod) | `postgres` | `memory` = no persistence; use `postgres` in production |
| `DATABASE_URL` | when postgres | `postgres://ce_app:pw@host:5432/collect_earth_cloud` | Postgres connection string the server runs with. On Cloud Run with the Cloud SQL connector: `postgres://ce_app:pw@/collect_earth_cloud?host=/cloudsql/PROJECT:REGION:INSTANCE`. With `MIGRATION_DATABASE_URL` set, it names the app role (see "Row-Level Security and the database role") |
| `MIGRATION_DATABASE_URL` | advised with postgres | `postgres://ce:pw@host:5432/collect_earth_cloud` | The tables' owner, used only to apply the migrations (on boot or `npm run migrate`). When set, the migrations also create the role `DATABASE_URL` names if missing and grant it the tables, so Row-Level Security binds the server. Unset: one role does both, and RLS does not bind it |
| `SETUP_CODE` | advised | `K7QX-M3TB-WN` | Asked for once by the dashboard's first-run setup, which creates the platform admin. If unset, a random code is generated at boot and printed in the log (`Setup code: XXXX-XXXX-XX …`) while no platform admin exists. Set it when running more than one instance: each would otherwise generate its own. Case, spaces and hyphens are ignored when it is typed |
| `ADMIN_API_KEY` | optional | `<random 32+ chars>` | Lets scripts provision projects with `x-admin-key` (returns the Phase-0 project tokens). Dashboard users create projects with their session instead. Without it, anonymous provisioning works **only** with `STORE_BACKEND=memory`; on Postgres it is refused (401) |
| `PUBLIC_BASE_URL` | advised with a custom domain; **required with `SMTP_URL`** | `https://ce-cloud.example.org` | Base of the `/join/<token>` and `/reset/<token>` links and of every link in an email. If unset: `RENDER_EXTERNAL_URL`, else (screens only, never emails) the request's `x-forwarded-proto` + `Host` (correct on Cloud Run's own `*.run.app` address; see below) |
| `TRUST_FORWARDED_HOST` | no | `true` | Use `X-Forwarded-Host` instead of `Host` for links derived from a request. Only behind a proxy that sets it itself; a client can write it (see below). `true` or `1`; default off |
| `RENDER_EXTERNAL_URL` | no | `https://ce-cloud.onrender.com` | Honoured only as an environment fallback for the link base when `PUBLIC_BASE_URL` is unset (some hosts set it automatically) |
| `RATE_LIMIT_PER_MINUTE` | no | `60` | Requests per minute per client IP on login, register, signup, setup and reset (429 `rate_limited` above it). Kept generous because a training room joins from one office IP; failed logins are also limited to 10 per minute per account. `0` disables both. Per instance, in memory |
| `TELEMETRY` | no | `1` | Send error reports (Sentry) and usage events (Google Analytics), as the desktop app does. Off unless `1` or `true`, so a self-hosted server sends nothing by default. Nothing personal: Sentry gets no request body, header, query string, user nor link token; an event carries a hashed client id and kinds and counts only (`src/telemetry.ts`) |
| `SENTRY_DSN` | no | `https://key@o1.ingest.sentry.io/2` | With `TELEMETRY`: where the server and the dashboard send error reports. Default: the desktop app's Sentry project |
| `SENTRY_ENVIRONMENT` | no | `staging` | With `TELEMETRY`: the reports' environment (default `production`) |
| `GA_API_SECRET` | with GA | *(secret)* | With `TELEMETRY`: the Measurement Protocol API secret of the Google Analytics property. Without it no usage event is sent (it cannot be in this public repository) |
| `GA_MEASUREMENT_ID` | no | `G-XXXXXXX` | With `TELEMETRY` and `GA_API_SECRET`: the property. Default: the desktop app's (`G-8K943HZKJZ`) |
| `TRUST_PROXY_HOPS` | no | `1` | Proxies in front of the server that add to `x-forwarded-for` (see below) |
| `SESSION_IDLE_DAYS` | no | `90` | A sign-in (in Collect Earth or the dashboard) unused for this many days stops working; each use keeps it alive. A coordinator can also sign a person out everywhere (their page, *Sign out everywhere*), and anyone their other devices (*My account*) |
| `MIGRATE_ON_BOOT` | optional | `true` | Apply pending migrations on startup (see below); `true` or `1` |
| `PORT` | no | `8080` | Listen port (Cloud Run injects `8080`) |
| `HOST` | no | `0.0.0.0` | Bind address |
| `QUALITY_WORKER_MAX_MB` | no | `256` | Memory (MB, at least 64) the thread that works out the quality figures may use on Postgres. A project too big for it gets a plain error instead of the figures. Keep it below the container's memory (see "Quality figures and memory") |
| `NODE_HEAP_MB` | no | `224` | The server's heap in MB (the image passes it to Node as `--max-old-space-size`). 224 for 512 MiB, 448 for 1 GiB (see "Memory") |
| `PARSED_FILES_CACHE_MB`, `SERVED_FILES_CACHE_MB` | no | `96`, `32` | Memory (MB, at least 8) for parsed plot files and for the plot files built for people; 384 and 128 with 1 GiB (see "Memory") |
| `PROJECT_STATES_KEPT`, `MAP_BUILDS_KEPT` | no | `3`, `4` | Projects whose Progress state, and maps whose next pages, each instance keeps; 6 and 8 with 1 GiB (see "Memory") |
| `AI_VERTEX_API_KEY` | no | (secret) | Optional AI assistant: a Vertex AI API key, restricted to the Vertex AI API. Wins over `AI_VERTEX_PROJECT` when both are set. See "AI assistant (optional)" |
| `AI_VERTEX_PROJECT` | no | `my-project` | Optional AI assistant without a key: the Google Cloud project whose Vertex AI the server's service account calls |
| `AI_VERTEX_REGION` | no | `global` | Vertex AI location, used with `AI_VERTEX_PROJECT` (default `global`) |
| `AI_MODEL` | no | `gemini-3.8-flash` | The Gemini model id on Vertex AI (default `gemini-3.8-flash`) |
| `MAP_TILE_URL` | no | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | The base map of the dashboard's map of progress: a tile URL with `{z}`, `{x}` and `{y}` (https). Unset: OpenStreetMap's own tiles. See "The map's base map" |
| `MAP_TILE_ATTRIBUTION` | with `MAP_TILE_URL` | `© OpenStreetMap contributors` | The text the tile source asks to show on the map (plain text, at most 300 characters) |
| `MAP_TILE_ATTRIBUTION_URL` | no | `https://www.openstreetmap.org/copyright` | Where that text links to (https) |
| `MAP_TILE_MAX_ZOOM` | no | `19` | The tile source's deepest zoom (1-22) |
| `LINK_SECRET` | **required with `SMTP_URL`** (32+ characters) | `<random 32+ chars>` | Signs the Collect Earth backup's one-minute download links (without it: a key worked out from `DATABASE_URL`, the same on every instance; with the memory store, a random key per process) and the weekly emails' unsubscribe and confirmation links, which never use the `DATABASE_URL` key (a database password change would break links in mails already sent): the server does not start with `SMTP_URL` and no `LINK_SECRET` |
| `SMTP_URL` | no | `smtps://user:password@smtp.example.org:465` | The mail server for the weekly emails, the address confirmations, "Forgot your password?" reset links and the security notices (see "Weekly emails (optional)"). `smtps://` (TLS) or `smtp://…:587` (STARTTLS, required); plain `smtp://` only to `localhost`. Unset: no email is sent, the log gets a line per mail instead. A secret (it holds the password) |
| `MAIL_FROM` | with `SMTP_URL` | `Collect Earth Cloud <noreply@example.org>` | The address the emails come from; its domain must allow the mail server to send for it (SPF, DKIM) |
| `DIGEST_SECRET` | no | `<random 32+ chars>` | What the weekly job may send in `x-digest-secret` to `POST /v1/internal/digest`. A secret |
| `DIGEST_OIDC_AUDIENCE`, `DIGEST_OIDC_EMAIL` | no (together) | `https://ce-cloud.example.org/v1/internal/digest`, `ce-scheduler@<PROJECT>.iam.gserviceaccount.com` | The better way for the weekly job: Cloud Scheduler's OIDC token (`Authorization: Bearer`), accepted when Google signed it for this audience and this service account. With neither this nor `DIGEST_SECRET` the endpoint is off (404) |
| `AI_FAKE` | never in production | `1` | Development only: a scripted stand-in for the model, so the AI panel can be tried without Vertex. Refused unless `STORE_BACKEND=memory`, and refused on Cloud Run (`K_SERVICE`) or with `NODE_ENV=production` |

Generate a good admin key: `openssl rand -base64 32`.

The server trusts `x-forwarded-*` headers from `TRUST_PROXY_HOPS` proxies (default
1): it is meant to run behind Cloud Run or a reverse proxy, which set them. The
client IP used for rate limiting is the entry that many places from the right of
`x-forwarded-for`, so an address a client writes itself does not count. Behind two
proxies (e.g. a load balancer in front of Caddy) set it to `2`. Do not expose the
container port directly to the internet without one.

**The host in derived links (no `PUBLIC_BASE_URL`).** Join and reset links shown to
coordinators and administrators are built from the request when no base address is
set: its protocol (`x-forwarded-proto`, from the trusted proxies) and its **`Host`**.
`X-Forwarded-Host` is **not** used unless `TRUST_FORWARDED_HOST=true`: Cloud Run's front
end sets `X-Forwarded-For` and `X-Forwarded-Proto` but not `X-Forwarded-Host`, so one a
client writes itself reaches the server unchanged and could point a link elsewhere
(from Google's documented request headers; not checked against a live service). The
`Host` is what Cloud Run routed the request by (the `*.run.app` address or a mapped
domain), and Caddy passes it on as received, so the documented `*.run.app` default keeps
working. Set `TRUST_FORWARDED_HOST=true` only behind a proxy that sets that header
itself (overwriting what the client sent) and does not pass the original `Host`. The
weekly emails never use any of this: their links come from `PUBLIC_BASE_URL` (or
`RENDER_EXTERNAL_URL`) only, and a server with `SMTP_URL` does not start without it.

### First run

Open the server's URL in a browser. While no platform admin exists the dashboard
shows the setup page: enter the setup code (`SETUP_CODE`, or the one in the log)
and the admin's username and password. After that, setup answers 409. The
platform admin edits the server settings in the dashboard's **Server** page
(`signupOpen`, default off; `projectCreation`, default `platform-admins`;
per-account limits; server name, terms URL, contact email) and issues
password-reset links; it is not a member of any project.

## Database migrations

Schema lives in `migrations/*.sql`, each idempotent (`IF NOT EXISTS`). Apply them
**before the first request** using one of:

- **On boot:** set `MIGRATE_ON_BOOT=true`. The server applies pending migrations
  before it listens. This is what `deploy.sh` does. It is safe with several
  instances: `runMigrations` (`src/store/migrate.ts`) holds a Postgres
  session-level advisory lock (`pg_advisory_lock(4846419847)`) on one connection
  for the whole run, so instances booting at the same time migrate one after the
  other instead of racing on the same `CREATE` statements (which fails with
  `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`).
  A file already applied with the same sha256 is skipped (`schema_migrations.checksum`,
  migration 024; an edited file runs again), and each statement waits at most 3 s for a
  table's lock (`lock_timeout`): an `ALTER TABLE` queued behind a long query of the running
  server would otherwise hold up every other query on that table. A run that times out is
  rolled back and tried again, four runs in all, before the boot fails.
- **One-off release step:**
  ```bash
  STORE_BACKEND=postgres DATABASE_URL='postgres://…' npm run migrate
  ```

**Row-Level Security and the database role.** The project policies (RLS) bind only a
role that does not own the tables (nor is a member of their owner), is not a superuser
and has no `BYPASSRLS`. So the server should run as its own role, not as the owner:
- `MIGRATION_DATABASE_URL` is the owner (`ce`): it applies the migrations, and with it
  `runMigrations` prepares the app role that `DATABASE_URL` names (`ce_app` in
  `deploy.sh`; the user may also be given as `?user=...&password=...`):
  - it creates the role if missing (`LOGIN`, no other attribute; this needs
    `CREATEROLE`, which Cloud SQL's users have), or sets its password again if it
    exists, so the URL (the secret) is the source of truth. The owner must be allowed
    to change that role: on Postgres 16 and later, a role it created (or the server
    created) is; one a superuser made by hand is not, and the boot then fails saying so;
  - Postgres only ever gets a SCRAM-SHA-256 verifier of the password, computed by the
    server, never the password itself, so it is not in the Postgres log even when the
    statement fails. The password must be ASCII (`deploy.sh` makes 32 letters and
    digits);
  - it refuses, before changing anything, a role RLS would not bind or that could get
    out of it: a superuser, `BYPASSRLS`, `CREATEROLE`, a member (directly or not) of a
    superuser or `BYPASSRLS` role, the tables' owner or a member of it, or a role that
    may create objects in schema `public`;
  - it grants it `USAGE` on the schema, `SELECT, INSERT, UPDATE, DELETE` on every table
    and `USAGE, SELECT` on every sequence, and the same as default privileges for what
    the owner creates later. It runs after the migrations on every boot.
- **Postgres 14 and older** let every role create objects in schema `public`. The
  server then refuses to start, with the fix in the message: as the schema's owner
  (e.g. `postgres`), `REVOKE CREATE ON SCHEMA public FROM PUBLIC`, and, if the tables'
  owner then cannot create tables, `GRANT CREATE ON SCHEMA public TO ce`. The
  migrations do not do this themselves: the owner is often not the schema's owner
  (then the `REVOKE` does nothing), and when it is not, its own right to create tables
  may come from that same grant to everyone. Postgres 15 and later (and `deploy.sh`'s
  Cloud SQL instance) need nothing.
- `DATABASE_URL` is the app role: the server runs every query as it. Before it starts
  listening it checks the role with the same rules. With `MIGRATION_DATABASE_URL` set,
  a role RLS does not bind stops the start; with only `DATABASE_URL` the log warns.
  After the migrations the server drops `MIGRATION_DATABASE_URL` from its environment
  and its configuration, so nothing it runs later can read the owner's password.
- With only `DATABASE_URL` (one role, as before), everything works, but RLS does not
  bind the server: the membership checks of every route (README, "Tenancy &
  isolation") are then the only fence.
- `FORCE ROW LEVEL SECURITY` is not used: it would bind the owner too, so a hand fix
  with `psql` as the owner would silently see no rows, and it adds nothing once the
  server is not the owner (the owner can always turn it off again).
- `deploy.sh` does this since the RLS update: the secret `ce-app-database-url` holds
  the app role's URL (`DATABASE_URL`) and `ce-database-url` the owner's
  (`MIGRATION_DATABASE_URL`). Re-running it on an older deployment adds the secret and
  switches the service; the role is created when the new version starts.
- **Going back.** Sending traffic back to an older *revision* (Cloud Run's
  "Manage traffic", or `gcloud run services update-traffic --to-revisions`) is fine:
  each revision keeps the configuration it was deployed with. Deploying an older
  *image* onto the current configuration is not: older versions migrate with
  `DATABASE_URL`, which is now the app role, so first point `DATABASE_URL` back at
  `ce-database-url` (and remove `MIGRATION_DATABASE_URL`). Going back to a version
  from before the re-assessment round (migrations 007 to 011) keeps every record and
  file: the new columns and tables are only added to, and the older server ignores
  them. But its dashboard has no Quality tab, its export has no `plot`, `round`,
  `assessment` and `final` columns, and it serves the project file and plot files as
  they are stored, so records keep arriving with keys like "17,1" and "17,2" that it
  does not tell apart. Its own migrations also put back the older project policies
  (without the `NULLIF` of the empty setting); the next boot of a newer version
  replaces them again.
  Going back to a version from before the dashboard improvements (migrations 012 to
  024) also keeps every record and file: those migrations only add tables, columns and
  indexes, which the older server ignores. What it does not have is lost from view, not
  deleted: the activity log, Progress, People, the map, plot search, the review queue,
  check sampling, reference plots, progress links, the weekly emails and the server
  owner's panel. While it runs, its uploads write no activity event (those plots count
  again from their next save), no check is drawn by itself, and progress links answer
  "not found". Plots sent back or drawn for a check stay in the database but reach no
  one, and a disabled account can log in again (the older server does not read
  `users.disabled_at`). The next boot of a newer version picks all of it up again; its
  migrations skip the files whose checksum is unchanged.
- By hand (Option B), as the owner:
  `CREATE ROLE ce_app LOGIN PASSWORD '...'`, then start the server with both URLs and
  `MIGRATE_ON_BOOT=true` (or run `npm run migrate` with both set).

---

## Option A: Google Cloud (script)

`deploy/gcp/deploy.sh` creates everything in one Google Cloud project, and on
every later run updates the server to the code in the checkout. It is meant to be
run from Google Cloud Shell, from the `collect-earth-cloud` folder (the
**Open in Cloud Shell** button in SELF-HOSTING.md opens exactly that, with the
tutorial `deploy/gcp/tutorial.md`):

```bash
bash deploy/gcp/deploy.sh                    # install or update
bash deploy/gcp/deploy.sh --show-setup-code  # print the setup code and URL
bash deploy/gcp/deploy.sh --dry-run          # print every gcloud command, change nothing
bash deploy/gcp/deploy.sh --help             # all options
```

Options: `--project ID`, `--region REGION` (default `europe-west1`),
`--domain NAME` (Cloud Run domain mapping + `PUBLIC_BASE_URL`),
`--db-tier TIER` (only when the instance is created; default `db-f1-micro`),
`--yes` (no prompts), `--no-pull` (do not `git pull --ff-only` before building).
Environment: `REQUEST_TIMEOUT=SECONDS` (Cloud Run's request timeout; default 900, up to 3600)
and `MEMORY=SIZE` (each instance's memory; default `512Mi`, `1Gi` above about 30,000 records, see
"Memory"). Unset, an update keeps the timeout and memory the server has (raised with
`gcloud run services update`, say); a new server gets the defaults.

It asks only for the region, and only once: answers are kept in
`~/.collect-earth-cloud/deploy-<PROJECT>.conf` (`REGION`, `DOMAIN`, `DB_TIER`);
if that file is lost, the region is read back from the existing Cloud SQL
instance. Every step checks first whether its resource exists, so a re-run never
recreates or wipes anything. A failure stops the script with a plain-language
explanation; re-running continues.

### What it creates

| Resource | Name | Settings |
| --- | --- | --- |
| APIs | | `cloudbilling`, `run`, `sqladmin`, `secretmanager`, `artifactregistry`, `cloudbuild`, `iam`, `cloudresourcemanager` |
| Cloud SQL instance | `ce-cloud-db` | `POSTGRES_16`, edition `enterprise`, tier `db-f1-micro` (shared core, 0.6 GB), zonal, 10 GB SSD with auto-increase, daily backups at 02:00 UTC keeping 7, point-in-time recovery with 7 days of logs, deletion protection, `max_connections=50`. Created only if missing (10 to 15 minutes); an existing instance is never modified |
| Database | `collect_earth_cloud` | in `ce-cloud-db` |
| Database user | `ce` | 32-character alphanumeric password, generated only when the secret `ce-database-url` does not exist yet (then created, or its password reset) |
| Secret | `ce-database-url` | `postgres://ce:<password>@/collect_earth_cloud?host=/cloudsql/<PROJECT>:<REGION>:ce-cloud-db`, the owner, given to the server as `MIGRATION_DATABASE_URL`. Created only if missing |
| Database role | `ce_app` | the role the server runs as, bound by RLS. Created by the server itself (as `ce`, when it migrates on start), not with `gcloud sql users create`, which would make it a member of `cloudsqlsuperuser` |
| Secret | `ce-app-database-url` | `postgres://ce_app:<password>@/collect_earth_cloud?host=/cloudsql/...`, a new 32-character password, given to the server as `DATABASE_URL`. Created only if missing (also on an older deployment, on its next update) |
| Secret | `ce-setup-code` | `XXXX-XXXX-XX` from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, the same shape as `generateSetupCode()` in `src/accountRules.ts`. Created only if missing |
| Service account | `ce-cloud-run@<PROJECT>.iam.gserviceaccount.com` | `roles/cloudsql.client` on the project; `roles/secretmanager.secretAccessor` on the three secrets only |
| IAM for builds | the project's default Cloud Build service account (`gcloud builds get-default-service-account`) | `roles/cloudbuild.builds.builder` (projects created since 2024 give the default compute account no roles) |
| Artifact Registry | `ce` (docker, in the region) | cleanup policy `deploy/gcp/cleanup-policy.json`: keep the 5 newest images, delete others older than 30 days |
| Image | `<REGION>-docker.pkg.dev/<PROJECT>/ce/collect-earth-cloud:<git-sha>-<timestamp>` | built by Cloud Build from `collect-earth-cloud/` (the Dockerfile context), uploading what `deploy/gcp/build.gcloudignore` does not exclude |
| Cloud Run service | `collect-earth-cloud` | the dedicated service account, Cloud SQL connector to `ce-cloud-db`, secrets `DATABASE_URL=ce-app-database-url:latest`, `MIGRATION_DATABASE_URL=ce-database-url:latest` and `SETUP_CODE=ce-setup-code:latest`, env `STORE_BACKEND=postgres`, `MIGRATE_ON_BOOT=true` (+ `PUBLIC_BASE_URL` with `--domain`), public (`--allow-unauthenticated`), port 8080, 1 vCPU, 512 MiB (`MEMORY`, see "Memory"), 0 to 4 instances, concurrency 80, timeout 900 s (`REQUEST_TIMEOUT`, see "The Collect Earth backup and its limits"); an update keeps the memory and timeout the service has unless those are set; startup CPU boost |
| Domain mapping (with `--domain`) | the domain | `gcloud beta run domain-mappings create`; the script prints the DNS records to add |

Env vars and secrets are applied with `--update-env-vars` / `--update-secrets`,
so variables added by hand to the service (e.g. `ADMIN_API_KEY`,
`RATE_LIMIT_PER_MINUTE`) survive a re-run.

**Connections:** each server instance's pool opens up to 10 connections
(`pg` default), plus one during boot migrations. `db-f1-micro` allows 25 by
default, too few for 4 instances, hence `max_connections=50` (4 × 10 + 1 fits).
If you raise `--max-instances`, raise `max_connections` (or the tier) with it.

**Cost** (list prices, they change; see
[Cloud SQL pricing](https://cloud.google.com/sql/pricing) and
[Cloud Run pricing](https://cloud.google.com/run/pricing)): `db-f1-micro`
around US$8 to 10/month depending on the region, plus about US$2 to 3 for the
10 GB SSD, backups and transaction logs. Cloud Run with `min-instances=0` stays
inside the monthly free tier for typical use. Artifact Registry, Cloud Build and
Secret Manager are cents. Total **about US$10 to 15/month**; with
`db-g1-small` about US$30 to 40.

**Public access:** if an organisation policy (Domain restricted sharing) blocks
the `allUsers` invoker binding, `--allow-unauthenticated` only warns. The script
then tries `gcloud run services update --no-invoker-iam-check`; if the policy
`run.managed.requireInvokerIam` forbids that too, an organisation admin has to
exempt the project.

**Build permissions:** if `gcloud builds submit` fails with a permission error on
a service account, give that account `roles/cloudbuild.builds.builder`
(`gcloud projects add-iam-policy-binding <PROJECT> --member=serviceAccount:<SA> --role=roles/cloudbuild.builds.builder`),
or ask the organisation admin, then re-run.

**Your own address:** `--domain` uses Cloud Run domain mappings, available only
in some regions (`asia-east1`, `asia-northeast1`, `asia-southeast1`,
`europe-north1`, `europe-west1`, `europe-west4`, `us-central1`, `us-east1`,
`us-east4`, `us-west1`) and requiring the domain to be verified once
(`gcloud domains verify example.org`). Elsewhere, put a global external
Application Load Balancer with a serverless NEG in front of the service, or any
reverse proxy, and set `PUBLIC_BASE_URL` by hand
(`gcloud run services update collect-earth-cloud --region R --update-env-vars PUBLIC_BASE_URL=https://…`).

**Request size:** Cloud Run limits HTTP/1 request bodies to 32 MiB, which caps
CEP and plot file uploads.

**Removing it:** delete the project (`gcloud projects delete <PROJECT>`), or, to
keep the project, delete the service, the repository, the secrets, the service
account, and the instance (after `gcloud sql instances patch ce-cloud-db --no-deletion-protection`).
A deleted Cloud SQL instance name cannot be reused for about a week.

---

## Option B: any Docker host + managed Postgres

The app is cloud-agnostic. Point it at any reachable Postgres and put TLS in
front (a load balancer, or nginx/Caddy: the app itself speaks plain HTTP on
`PORT`).

```bash
cd collect-earth-cloud
docker build -t collect-earth-cloud .
docker run -d --name ce-cloud -p 8080:8080 \
  -e STORE_BACKEND=postgres \
  -e MIGRATION_DATABASE_URL='postgres://ce:<pw>@db-host:5432/collect_earth_cloud' \
  -e DATABASE_URL='postgres://ce_app:<app pw>@db-host:5432/collect_earth_cloud' \
  -e SETUP_CODE='<setup code>' \
  -e PUBLIC_BASE_URL='https://ce-cloud.example.org' \
  -e MIGRATE_ON_BOOT=true \
  collect-earth-cloud
```

The bundled `docker-compose.yml` is a **dev-only** Postgres for local runs, not a
production topology: use a managed, backed-up Postgres in production.

---

## Post-deploy checks & onboarding

```bash
BASE=https://ce-cloud.example.org

# 1. Liveness
curl -fsS "$BASE/health"

# 2. Server state (needsSetup is true until the first-run setup is done)
curl -fsS "$BASE/v1/server-info"
```

Projects are created from the dashboard (logged in). Scripts can still use the
admin key; on Postgres they need `ADMIN_API_KEY` set (before the dashboard, a
server without a key let anyone create projects):

```bash
curl -fsS -X POST "$BASE/v1/projects" \
  -H "x-admin-key: <ADMIN_API_KEY>" -H 'content-type: application/json' \
  -d '{"name":"My project"}'
# → {"projectId":"…","adminToken":"…","projectToken":"…"}
```

Collectors join with an invite link made in the dashboard (project → *People*):
`<base>/join/<inviteToken>`. In Collect Earth they use File → *Join cloud
project…*, register or log in, and the CEP downloads and the app switches to
cloud mode. This is why the link base (`PUBLIC_BASE_URL` or the request host)
must be the address people really use.

### Checking error reports and usage events

With `TELEMETRY=1` (and `GA_API_SECRET`), run on the deployment, with its environment:

```bash
npm run telemetry:check
```

It sends one test error to Sentry, in the environment `telemetry-check` (resolve it there), and asks Google
Analytics' validation endpoint whether a usage event is well formed (the validation records nothing). It prints what
worked and exits non-zero otherwise. The server needs outbound HTTPS to the Sentry host of the DSN and to
`www.google-analytics.com`.

## Operational notes

- **Scaling:** the service is stateless; all state is in Postgres. Scale Cloud
  Run instances freely within the database's `max_connections` (see above).
  Boot migrations are serialised by the advisory lock.
- **Backups:** keep automated backups and PITR on the Postgres instance (the
  script turns both on): record data and tombstones live only there. See
  "Backups: the restore drill and monthly copies" below.
- **Logs:** `gcloud run services logs read collect-earth-cloud --region <REGION> --limit 50`.
- **Links in the logs (progress links, invitations, password resets, backup downloads):** these
  links carry their secret token in the address. The server's own log lines write the address
  with that part replaced by `<redacted>`, but the platform's request log does not: Cloud Run
  records every request's full address (`httpRequest.requestUrl`), as does any proxy or load
  balancer in front of the server. **Whoever can read those logs can open every progress link
  (until it is revoked) and any invitation or reset link still valid.** Give log access only to
  people who may see the projects, or lower the retention or exclude `httpRequest.requestUrl` for
  `/p/`, `/v1/public/progress/`, `/join/`, `/v1/join/`, `/reset/` and `/v1/collect-backup/` with a
  log exclusion filter. Revoking a progress link on the project's Settings tab ends it at once.
- **Progress links' quality figure** (Decision 9): stored in `projects.public_quality` whenever the
  quality figures are worked out (a coordinator or reviewer opens the Quality tab, the review queue…),
  so every instance shows the same figure, also after a restart; a link never makes the server
  compute. Until the figures were worked out once, the page says the figure appears once the
  coordinators or reviewers have looked at the quality checks.
- **The server owner's panel** (the Server page, "How the server is doing"): totals only.
  Projects appear by id with their size, never by name (a platform admin is not a member of
  any project). The figures are kept a minute per instance (the card says their time) and
  the page is behind the rate limiter. Failed logins and requests refused by the rate limiter are counted in
  memory by each instance since it started, so they start again from zero on a restart and
  each Cloud Run instance shows its own. The same goes for its "late automatic draws": the
  automatic check draws that were worked out after their request had answered, so stored
  nothing then and were tried again later (the third late one in a row is stored after its
  request), with the time of the last one. A count that keeps growing means a project's
  draws are slow on this server; coordinators can still use "Draw now" on the Quality tab,
  which always finishes. "Migrations applied" comes from
  `schema_migrations` (migration 018), filled by every migration run from then on.
- **Disabling an account** (Server page, Accounts): the account cannot log in, its
  sessions (Collect Earth's included) and reset links are deleted, and its name stays
  taken; enabling it lets it log in again. A server administrator cannot disable their own
  account, and the last enabled one cannot be disabled. Each disable and enable is written
  to the server log (`account.disabled` / `account.enabled` with both account ids); the
  account list shows who disabled it and when. A disabled collector's Collect Earth gets
  401 on its next sync and keeps the unsent plots in its queue, retrying with its usual
  back-off (up to once an hour); once the account is enabled, the collector logs in again
  from Collect Earth's cloud settings and the plots go. Its login dialog shows the
  server's sentence ("This account has been disabled by the administrator of this
  server..."). In the projects, the member list marks the person "Disabled by the server
  administrator" and the People tab says "Account disabled" instead of "quiet". A project
  whose only coordinator is disabled cannot be managed until the account is enabled again.
  **No enabled administrator left** (the server refuses to disable or delete the last one,
  but a database edit could): enable one again as the tables' owner, e.g.
  `psql "$MIGRATION_DATABASE_URL" -c "UPDATE users SET disabled_at = NULL, disabled_by = NULL WHERE username = 'owner'"`
  (the account then logs in as before).
- **Passwords:** hashed with scrypt (`node:crypto`, no native deps). For a
  hardened deployment swap `src/password.ts` for argon2id; only that module
  changes (the stored-hash string shape is private to it).
- **Rotation:** project/admin tokens are revocable only by rotation today
  (re-provision or issue per-user tokens); treat the admin key as a secret.
  To rotate the database password: set a new one with
  `gcloud sql users set-password ce --instance=ce-cloud-db`, add it as a new
  version of `ce-database-url`, and redeploy (re-run the script).

---

## Upgrading from master

The new migrations (012 to 024) run at boot as usual. Seven things to know about the
data a server from master already holds:

- **Migration 013 builds an index on `record_events (project_id, received_at)`** (for
  the Progress tab's "old unsent work" and the server owner's panel), right after 012
  has filled that table (below), while the migration lock is held: a fraction of a
  second per 100,000 events, during which uploads wait. Migration 018 names the same
  index with `IF NOT EXISTS`, so on an upgrade it does nothing.

- **The other migrations need nothing.** 014 to 017 and 019 to 022 add columns with no
  value (no rewrite of the table), new empty tables, and an index on a column that is
  still empty everywhere (016); 015 widens the audit log's list of actions (a quick check
  of its rows); 023 adds the email settings and their tables; 024 adds a checksum column
  to `schema_migrations`. The first boot with 024 runs every file once more (they are
  all idempotent) and records their checksums; later boots skip the files unchanged.

- **Email addresses saved before migration 023 are not confirmed.** 023 adds
  `users.email_confirmed_at`, empty for every account, so an address given earlier is
  shown on "My account" as not confirmed and gets no weekly email until its owner
  presses "Send the link again" and opens the link (see "Weekly emails
  (optional)"). Nothing is sent by itself.

- **The first boot fills the activity log once (migration 012).** Every record the
  server holds gets one event in `record_events` (submitted, created or deleted, at
  its modification time), in one `INSERT ... SELECT` over `records` while the
  migration lock is held. It reads every record's summary (not the XML): about a
  second per 100,000 records on PostgreSQL 16 in Docker on a laptop (allow several
  on a small Cloud SQL instance), so that first boot is slower to answer, and the
  table grows by one row per record (plus its answers for submitted ones). Later boots skip it (the table is no longer empty). Uploads from
  an instance still running the old version while the new one starts (a rolling
  deploy) get no event: their plots count again from their next save.

- **Records synced before the summary fix have empty answers on the server.**
  Until commit 13a388db, a record that had any empty attribute (in practice every
  record Collect Earth sends) was stored with an empty summary: its XML is complete,
  but the Quality tab, the answer columns of the data download and the AI
  assistant see none of its answers. A record gets them back when Collect Earth
  sends it again, which it does only when the record is saved again. To make one
  collector's Collect Earth send all of its records at once:
  1. Close Collect Earth.
  2. In the collector's local database (`collectEarthDatabase.db` in the Collect
     Earth folder, or the PostgreSQL database set in its settings), delete the
     reconciliation watermark of the sync queue:

     ```sql
     DELETE FROM ce_cloud_sync_queue WHERE record_key = '__reconciliation_watermark__';
     ```

     (add `AND survey_uri = '<the survey's URI>'` to do it for one survey only).
  3. Start Collect Earth and leave it open. Its reconciliation runs 10 minutes
     after start: with no watermark it puts every record of the survey in the sync
     queue, and the sync sends them.

  The server accepts the records sent again: it keeps the newest copy of a record
  and takes one with the same modification time as an update, so the answers are
  filled in and nothing else changes.
- **Records under Collect Earth's operator name move to the username.** Records a
  signed-in collector synced before records went by the username were stored under
  the operator name set in Collect Earth (for example "Juan Perez" for the account
  `juan`). When such a record is sent again (saved again, or resent as above), the
  server moves it to the username, so it is not counted twice. A row whose name is
  another member's username is never moved. Records sent with a project token keep
  their operator.
- **Round is worked out by itself.** Projects created on master have no stored
  round information. The first time it is needed (the Project file page, the data
  download, the Quality tab, dividing plots), the server reads it from the project
  file it already serves and keeps it: "own" when the survey has a `round` key
  (for example the demo survey, keys `id` and `round`), otherwise "none". It never
  adds `round` to a file collectors already have. When the survey has its own
  round, the plot files are counted again with their round column. Nothing needs
  to be done.

## What "round" means for coordinators

- Every record now has a **plot** and a **round**: round 1 is the main assessment
  of a plot, round 2 a quality check, where another collector assesses the same
  plot again without seeing the first answers.
- When the survey's only key is the plot `id` and no data has been collected yet,
  the server adds a hidden key called `round` to the project file it hands out.
  Collectors get that version when they join (people who joined before the upload
  must join again). The Project file page says so, and the file you uploaded can
  still be downloaded from there.
- In a divided plot file, the plots a person gets as quality-check copies come with
  round 2, the others with round 1. Collect Earth saves them as separate records
  ("17,1" and "17,2"), so a check never overwrites the first assessment. Collectors
  do not see the round.
- A survey that already has `round` keeps it: pick on the Project file page which
  code marks a re-assessment, or "None" when round means something else (a year).
  Where the server could not add it (the page says why), round 1 or 2 is worked out
  from who held the plot as a quality-check copy.
- The Quality tab compares first assessments with checks. The data download has the
  columns `plot`, `round`, `assessment` (`main`, `check` or `other`) and `final`
  (`yes` for the answer you chose for a plot, `no` for the other, `recheck`).

## The map's base map

The dashboard's Map tab (coordinators and reviewers) draws every plot on OpenStreetMap's
tiles (`tile.openstreetmap.org`) by default: no key and no billing. The browser fetches the
tiles itself, sending the dashboard's address as its referrer, and the map shows
"© OpenStreetMap contributors" linked to the copyright page, as the
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks. The map
fetches only the tiles in view (no tiles ahead of time, no bulk download).

OpenStreetMap's tile servers are run by volunteers and donations for light use. **A server
used heavily** (many coordinators looking at maps every day, or a public deployment for many
projects) **should use another tile source**: a commercial provider (most have a free tier
with a key), or your own tile server. Set:

```
MAP_TILE_URL=https://tiles.example.org/styles/basic/{z}/{x}/{y}.png?key=YOUR_KEY
MAP_TILE_ATTRIBUTION=© Example Maps, © OpenStreetMap contributors
MAP_TILE_ATTRIBUTION_URL=https://example.org/attribution
MAP_TILE_MAX_ZOOM=18
```

The URL and the attribution are sent to every dashboard (`GET /v1/server-info`,
`mapTiles`), so a key in the URL is public: use one restricted to your dashboard's address,
as tile providers offer. A wrong value stops the server at boot with the reason.

**What the tile source learns.** The tiles a browser asks for are those around the plots on the
map, at the zoom looked at, so the tile source (and anyone who can read its logs) can tell
roughly where a project's plots are, with the dashboard's address as the referrer and the
viewer's IP address. Nothing else (no plot ids, names or answers) is sent. When the plots'
places are sensitive, use a tile source you trust with that, or your own tile server.

## AI assistant (optional)

An optional assistant on the Quality tab reviews a project's quality figures with
Gemini on Google's Vertex AI and suggests guidance notes and plots to check again.
It is off unless the server owner sets it up; without the settings below, the
dashboard says it is not set up and nothing is ever sent to Google.

**Setting it up** (Option A's names; replace `<PROJECT>` and `<REGION>`):
1. **Enable the Vertex AI API.** Gemini is billed per use (tokens), on the project's
   billing account:
   `gcloud services enable aiplatform.googleapis.com --project=<PROJECT>`.
2. **Choose how the server logs in to Vertex AI**, one of:
   - **An API key, restricted to the Vertex AI API.** Create it in the console
     (*APIs & Services* → *Credentials* → *Create credentials* → *API key*, then
     *API restrictions* → *Vertex AI API*), or
     `gcloud services api-keys create --display-name="Collect Earth Cloud AI" --api-target=service=aiplatform.googleapis.com --project=<PROJECT>`.
     Keep it in Secret Manager and give it to the service as `AI_VERTEX_API_KEY`:
     ```bash
     printf '%s' '<the key>' | gcloud secrets create ce-ai-vertex-key \
       --replication-policy=automatic --data-file=- --project=<PROJECT>
     gcloud secrets add-iam-policy-binding ce-ai-vertex-key --project=<PROJECT> \
       --member=serviceAccount:ce-cloud-run@<PROJECT>.iam.gserviceaccount.com \
       --role=roles/secretmanager.secretAccessor --condition=None
     gcloud run services update collect-earth-cloud --region=<REGION> --project=<PROJECT> \
       --update-secrets=AI_VERTEX_API_KEY=ce-ai-vertex-key:latest
     ```
   - **Or the service account, without a key.** Give the Cloud Run service account
     the "Vertex AI User" role and tell the server the project and location:
     ```bash
     gcloud projects add-iam-policy-binding <PROJECT> --condition=None \
       --member=serviceAccount:ce-cloud-run@<PROJECT>.iam.gserviceaccount.com \
       --role=roles/aiplatform.user
     gcloud run services update collect-earth-cloud --region=<REGION> --project=<PROJECT> \
       --update-env-vars=AI_VERTEX_PROJECT=<PROJECT>,AI_VERTEX_REGION=global
     ```
   When both are set, the key is used.
3. **`AI_MODEL`** is optional: the default is `gemini-3.8-flash` (Gemini 3.8 Flash,
   available in Vertex AI's `global`, `us` and `eu` locations).
4. **Set a billing budget alert** (*Billing* → *Budgets & alerts*), e.g. a few
   dollars a month with alerts at 50 % and 90 %, so an unexpected bill is seen
   early. The server's own limits (below) cap use per project, but only Google's
   bill shows what was spent.
5. **Switch it on:** the platform admin turns on "Allow the AI assistant on this
   server" in the dashboard's Server settings, then each coordinator who wants it
   turns it on in their project's Settings tab. Both are off by default.
6. **`GOOGLE_VERTEX_BASE_URL` and `GOOGLE_GEMINI_BASE_URL` must not be set** in the
   server's environment. The Google SDK sends its requests, with the key, to the
   address they name.

`deploy.sh` keeps these variables and secrets when it is run again (it uses
`--update-env-vars` / `--update-secrets`), and it creates none of them: nothing
billable for the AI is switched on by the script.

**What is sent to Google:** answers to choice and number questions, the survey's
questions, answer options and help texts, the quality figures and the
coordinator's guidance notes. People's names are replaced by "Person A",
"Person B", and plot ids by "Plot 1", "Plot 2"; the dashboard puts the real ones
back. Coordinates, comments, other text answers, record keys and plot ids are never
sent. The assistant only reads; it changes nothing.

The analysis page's "Ask AI for more views" sends less: the survey's **structure**
only (its questions, code lists and labels, and which questions are years or dates),
never a plot, an answer, a figure or a person.

**Where it is processed.** Vertex AI processes what is sent in the location the
server asks for, and the project's Settings tab shows it to the coordinator:
- with `AI_VERTEX_API_KEY`, the location is always `global`: Google may process a
  request in any of its regions;
- with `AI_VERTEX_PROJECT`, `AI_VERTEX_REGION` chooses it. `global` is the default;
  `eu` or `us` keep the processing in those areas (the default model is available in
  `global`, `us` and `eu`).

Where a project's data must stay in a region (a country's rules, the data owner's
agreement), set the server up with the service account (not a key) and
`AI_VERTEX_REGION` to that area, or leave the assistant off.

**Before allowing it on a server**, read Google's terms for Vertex AI and its
[data governance page](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
(how prompts and answers are kept and whether they are used, on the terms of the
Google Cloud account the server uses), and note in each project's agreement that the
assistant may be used. Coordinators confirm, when they switch it on in a project's
Settings tab, that sending these data fits their project's agreements; the
project's activity log keeps who switched it on and when.

**Limits** (Server settings; each **per project**, so the server's total can be
the limit times the number of projects):
- AI reviews per project per day (default 5) and follow-ups and questions per
  project per day (default 30), by UTC day. Failed runs do not count; refused
  questions do;
- AI tokens per project per month (default 2,000,000), counting every run, failed
  ones too, since their tokens were billed. The last run of a month can go past it
  by that one run;
- one run at a time per project, at most 20 tool calls and 200,000 input tokens per
  run, and 9 minutes per run.

`0` allows none. The Server settings page also shows this month's use per project
(project ids, runs, refusals and tokens; never names or content).

## Backups: the restore drill and monthly copies

**What there is.** `deploy.sh` gives the database a backup every night, kept 7 days, and point-in-time recovery for
the last 7 days (any minute can be restored), and protects it against deletion. Collect Earth's records live only
there, so these are the project's only copies apart from what coordinators download.

**The restore drill: do it once before going live, then once a year.** A backup never restored is a hope. The drill
restores into a *new* database server, so the real one is never touched:
1. Note the figures to compare: in the dashboard, each project's records (Data tab) and plots. Or in
   *Cloud SQL* → `ce-cloud-db` → *Cloud SQL Studio*: `SELECT count(*) FROM records;` and `SELECT count(*) FROM
   projects;`.
2. Restore yesterday into a copy (a few minutes; a second server is billed while it exists):
   ```bash
   gcloud sql instances clone ce-cloud-db ce-cloud-db-drill --project=<PROJECT> \
     --point-in-time="$(date -u -d 'yesterday 12:00' +%Y-%m-%dT%H:%M:%SZ)"
   ```
3. In *Cloud SQL Studio* on `ce-cloud-db-drill`, run the same counts: they should match, less what arrived since.
4. Delete the copy (a clone may keep the deletion protection; turn it off first):
   ```bash
   gcloud sql instances patch ce-cloud-db-drill --no-deletion-protection --project=<PROJECT>
   gcloud sql instances delete ce-cloud-db-drill --project=<PROJECT>
   ```
5. Write it down: the date, who did it, the minutes it took and whether the counts matched. Keep that note with the
   project's documents; it is what tells an auditor (or you, in a hurry) that restoring works.

**Restoring for real** after a mistake: the same clone, at a minute just before the mistake, then point the server at
it. Ask whoever manages the Google Cloud project, as it changes the server's database address; and first download
what you need from each project's Data tab, as the restore replaces everything since that minute.

**Monthly copies, kept a year.** Seven days is short when a mistake is noticed a month later.
`deploy/gcp/monthly-backups.sh --project <PROJECT> --schedule` (in Cloud Shell) creates a private Cloud Storage
bucket `<PROJECT>-ce-backups`, makes a first copy, and asks Cloud Scheduler for one on the 1st of every month; each
copy is kept 12 months (`--keep-months`). A copy is restored into a new server with
`gcloud sql import sql <NEW-INSTANCE> gs://<PROJECT>-ce-backups/ce-cloud-db-monthly.sql.gz --database=collect_earth_cloud`
(choose the month with `gcloud storage ls --all-versions`). The script was written without access to Google Cloud:
check its first run in the console, and include one monthly copy in the yearly drill.

**Where the copies are:** in the same project and region as the database. A copy outside Google Cloud (a
coordinator's Collect Earth backup from the Data tab, kept by the institution) protects against losing the Google
Cloud account itself.

## Alerts for the server's owner

The server watches for signs that someone should look at it (`src/ownerAlerts.ts`):

| Alert | Raised when | What to do |
| --- | --- | --- |
| Failed logins | 50 in an hour | Someone may be guessing passwords: look at the server panel; consider requiring two-step sign-in of coordinators (Server settings) |
| Server errors | 20 answers of 500 or more in an hour | Something is broken: look at the server's log |
| Records refused | 50 records from Collect Earth refused in an hour | Interpreters' work may not be arriving: look at the log |
| Storage | A project uses 90 % of the storage limit (checked hourly; only with a limit set) | Raise the limit, or ask the project's coordinators to tidy up |

Each alert is:
- **a log line** with `jsonPayload.ownerAlert` set to its kind (`failed_logins`, `server_errors`, `sync_errors`,
  `storage`);
- **listed on the server panel** ("Alerts"), since that instance started;
- **mailed to every server administrator whose email address is confirmed** (their account page), in their
  language, when the server sends mail (`SMTP_URL`, "Weekly emails" below).

The same alert is raised at most once every six hours (a project's storage once a day). Each Cloud Run instance
counts its own, and a restart starts from zero, as the panel's counters do; the log-based alert below sees them all.

**Two checks only Google Cloud can do** (in the console; a few minutes each):
1. **The server is down.** *Monitoring* → *Uptime checks* → *Create uptime check*: protocol HTTPS, the server's host,
   path `/health`, every 5 minutes; then create its alert policy with an email notification channel. Nothing inside
   the server can tell you it is down.
2. **Alerts from every instance.** *Logging* → *Logs Explorer*, query
   `resource.type="cloud_run_revision" AND jsonPayload.ownerAlert:*`, then *Actions* → *Create log alert*, with the
   same notification channel. This works without `SMTP_URL`.

A billing budget alert (*AI assistant*, step 4) is the third one worth having.

## Weekly emails (optional)

People can ask for a weekly email on their account page (**off by default**):
coordinators the weekly summary of the projects they coordinate (plots done that week
and in all, who has been quiet with plots left to do, the plots waiting for a
decision, a link to the weekly page), collectors their own week (My work's numbers
and the plots sent back to them; never anyone else's name, never which plots are
checks, never an answer). Each mail is in the language the person chose, with their
time zone's days, as plain text and simple HTML, and carries a one-click unsubscribe
link (`List-Unsubscribe` and `List-Unsubscribe-Post`, RFC 8058) that works without
logging in.

**The address is confirmed first.** A person gives their account an email on the
account page (or at sign-up); the server sends a link to it (valid 3 days) and sends no
other email to it until that link is opened. The address must be one address (no
spaces, commas or semicolons; at most 254 characters), checked at sign-up, on the
account page and again before every mail; an address stored before this rule that is
not one is never written to, and the account page asks to type it again. The
confirmation mail names no account (the address may be someone else's). **At most 3
confirmation mails an hour and 6 a day per account** (stored, so changing the address
does not start them again), and at most 100 an hour per instance whoever asks.
Changing the address needs a new confirmation; removing it turns the emails off.

**The other mails: password reset links and security notices.** With mail set up, the
server also sends, always and only to a **confirmed** address (none of them can be turned
off; they carry no unsubscribe link, no tracking and no link but the reset link or the
dashboard's address, `PUBLIC_BASE_URL`):
- **"Forgot your password?"** on the log-in page (`POST /v1/auth/forgot`, a username or an
  email address) mails a password reset link to the account's confirmed address, in the
  page's language. It is the same kind of link the administrator makes (Server settings →
  accounts), single use, but works **one hour** (an administrator's: 7 days); using it ends
  every session of the account, Collect Earth's included. The answer is always the same
  ("If this account has a confirmed email address, a link is on its way") and is given
  before anything is looked up, so it never tells whether an account exists. Nothing is
  sent for an unknown, disabled or unconfirmed account. Limits, all quiet (same answer):
  **3 reset mails an hour per account**, 10 requests an hour per client IP, 100 reset mails
  an hour per instance. Where the server sends no email, the log-in page keeps saying to
  ask the server's administrator for a link (`selfServiceReset: false` in `/v1/server-info`).
- **"Your password was changed"**, after a change on the account page or with any reset
  link (the administrator's or a mailed one), with the date in the account's time zone and
  what to do if it was not them: "Forgot your password?", and the server's contact address
  (Server settings) when set. A change on the account page also ends every **other** session
  of the account: Collect Earth signs in again with the new password.
- **"The email address of your account was changed / removed"**, to the **old** address
  when it was confirmed; the new one is shown only in part (`m…@e….org`).

They are sent after the answer: a mail that fails is logged (`account mail: could not be
sent`, with nodemailer's code only) and never fails the request.

**Without `SMTP_URL` no email is sent.** The log transport writes one line per mail
(`mail not sent: no SMTP_URL is set`, with the kind of mail, the recipient's domain and
the sizes; never the body, the links or the address) and the weekly run marks nothing
as sent, so setting SMTP up later still sends the current week. People can choose
their emails meanwhile; the account page says the server does not send email yet.
After SMTP is set up, people whose address was saved before must press "Send the link
again" to confirm it.

**Setting it up** (Option A's names; replace `<PROJECT>`, `<REGION>` and the mail
provider's details):
1. **A mail provider** that sends for your domain over SMTP with TLS (your
   organisation's mail server, or a transactional mail service). **Deliverability is
   the sender domain's job:** publish the SPF record and DKIM key the provider gives
   you, and a DMARC policy, for the domain of `MAIL_FROM`, or the mails go to spam.
   Use an address nobody needs to answer (`noreply@…`); the mails say how to stop
   them. A display name with a comma or semicolon must be in double quotes
   (`"FAO, Forestry" <noreply@…>`).
2. **The secrets** in Secret Manager, given to the service. `LINK_SECRET` (32+
   characters) and `PUBLIC_BASE_URL` are required with `SMTP_URL`: the mails' links are
   signed with `LINK_SECRET` only and start with `PUBLIC_BASE_URL` only, never with
   anything a request carries:
   ```bash
   printf '%s' 'smtps://<user>:<password>@<smtp-host>:465' | gcloud secrets create ce-smtp-url \
     --replication-policy=automatic --data-file=- --project=<PROJECT>
   openssl rand -base64 32 | tr -d '\n' | gcloud secrets create ce-link-secret \
     --replication-policy=automatic --data-file=- --project=<PROJECT>
   for s in ce-smtp-url ce-link-secret; do
     gcloud secrets add-iam-policy-binding $s --project=<PROJECT> \
       --member=serviceAccount:ce-cloud-run@<PROJECT>.iam.gserviceaccount.com \
       --role=roles/secretmanager.secretAccessor --condition=None
   done
   gcloud run services update collect-earth-cloud --region=<REGION> --project=<PROJECT> \
     --update-secrets=SMTP_URL=ce-smtp-url:latest,LINK_SECRET=ce-link-secret:latest \
     --update-env-vars='MAIL_FROM=Collect Earth Cloud <noreply@example.org>,PUBLIC_BASE_URL=https://<your address>'
   ```
   A percent sign, `@` or `:` in the user or password is written percent-encoded
   (`%25`, `%40`, `%3A`). The URL takes no options (`?…` is refused): TLS is always
   required (STARTTLS for `smtp://` to another machine) and certificates are always
   checked (the TLS name is sent for a host name, not for an IP address). The server
   refuses to start when `SMTP_URL` is set without `MAIL_FROM`, `PUBLIC_BASE_URL` (or
   `RENDER_EXTERNAL_URL`) or `LINK_SECRET`, or when one is malformed.
3. **The weekly job: Cloud Scheduler calls the endpoint.** This is documented, not
   created by `deploy.sh` (Cloud Scheduler is billed per job beyond the free ones).
   **The better way is Cloud Scheduler's OIDC token**: no shared secret is stored in
   the job, Google signs a short-lived token for a service account, and the server
   checks Google's signature, the audience and the account:
   ```bash
   gcloud services enable cloudscheduler.googleapis.com --project=<PROJECT>
   gcloud iam service-accounts create ce-scheduler --project=<PROJECT> \
     --display-name='Collect Earth Cloud weekly emails'
   gcloud run services update collect-earth-cloud --region=<REGION> --project=<PROJECT> \
     --update-env-vars='DIGEST_OIDC_AUDIENCE=https://<your address>/v1/internal/digest,DIGEST_OIDC_EMAIL=ce-scheduler@<PROJECT>.iam.gserviceaccount.com'
   gcloud scheduler jobs create http ce-weekly-digest --project=<PROJECT> --location=<REGION> \
     --schedule='0 6-14 * * 1' --time-zone=Etc/UTC \
     --uri='https://<your address>/v1/internal/digest' --http-method=POST \
     --oidc-service-account-email=ce-scheduler@<PROJECT>.iam.gserviceaccount.com \
     --oidc-token-audience='https://<your address>/v1/internal/digest' \
     --headers='content-type=application/json' --message-body='{}' --attempt-deadline=900s
   ```
   The audience must be exactly the same text in both places. (The service stays public,
   `--allow-unauthenticated`, for the dashboard and Collect Earth; the server checks the
   token itself, reading Google's public keys from `www.googleapis.com/oauth2/v3/certs`,
   kept for the time Google says.) **Or, with a shared secret:** store one as
   `DIGEST_SECRET` (`openssl rand -base64 32`, Secret Manager as above) and give the
   job `--headers='x-digest-secret=<the value>,content-type=application/json'` instead
   of the two `--oidc-…` flags; the job's definition then holds the secret, so whoever
   can read the job can call the endpoint (which still sends each week's mails once).

   Every hour from 06:00 to 14:00 UTC on Mondays: each call sends what is due and
   stops after 60 seconds or 500 mails (`{"budgetMs": …, "maxMails": …}` in the body
   change that, at most 600,000 ms), answering `{ sent, empty, skipped, done, failed,
   more }`; the next call goes on from there. A person's week is the last whole ISO
   week in **their** time zone, so people west of UTC get theirs in a later call that
   Monday; a week that ended before someone turned the email on is never sent. Calls are
   safe to repeat or retry: each person's week is marked done before its mail goes, so
   no week is sent twice (also with two instances at once); a mail that could not be
   sent (the mail server unreachable, a 4xx reply) is put back for the next call; one
   the mail server refuses for good (a 5xx reply: no such mailbox…) is not tried again
   that week, and after **3 such weeks in a row** the email is turned off and the
   account page says why (turning it on again starts afresh). A second call on the same
   instance while one runs gets 409.
4. **Check it** once: in the console, *Cloud Scheduler* → the job → *Force run*, then
   the service's log has `digest: run ended` with the counts (with a shared secret,
   `curl -X POST -H 'x-digest-secret: <secret>' https://<your address>/v1/internal/digest`
   answers with them).

**What is skipped:** accounts without an email, with one not confirmed or not one
address, or disabled by the server owner; projects a person left (only their
memberships now count); a week with nothing to tell (no project with plots or work)
is marked done without a mail (the account page's "last sent" shows only weeks a mail
went for). A deleted account takes its subscriptions with it.

**Logs:** the unsubscribe, confirmation and reset addresses (`/v1/unsubscribe/…`,
`/unsubscribe/…`, `/confirm-email/…`, `/reset/…`, `/v1/auth/reset/…`) are written to the server's log with the token
replaced by `<redacted>`; Cloud Run's request log keeps the full address, as for the
other links (see "Operational notes"). A failed send is logged with nodemailer's error
code, the SMTP reply code and the command only, never the server's message (it may
hold addresses). Unsubscribe links that work have a generous limit of their own (600
a minute per address); anything else there counts in the shared per-address limit.

## Cloud Run billing: work done between requests

`deploy.sh` keeps Cloud Run's **request-based billing**: an instance's CPU is
slowed down between requests, which keeps a quiet server almost free. The owner
decided (30 October 2026) to keep it. What it means:
- **An AI review runs only while a coordinator has the Quality tab open.** The
  page asks for the review's progress every 2 seconds, and those requests give the
  server the CPU to go on. A tab closed (or hidden) during a review pauses it; if it
  is not shown again it fails as "interrupted" or "took too long", **after its
  tokens were billed**. The panel says "Keep this page open until it has finished".
- **Fresh quality figures likewise** are worked out while the Quality tab or a
  report is open and asking for them; otherwise the figures shown are the last ones,
  with their time.

To remove this, switch the service to **instance-based billing**:
`gcloud run services update collect-earth-cloud --region=<REGION> --no-cpu-throttling`.
With up to 4 instances scaling to zero, that is about free to US$2 a month at light
use, and up to about US$45 a month with one instance always up. `deploy.sh` does
not change this setting. A later option is to hand AI runs to Cloud Tasks, so that
each runs inside a request of its own.

**Quality figures and memory.** On Postgres the figures are worked out in a
separate thread of the server, with at most `QUALITY_WORKER_MAX_MB` (default 256)
of memory, which leaves room for the rest of the server in the 512 MiB that
`deploy.sh` gives each instance. A project too big for that (tens of thousands of
records) gets a plain "needed more memory" message instead of the figures; then give
the service more memory (`--memory=1Gi`) with `NODE_HEAP_MB=448` and
`QUALITY_WORKER_MAX_MB=320` (see "Memory"). Never let the two heaps together come close to the
container's memory: the whole container would run out first and restart.

**The Collect Earth backup and its limits.** The Data tab's "Collect Earth backup" streams a
zip of the survey and the records (about 1.8 KB a record: 100,000 records are about 180 MB). The
browser downloads it by itself from a link that works once within a minute (signed with
`LINK_SECRET` when set, else with a key worked out from `DATABASE_URL`, so any instance accepts
it; a used link is remembered by the instance that served it, so another instance could take it
once more within that minute). Each instance writes one backup at a time (another coordinator is
told to try again in a few minutes); writing one took about 70 MB more than the server idle
(100,000 records, the heap capped at 384 MB). Two limits matter for large projects:
- **The request timeout.** Cloud Run cuts a request after `--timeout`. `deploy.sh` sets
  `REQUEST_TIMEOUT` (default 900 s: 180 MB at about 200 KB/s). For very large projects or slow
  connections raise it to Cloud Run's maximum, `REQUEST_TIMEOUT=3600 ./deploy/gcp/deploy.sh ...`, or
  `gcloud run services update collect-earth-cloud --region=<REGION> --timeout=3600`. A download cut
  short is noted in the Activity log ("stopped before the end").
- **Memory.** Large projects (more than about 30,000 records) need `--memory=1Gi`
  (`MEMORY=1Gi ./deploy/gcp/deploy.sh ...`, or `gcloud run services update collect-earth-cloud
  --region=<REGION> --memory=1Gi` with the heap settings of "Memory" below), so a backup and the
  quality figures fit side by side.
- **Per instance.** Both the one-backup-at-a-time rule and the used-link memory are each
  instance's: with 4 instances up to 4 backups may be written at once (each in its own instance's
  memory), and a link used on one instance can be used once more on another within its minute.

**Memory.** Each Cloud Run instance has 512 MiB by default. The server's own heap is capped at
`NODE_HEAP_MB` (the image's default 224 MB), the quality worker's at `QUALITY_WORKER_MAX_MB`
(default 256 MB, used only while figures are worked out), and the caches that make repeated pages
fast are sized to fit beside them. Rough estimates for one large project of 100,000 records (not
measurements of every case; the backup's figure was measured, Task 17):

| What | Default (512 MiB) | With 1 GiB | Setting |
| --- | --- | --- | --- |
| Node, the server's code and its connections | ~100 MB | ~100 MB | |
| The server's heap at most | 224 MB | 448 MB | `NODE_HEAP_MB` |
| Parsed plot files (shared by the pages and the files served) | up to 96 MB | up to 384 MB | `PARSED_FILES_CACHE_MB` |
| Plot files built for people (my-assignment and its download) | up to 32 MB | up to 128 MB | `SERVED_FILES_CACHE_MB` |
| Projects' state for Progress and People (tens of MB each at 100,000 records) | 3 projects | 6 projects | `PROJECT_STATES_KEPT` |
| Maps kept for their next pages (about 10 MB each at 100,000 plots) | 4 | 8 | `MAP_BUILDS_KEPT` |
| A Collect Earth backup being written | ~70 MB | ~70 MB | one per instance |
| The quality worker while it computes | up to 256 MB | up to 320 MB | `QUALITY_WORKER_MAX_MB` |

The caches live inside the server's heap: with the defaults a plot file over about 4 MB of CSV
(half of 96 MB at about 12 times its size once parsed) is parsed again for every request instead
of kept, which is slower but fits. **Above about 30,000 records**, or with plot files of tens of
MB, give the service 1 GiB and set `NODE_HEAP_MB=448` and `QUALITY_WORKER_MAX_MB=320`, and the
caches to the 1 GiB column (`gcloud run services update collect-earth-cloud --region=<REGION>
--memory=1Gi --update-env-vars=NODE_HEAP_MB=448,QUALITY_WORKER_MAX_MB=320,PARSED_FILES_CACHE_MB=384,SERVED_FILES_CACHE_MB=128,PROJECT_STATES_KEPT=6,MAP_BUILDS_KEPT=8`).
`deploy.sh` keeps these on its next update.

## Known limitations

- **Plot ids are read as UTF-8.** In a plot file saved as Latin-1 (ISO-8859-1), an
  id with an accented letter does not match the record key Collect Earth sends, so
  its records are listed as "plot in no file". Save plot files as UTF-8.
- **A header row whose names all look like numbers** (for example "2020") is taken
  for a data row, as Collect Earth itself does.
- **Blind checks need the next Collect Earth release after 1.23.19.** That release
  hides the `round` key everywhere a collector looks. Collect Earth 1.23.19 and
  older show the plot's round (a check copy as "105,2") in Earth Map, the Google
  Earth Engine app and the plots map, so a collector using them can tell a check
  apart. The server cannot see which version a collector uses: ask collectors to
  update before quality checks start.
- **"Open in Google Earth" links** on the Quality tab only work for plot files in
  latitude/longitude (WGS 84); for other coordinate systems the tab says they are
  not available.
- **Personal reports name no one,** but when a single person checks a collector's
  plots, the collector can tell who that is.
- **No Content-Security-Policy header** is sent by the server. If you add one (in a proxy
  in front of it), `img-src` must allow the map's tile host (`tile.openstreetmap.org`, or the
  host of `MAP_TILE_URL`) and `style-src` must allow inline styles, which Leaflet and the
  dashboard's components set.
- **AI limits are per project** and checked before a run starts, so the server's
  monthly total can reach the limit times the number of projects, plus one run each.
- **Check the plot file before pressing Apply in Collect Earth's plot settings.** When the
  settings open (or on Refresh), Collect Earth downloads the first plot file of the list and
  also the one in use, at the same time, and shows whichever download ends last. Someone
  working on a file that is not first in the list, such as "To check again – north.csv"
  (plots sent back for another look, always listed after the others), can find "north.csv"
  shown instead. Tell collectors to look at the plot file field and choose the file again
  from the list if it is not the one they want, before pressing Apply.
- **A plot sent back a second time shows the old comment in Collect Earth's form.** The
  form's header shows the comment the record was saved with before the one in the plot
  file, so after a second send-back with a new comment the collector reads the **first**
  comment at the top of the form until the record is saved again from the new "To check
  again" file, while the balloon and the plots map show the new one. The same old note
  shows when the plot is opened from the normal plot file. Tell collectors that the
  newest comment is the one in the balloon and on "My work".
- **A comment that looks like a shape** (WKT such as `POLYGON((…))`, or GeoJSON) is read
  by Collect Earth as the plot's shape in projects whose plots are polygons: Collect
  Earth looks for a shape in every column of a plot file's row, the coordinator's note
  included. Do not paste shapes into send-back comments.
- **Emails that bounce are not handled.** The server does not read bounces or
  complaints: an address that no longer works keeps being written to weekly until its
  owner removes it or unsubscribes. Watch the mail provider's bounce reports.
- **Some limits are per instance,** kept in memory, so with several Cloud Run instances
  each counts on its own, and a restart starts them again:
  - the requests per minute per client IP, and the failed logins per account
    (`RATE_LIMIT_PER_MINUTE`);
  - at most 100 confirmation mails an hour (the 3 an hour and 6 a day per account are
    stored, so they hold across instances);
  - "Forgot your password?": 3 reset mails an hour per account, 10 requests an hour per
    client IP and 100 reset mails an hour (with several instances, each counts its own);
  - one Collect Earth backup prepared at a time ("another Collect Earth backup is being
    prepared on this server"), and the memory of download links already used (a link
    lives 60 s, so another instance could accept a used one within that minute);
  - the server owner's panel: its figures are kept 60 s, and its counts of failed logins,
    refused requests and late automatic draws start when that instance starts;
  - one weekly email run at a time (another call meanwhile gets 409 `digest_running`;
    runs on two instances are still safe: each week is claimed before its mail goes).
- **A reviewer can still guess which plots are reference plots from the gaps.** The map,
  plot search and the plot places never show a reference plot to a reviewer, but where
  plot ids run in sequence (1, 2, 3 …), the ids missing from what a reviewer sees are the
  reference plots. Only plot ids that do not show an order would close this.
- **Open points for the owner** (the desktop's plot settings, the old comment above, and
  others) are listed in the plan, `docs/plans/2026-11-01-dashboard-improvements.md`,
  section "Owner decisions pending".

---

## Appendix: the same Google Cloud setup by hand

These are the commands `deploy.sh` runs on a first install (see
`bash deploy/gcp/deploy.sh --dry-run --project <PROJECT>` for the exact list).
Replace `<PROJECT>`; run from `collect-earth-cloud/`.

```bash
P=<PROJECT>; R=europe-west1
CONN=$P:$R:ce-cloud-db
SA=ce-cloud-run@$P.iam.gserviceaccount.com

# APIs (billing must be on: gcloud billing projects describe $P)
gcloud services enable cloudbilling.googleapis.com run.googleapis.com \
  sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com --project=$P

# Database (10 to 15 minutes)
gcloud sql instances create ce-cloud-db --project=$P \
  --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro --region=$R \
  --availability-type=zonal --storage-type=SSD --storage-size=10 --storage-auto-increase \
  --backup-start-time=02:00 --enable-point-in-time-recovery \
  --retained-backups-count=7 --retained-transaction-log-days=7 \
  --deletion-protection --database-flags=max_connections=50
gcloud sql databases create collect_earth_cloud --instance=ce-cloud-db --project=$P
DB_PW=$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-32)
gcloud sql users create ce --instance=ce-cloud-db --password="$DB_PW" --project=$P

# Secrets
printf '%s' "postgres://ce:$DB_PW@/collect_earth_cloud?host=/cloudsql/$CONN" |
  gcloud secrets create ce-database-url --replication-policy=automatic --data-file=- --project=$P
APP_PW=$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-32)
printf '%s' "postgres://ce_app:$APP_PW@/collect_earth_cloud?host=/cloudsql/$CONN" |
  gcloud secrets create ce-app-database-url --replication-policy=automatic --data-file=- --project=$P
printf '%s' "<XXXX-XXXX-XX>" |
  gcloud secrets create ce-setup-code --replication-policy=automatic --data-file=- --project=$P

# Service account
gcloud iam service-accounts create ce-cloud-run --display-name="Collect Earth Cloud server" --project=$P
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA \
  --role=roles/cloudsql.client --condition=None
for s in ce-database-url ce-app-database-url ce-setup-code; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA \
    --role=roles/secretmanager.secretAccessor --condition=None --project=$P
done

# Image
gcloud artifacts repositories create ce --repository-format=docker --location=$R --project=$P
gcloud artifacts repositories set-cleanup-policies ce --location=$R \
  --policy=deploy/gcp/cleanup-policy.json --project=$P
IMAGE=$R-docker.pkg.dev/$P/ce/collect-earth-cloud:$(git rev-parse --short HEAD)
gcloud builds submit . --tag=$IMAGE --ignore-file=deploy/gcp/build.gcloudignore --project=$P

# Service
gcloud run deploy collect-earth-cloud --project=$P --region=$R --image=$IMAGE \
  --service-account=$SA --add-cloudsql-instances=$CONN \
  --update-secrets=DATABASE_URL=ce-app-database-url:latest,MIGRATION_DATABASE_URL=ce-database-url:latest,SETUP_CODE=ce-setup-code:latest \
  --update-env-vars=STORE_BACKEND=postgres,MIGRATE_ON_BOOT=true \
  --allow-unauthenticated --port=8080 --cpu=1 --memory=512Mi \
  --min-instances=0 --max-instances=4 --concurrency=80 --timeout=900 --cpu-boost
gcloud run services describe collect-earth-cloud --region=$R --project=$P --format='value(status.url)'
```

To run migrations from your own machine instead of on boot, start the
[Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
(`cloud-sql-proxy $CONN`, which exposes `localhost:5432`) and run
`STORE_BACKEND=postgres MIGRATION_DATABASE_URL='postgres://ce:<pw>@localhost:5432/collect_earth_cloud' DATABASE_URL='postgres://ce_app:<app pw>@localhost:5432/collect_earth_cloud' npm run migrate`.
