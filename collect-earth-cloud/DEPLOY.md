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
| `PUBLIC_BASE_URL` | advised with a custom domain | `https://ce-cloud.example.org` | Base of the `/join/<token>` and `/reset/<token>` links. If unset: `RENDER_EXTERNAL_URL`, else the request's `x-forwarded-proto` + host (correct on Cloud Run's own `*.run.app` address) |
| `RENDER_EXTERNAL_URL` | no | `https://ce-cloud.onrender.com` | Honoured only as an environment fallback for the link base when `PUBLIC_BASE_URL` is unset (some hosts set it automatically) |
| `RATE_LIMIT_PER_MINUTE` | no | `60` | Requests per minute per client IP on login, register, signup, setup and reset (429 `rate_limited` above it). Kept generous because a training room joins from one office IP; failed logins are also limited to 10 per minute per account. `0` disables both. Per instance, in memory |
| `TRUST_PROXY_HOPS` | no | `1` | Proxies in front of the server that add to `x-forwarded-for` (see below) |
| `MIGRATE_ON_BOOT` | optional | `true` | Apply pending migrations on startup (see below) |
| `PORT` | no | `8080` | Listen port (Cloud Run injects `8080`) |
| `HOST` | no | `0.0.0.0` | Bind address |
| `QUALITY_WORKER_MAX_MB` | no | `256` | Memory (MB, at least 64) the thread that works out the quality figures may use on Postgres. A project too big for it gets a plain error instead of the figures. Keep it below the container's memory (see "Quality figures and memory") |
| `AI_VERTEX_API_KEY` | no | (secret) | Optional AI assistant: a Vertex AI API key, restricted to the Vertex AI API. Wins over `AI_VERTEX_PROJECT` when both are set. See "AI assistant (optional)" |
| `AI_VERTEX_PROJECT` | no | `my-project` | Optional AI assistant without a key: the Google Cloud project whose Vertex AI the server's service account calls |
| `AI_VERTEX_REGION` | no | `global` | Vertex AI location, used with `AI_VERTEX_PROJECT` (default `global`) |
| `AI_MODEL` | no | `gemini-3.8-flash` | The Gemini model id on Vertex AI (default `gemini-3.8-flash`) |
| `AI_FAKE` | never in production | `1` | Development only: a scripted stand-in for the model, so the AI panel can be tried without Vertex. Refused unless `STORE_BACKEND=memory`, and refused on Cloud Run (`K_SERVICE`) or with `NODE_ENV=production` |

Generate a good admin key: `openssl rand -base64 32`.

The server trusts `x-forwarded-*` headers from `TRUST_PROXY_HOPS` proxies (default
1): it is meant to run behind Cloud Run or a reverse proxy, which set them. The
client IP used for rate limiting is the entry that many places from the right of
`x-forwarded-for`, so an address a client writes itself does not count. Behind two
proxies (e.g. a load balancer in front of Caddy) set it to `2`. Do not expose the
container port directly to the internet without one.

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
| Cloud Run service | `collect-earth-cloud` | the dedicated service account, Cloud SQL connector to `ce-cloud-db`, secrets `DATABASE_URL=ce-app-database-url:latest`, `MIGRATION_DATABASE_URL=ce-database-url:latest` and `SETUP_CODE=ce-setup-code:latest`, env `STORE_BACKEND=postgres`, `MIGRATE_ON_BOOT=true` (+ `PUBLIC_BASE_URL` with `--domain`), public (`--allow-unauthenticated`), port 8080, 1 vCPU, 512 MiB, 0 to 4 instances, concurrency 80, timeout 300 s, startup CPU boost |
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

## Operational notes

- **Scaling:** the service is stateless; all state is in Postgres. Scale Cloud
  Run instances freely within the database's `max_connections` (see above).
  Boot migrations are serialised by the advisory lock.
- **Backups:** keep automated backups and PITR on the Postgres instance (the
  script turns both on): record data and tombstones live only there. Restore from
  the Cloud SQL console (*Backups* → *Restore*, or *Point-in-time recovery*, which
  creates a clone to switch to).
- **Logs:** `gcloud run services logs read collect-earth-cloud --region <REGION> --limit 50`.
- **Passwords:** hashed with scrypt (`node:crypto`, no native deps). For a
  hardened deployment swap `src/password.ts` for argon2id; only that module
  changes (the stored-hash string shape is private to it).
- **Rotation:** project/admin tokens are revocable only by rotation today
  (re-provision or issue per-user tokens); treat the admin key as a secret.
  To rotate the database password: set a new one with
  `gcloud sql users set-password ce --instance=ce-cloud-db`, add it as a new
  version of `ce-database-url`, and redeploy (re-run the script).

---

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
the service more memory (`gcloud run services update ... --memory=1Gi`) and raise
`QUALITY_WORKER_MAX_MB` to about half of it (e.g. 512). Never set it close to the
container's memory: the whole container would run out first and restart.

## Known limitations

- **Plot ids are read as UTF-8.** In a plot file saved as Latin-1 (ISO-8859-1), an
  id with an accented letter does not match the record key Collect Earth sends, so
  its records are listed as "plot in no file". Save plot files as UTF-8.
- **A header row whose names all look like numbers** (for example "2020") is taken
  for a data row, as Collect Earth itself does.
- **Blind checks depend on Collect Earth hiding the `round` key** from collectors;
  it is checked with the desktop app, not by the server.
- **"Open in Google Earth" links** on the Quality tab only work for plot files in
  latitude/longitude (WGS 84); for other coordinate systems the tab says they are
  not available.
- **Personal reports name no one,** but when a single person checks a collector's
  plots, the collector can tell who that is.
- **AI limits are per project** and checked before a run starts, so the server's
  monthly total can reach the limit times the number of projects, plus one run each.

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
  --min-instances=0 --max-instances=4 --concurrency=80 --timeout=300 --cpu-boost
gcloud run services describe collect-earth-cloud --region=$R --project=$P --format='value(status.url)'
```

To run migrations from your own machine instead of on boot, start the
[Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
(`cloud-sql-proxy $CONN`, which exposes `localhost:5432`) and run
`STORE_BACKEND=postgres MIGRATION_DATABASE_URL='postgres://ce:<pw>@localhost:5432/collect_earth_cloud' DATABASE_URL='postgres://ce_app:<app pw>@localhost:5432/collect_earth_cloud' npm run migrate`.
