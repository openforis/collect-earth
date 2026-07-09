# Deploying Collect Earth Cloud

This service is a single stateless container (Fastify + `tsx`, no build step) that
talks to a PostgreSQL database. It is designed for **Google Cloud Run + Cloud SQL**
(the FAO/OpenForis-hosted model), but runs on any Docker host + managed Postgres.

> **Never run production on `STORE_BACKEND=memory`** — the in-memory store keeps
> nothing across a restart. It exists only for local dev and the test suite.

## Environment variables

| Var | Required | Example | Purpose |
| --- | --- | --- | --- |
| `STORE_BACKEND` | yes (prod) | `postgres` | `memory` = no persistence; use `postgres` in production |
| `DATABASE_URL` | when postgres | `postgres://ce:pw@host:5432/collect_earth_cloud` | Postgres connection string |
| `ADMIN_API_KEY` | strongly advised | `<random 32+ chars>` | Required as `x-admin-key` to provision projects. **If unset, project creation is open to anyone.** |
| `PUBLIC_BASE_URL` | advised | `https://ce-cloud.example.org` | Builds the `/join/<token>` links the desktop client opens |
| `MIGRATE_ON_BOOT` | optional | `true` | Apply pending migrations on startup (see below) |
| `PORT` | no | `8080` | Listen port (Cloud Run injects `8080`) |
| `HOST` | no | `0.0.0.0` | Bind address |

Generate a good admin key: `openssl rand -base64 32`.

## Database migrations

Schema lives in `migrations/*.sql`, each idempotent (`IF NOT EXISTS`). Apply them
**before the first request** using one of:

- **One-off release step (recommended for multi-instance):**
  ```bash
  STORE_BACKEND=postgres DATABASE_URL='postgres://…' npm run migrate
  ```
- **On boot (convenient for a single instance):** set `MIGRATE_ON_BOOT=true`.
  The server applies pending migrations before it listens. Safe to leave on
  because migrations are idempotent; avoid it on cold-scaling multi-instance
  deploys where several instances could migrate concurrently.

---

## Option A — Google Cloud Run + Cloud SQL (recommended)

Assumes `gcloud` is authenticated and a project is selected. Replace
`<PROJECT>`, the region, and passwords.

### 1. Create the database
```bash
gcloud sql instances create ce-cloud-db \
  --database-version=POSTGRES_16 --tier=db-f1-micro --region=europe-west1
gcloud sql databases create collect_earth_cloud --instance=ce-cloud-db
gcloud sql users create ce --instance=ce-cloud-db --password='<DB_PASSWORD>'
```
Note the instance connection name: `<PROJECT>:europe-west1:ce-cloud-db`.

### 2. Build & push the image
```bash
cd collect-earth-cloud
gcloud builds submit \
  --tag europe-west1-docker.pkg.dev/<PROJECT>/ce/collect-earth-cloud
```

### 3. Run migrations
The Cloud Run service (step 4) can self-migrate with `MIGRATE_ON_BOOT=true`, or
run them explicitly from a machine with the Cloud SQL Proxy running:
```bash
cloud-sql-proxy <PROJECT>:europe-west1:ce-cloud-db &   # exposes localhost:5432
STORE_BACKEND=postgres \
  DATABASE_URL='postgres://ce:<DB_PASSWORD>@localhost:5432/collect_earth_cloud' \
  npm run migrate
```

### 4. Deploy the service
Cloud Run reaches Cloud SQL over a unix socket at `/cloudsql/<conn>`:
```bash
CONN=<PROJECT>:europe-west1:ce-cloud-db
gcloud run deploy collect-earth-cloud \
  --image europe-west1-docker.pkg.dev/<PROJECT>/ce/collect-earth-cloud \
  --region europe-west1 --port 8080 --allow-unauthenticated \
  --add-cloudsql-instances "$CONN" \
  --set-env-vars "STORE_BACKEND=postgres,\
DATABASE_URL=postgres://ce:<DB_PASSWORD>@/collect_earth_cloud?host=/cloudsql/$CONN,\
ADMIN_API_KEY=<ADMIN_API_KEY>,\
PUBLIC_BASE_URL=https://ce-cloud.example.org,\
MIGRATE_ON_BOOT=true"
```
Prefer **Secret Manager** for `DATABASE_URL` and `ADMIN_API_KEY` over plain
`--set-env-vars` in a real deployment (`--set-secrets`).

Map your domain to the service so `PUBLIC_BASE_URL` matches the real hostname
(`gcloud run domain-mappings create`).

---

## Option B — Any Docker host + managed Postgres

The app is cloud-agnostic. Point it at any reachable Postgres and put TLS in
front (Cloud Run, a load balancer, or nginx/Caddy — the app itself speaks plain
HTTP on `PORT`).

```bash
cd collect-earth-cloud
docker build -t collect-earth-cloud .
docker run -d --name ce-cloud -p 8080:8080 \
  -e STORE_BACKEND=postgres \
  -e DATABASE_URL='postgres://ce:<pw>@db-host:5432/collect_earth_cloud' \
  -e ADMIN_API_KEY='<ADMIN_API_KEY>' \
  -e PUBLIC_BASE_URL='https://ce-cloud.example.org' \
  -e MIGRATE_ON_BOOT=true \
  collect-earth-cloud
```

The bundled `docker-compose.yml` is a **dev-only** Postgres for local runs, not a
production topology — use a managed/backed-up Postgres in production.

---

## Post-deploy checks & onboarding

```bash
BASE=https://ce-cloud.example.org

# 1. Liveness
curl -fsS "$BASE/health"

# 2. Provision a project (needs the admin key)
curl -fsS -X POST "$BASE/v1/projects" \
  -H "x-admin-key: <ADMIN_API_KEY>" -H 'content-type: application/json' \
  -d '{"name":"My project"}'
# → {"projectId":"…","adminToken":"…","projectToken":"…"}
```

Hand the credentials to collectors one of two ways:

- **Manual:** desktop client → Settings → Database → *Cloud project* → enter the
  server URL, `projectId`, and a token → *Test connection* → Apply → restart.
- **Join-by-URL:** upload a CEP (`PUT /v1/projects/:pid/cep`, admin), mint an
  invite (`POST /v1/projects/:pid/invites`), and share
  `"$PUBLIC_BASE_URL"/join/<inviteToken>`. Collectors use File → *Join cloud
  project…* and register/login; the CEP downloads and the app switches to cloud
  mode. (This is why `PUBLIC_BASE_URL` must be set correctly.)

## Operational notes

- **Scaling:** the service is stateless; scale Cloud Run instances freely. All
  state is in Postgres. With multiple instances, migrate as a release step rather
  than via `MIGRATE_ON_BOOT` to avoid concurrent-migration races on cold start.
- **Backups:** enable automated backups / PITR on the Postgres instance — record
  data and tombstones live only there.
- **Passwords:** hashed with scrypt (`node:crypto`, no native deps). For a
  hardened deployment swap `src/password.ts` for argon2id; only that module
  changes (the stored-hash string shape is private to it).
- **Rotation:** project/admin tokens are revocable only by rotation today
  (re-provision or issue per-user tokens); treat the admin key as a secret.
