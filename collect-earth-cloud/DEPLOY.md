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
| `DATABASE_URL` | when postgres | `postgres://ce:pw@host:5432/collect_earth_cloud` | Postgres connection string. On Cloud Run with the Cloud SQL connector: `postgres://ce:pw@/collect_earth_cloud?host=/cloudsql/PROJECT:REGION:INSTANCE` |
| `SETUP_CODE` | advised | `K7QX-M3TB-WN` | Asked for once by the dashboard's first-run setup, which creates the platform admin. If unset, a random code is generated at boot and printed in the log (`Setup code: XXXX-XXXX-XX …`) while no platform admin exists. Case, spaces and hyphens are ignored when it is typed |
| `ADMIN_API_KEY` | optional | `<random 32+ chars>` | Lets scripts provision projects with `x-admin-key` (returns the Phase-0 project tokens). Dashboard users create projects with their session instead. Without it, anonymous provisioning works **only** with `STORE_BACKEND=memory`; on Postgres it is refused (401) |
| `PUBLIC_BASE_URL` | advised with a custom domain | `https://ce-cloud.example.org` | Base of the `/join/<token>` and `/reset/<token>` links. If unset: `RENDER_EXTERNAL_URL`, else the request's `x-forwarded-proto` + host (correct on Cloud Run's own `*.run.app` address) |
| `RENDER_EXTERNAL_URL` | no | `https://ce-cloud.onrender.com` | Honoured only as an environment fallback for the link base when `PUBLIC_BASE_URL` is unset (some hosts set it automatically) |
| `RATE_LIMIT_PER_MINUTE` | no | `60` | Requests per minute per client IP on login, register, signup, setup and reset (429 `rate_limited` above it). Kept generous because a training room joins from one office IP; failed logins are also limited to 10 per minute per account. `0` disables both. Per instance, in memory |
| `MIGRATE_ON_BOOT` | optional | `true` | Apply pending migrations on startup (see below) |
| `PORT` | no | `8080` | Listen port (Cloud Run injects `8080`) |
| `HOST` | no | `0.0.0.0` | Bind address |

Generate a good admin key: `openssl rand -base64 32`.

The server trusts `x-forwarded-*` headers (`trustProxy`): it is meant to run behind
Cloud Run or a reverse proxy, which set them. Do not expose the container port
directly to the internet without one.

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
| Secret | `ce-database-url` | `postgres://ce:<password>@/collect_earth_cloud?host=/cloudsql/<PROJECT>:<REGION>:ce-cloud-db`. Created only if missing |
| Secret | `ce-setup-code` | `XXXX-XXXX-XX` from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, the same shape as `generateSetupCode()` in `src/accountRules.ts`. Created only if missing |
| Service account | `ce-cloud-run@<PROJECT>.iam.gserviceaccount.com` | `roles/cloudsql.client` on the project; `roles/secretmanager.secretAccessor` on the two secrets only |
| IAM for builds | the project's default Cloud Build service account (`gcloud builds get-default-service-account`) | `roles/cloudbuild.builds.builder` (projects created since 2024 give the default compute account no roles) |
| Artifact Registry | `ce` (docker, in the region) | cleanup policy `deploy/gcp/cleanup-policy.json`: keep the 5 newest images, delete others older than 30 days |
| Image | `<REGION>-docker.pkg.dev/<PROJECT>/ce/collect-earth-cloud:<git-sha>-<timestamp>` | built by Cloud Build from `collect-earth-cloud/` (the Dockerfile context), uploading what `deploy/gcp/build.gcloudignore` does not exclude |
| Cloud Run service | `collect-earth-cloud` | the dedicated service account, Cloud SQL connector to `ce-cloud-db`, secrets `DATABASE_URL=ce-database-url:latest` and `SETUP_CODE=ce-setup-code:latest`, env `STORE_BACKEND=postgres`, `MIGRATE_ON_BOOT=true` (+ `PUBLIC_BASE_URL` with `--domain`), public (`--allow-unauthenticated`), port 8080, 1 vCPU, 512 MiB, 0 to 4 instances, concurrency 80, timeout 300 s, startup CPU boost |
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
  -e DATABASE_URL='postgres://ce:<pw>@db-host:5432/collect_earth_cloud' \
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
admin key when `ADMIN_API_KEY` is set:

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
printf '%s' "<XXXX-XXXX-XX>" |
  gcloud secrets create ce-setup-code --replication-policy=automatic --data-file=- --project=$P

# Service account
gcloud iam service-accounts create ce-cloud-run --display-name="Collect Earth Cloud server" --project=$P
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA \
  --role=roles/cloudsql.client --condition=None
for s in ce-database-url ce-setup-code; do
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
  --update-secrets=DATABASE_URL=ce-database-url:latest,SETUP_CODE=ce-setup-code:latest \
  --update-env-vars=STORE_BACKEND=postgres,MIGRATE_ON_BOOT=true \
  --allow-unauthenticated --port=8080 --cpu=1 --memory=512Mi \
  --min-instances=0 --max-instances=4 --concurrency=80 --timeout=300 --cpu-boost
gcloud run services describe collect-earth-cloud --region=$R --project=$P --format='value(status.url)'
```

To run migrations from your own machine instead of on boot, start the
[Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
(`cloud-sql-proxy $CONN`, which exposes `localhost:5432`) and run
`STORE_BACKEND=postgres DATABASE_URL='postgres://ce:<pw>@localhost:5432/collect_earth_cloud' npm run migrate`.
