# Collect Earth Cloud Platform — Project Management & Collaboration Plan

**Status: PLAN ONLY — no implementation started.**
Supersedes/extends the approved "Cloud Sync" plan (`~/.claude/plans/i-want-you-to-gleaming-mountain.md`). The sync transport designed there remains the foundation; this plan adds the management layer on top. Client-side building blocks already implemented (cloud `EarthProperty` entries, `RecordSavedListener` seam, `CloudSyncQueueDao`) carry over unchanged.

## 1. Vision

A web service where a **super user (project admin)** manages Collect Earth projects end-to-end:

- CEP files are still authored in **Collect Survey Designer** (no change to authoring).
- Admin **imports the CEP** into the web dashboard → a cloud project is created.
- Admin **invites operators via URL**. Operators register (username/password), then Collect Earth uses that URL to download the CEP, auto-configure itself, and sync collected data to the server.
- Admin **assigns plot CSV files** (from within the CEP) to specific operators — replacing today's manual workflow (`FileDividerToolDlg` splits CSVs by hand and coordinators email the pieces around).
- Admin gets a **full overview** of collection progress; operators log in to see **their own stats** (collected vs remaining).
- Admin can **review data** and push review outcomes back to operators' Collect Earth clients.

This makes the server the coordination hub. The Java client remains the collection tool: all Collect validation/record logic stays client-side (per the prior finding: the DB payload is version-coupled Protostuff; the sync payload is version-stable Collect XML produced by `DataMarshaller`).

## 2. Storage: answer to the Firebase Realtime Database question

**Recommendation: PostgreSQL (Cloud SQL), not Firebase Realtime Database — and this supersedes the earlier Firestore choice too.**

Why RTDB is the wrong fit:
- RTDB is one big JSON tree with shallow ordering/filtering on a single indexed key per query. The dashboard needs queries like "plots assigned to user X with no actively-saved record, grouped by CSV file" — joins across plots × assignments × records × users. In RTDB you'd denormalize every combination by hand.
- No server-side aggregation (counts require counter maintenance or full downloads). A 50k-plot project overview would be painful and expensive (RTDB bills by bandwidth).
- Scaling model is shard-by-database; queries never span shards.

Why revisit Firestore as well: Firestore handles tens of thousands of documents trivially (that part is not a concern — 100k docs is small for Firestore), and it has aggregation queries now. But the platform's shape has changed since that decision: assignment matrices, review queues, per-plot status joins, inter-operator comparisons, exports with filters — this is relational workload. The original argument for Firestore was "scales to zero for self-deployed dormant projects"; the confirmed hosting model is **one FAO/OpenForis-hosted multi-tenant instance**, which is always warm anyway. A small Cloud SQL instance (~$30–60/month for the whole platform, all projects) buys real SQL, one mental model, and trivially supports:
- `plots` table with 10k–100k rows per project (millions total — nothing for Postgres),
- indexed joins for dashboards, review queues, per-user stats,
- window functions for progress/velocity charts,
- `record_xml` as `TEXT` column (KBs each) or GCS pointer for oversized ones.

Keep **GCS** for binary artifacts: the CEP zip itself, `idml.xml`, generated export zips.

Decided stack: **Cloud Run (Node 20 + Fastify + TypeScript) + Cloud SQL PostgreSQL + GCS**. Client protocol unchanged: plain HTTPS + JSON + Bearer tokens (no Firebase SDK anywhere in the Java client).

## 3. Architecture overview

```
Collect Survey Designer ──authors──> CEP file
                                       │ (admin uploads)
        ┌──────────────────────────────▼───────────────────────────────┐
        │  collect-earth-cloud (Cloud Run: Fastify API + dashboard SPA)│
        │  - Auth (register/login, roles)      - CEP parsing/storage   │
        │  - Projects, invites, assignments    - Records intake (sync) │
        │  - Stats/progress                    - Review workflow       │
        └───────┬──────────────────────────────────────┬───────────────┘
            Cloud SQL (Postgres)                      GCS
            users/projects/plots/records/reviews      CEP zips, idml, exports
                        ▲
                        │ HTTPS + JSON, Bearer token (per user)
        ┌───────────────┴───────────────┐
        │ Collect Earth desktop (Java)  │
        │ - Join-by-URL (download CEP,  │
        │   auto-configure, login)      │
        │ - Assigned-CSV download       │
        │ - Background record sync      │  <-- transport from prior plan
        │ - Review-state pull           │
        └───────────────────────────────┘
```

### CEP parsing on the server (no Collect logic needed)
A CEP is a zip: `project_definition.properties`, survey `idml.xml`, one or more plot CSV/CED files, KML/balloon templates. Node can unzip, read the properties, list the CSVs, and parse plot rows (id + lat/lon + extra columns) without any Collect library. Parsed plots seed the `plots` table (total counts, assignment targets, map preview). The untouched CEP zip is stored in GCS and re-served verbatim to joining clients — the server never rewrites what Survey Designer produced; per-user settings travel via API, not by mutating the CEP.

## 4. Server data model (Postgres, all tables multi-tenant via project_id)

- `users` — id, username, password_hash (argon2id), email?, created_at. Global accounts; one user can be in many projects. **An account carries no authority by itself** — all permissions derive from `project_members` rows.
- `projects` — id, name, survey_uri, cep_gcs_path, idml_checksum, status (draft/active/archived), created_by. `created_by` is provenance only; authority always comes from membership (so ownership survives the creator leaving).
- `project_members` — project_id, user_id, role (`admin` | `reviewer` | `operator`), joined_at. This is the **tenancy table**: super-user = a user with an `admin` membership row. One user can be admin of many projects; one project can have many admins. An admin can invite further admins to their own project (invite with role=admin) but can never grant or gain anything on a project they hold no membership in.
- `invites` — token (random, hashed), project_id, role, max_uses, expires_at, created_by. The **invite URL** = `https://<host>/join/<token>`.
- `csv_files` — project_id, filename (as inside CEP), plot_count, checksum.
- `assignments` — project_id, csv_file_id, user_id, assigned_at, assigned_by. Unit of assignment = CSV file (matches the user's request). Finer-grained (row-range) splitting is a later refinement — the admin can pre-split in Survey Designer or with the existing divider tool until then.
- `plots` — project_id, csv_file_id, plot_key (the record key), lat, lon, extra jsonb. Seeded at CEP import.
- `records` — project_id, plot_key, operator_user_id, modified_on, received_at, actively_saved, step, deleted (soft), revision, xml TEXT, summary jsonb, client_version. Unique (project_id, plot_key, operator_user_id). Same LWW + tombstone semantics as the sync plan.
- `reviews` — record_id, status (`pending`/`approved`/`rejected`), comment, reviewer_id, reviewed_at.
- `audit_log` — who did what when (admin actions).

Progress = `plots` LEFT JOIN latest `records` per plot_key, grouped by assignment. All the stats pages are single queries.

## 4b. Tenancy & isolation model (user requirement — data is private per project)

**Requirement (confirmed):** a super-user managing one data collection must never see another project's existence, activity, or data. A super-user may manage multiple projects; a project may have multiple super-users. Both are naturally expressed by `project_members` above. Isolation is enforced as follows:

1. **The project is the tenant boundary.** Every domain table carries `project_id`; there are no cross-project queries anywhere in the API. Aggregations (stats, overview, exports) are always computed within one project.
2. **Membership check in middleware, not in handlers.** Every `/v1/projects/{pid}/...` route passes through one authorization layer: resolve token → user → look up `project_members(pid, user)` → attach `{userId, projectId, role}` to the request context. No membership row → `404` (not `403` — a non-member must not even learn that the project id exists). Handlers receive the already-scoped context and query by it; a handler cannot "forget" the check because it never sees an unscoped request.
3. **No global listings.** `GET /v1/projects` returns only the caller's memberships. There is no endpoint that enumerates users, projects, or records across tenants. Usernames are only searchable *within* a project's member list.
4. **Postgres Row-Level Security as a second fence.** Beyond app-level scoping, enable RLS on all `project_id` tables with a policy bound to a per-request `SET LOCAL app.current_project`. Even a buggy handler or injected query then can't cross tenants. (Cheap to add at schema time, painful to retrofit — do it in Phase A.)
5. **GCS isolation.** All artifacts live under `projects/{pid}/...` object paths in a non-public bucket. Clients never get raw bucket access; downloads go through the API (which applies rule 2) or short-lived signed URLs minted per authorized request. Export zips get random object names + expiry.
6. **Invites are project-scoped capabilities.** An invite token grants membership in exactly one project at exactly one role; admins of project A cannot mint invites for project B. Registration via invite creates the account *and* the single membership — nothing more.
7. **Platform operator caveat (honesty clause).** FAO/OpenForis operates the shared instance, so a `platform_admin` flag (support/provisioning: create projects for coordinators, reset access) technically transcends tenants. This role is out-of-band (not obtainable via any API), every use of it is written to `audit_log`, and the privacy statement to coordinators should say so plainly.
8. **Isolation test suite (Phase A gate).** Automated tests that log in as admin of project A and attempt every single endpoint against project B — all must return 404. This suite runs in CI and is the acceptance criterion for the tenancy layer; new endpoints don't merge without a case here.

## 5. API surface (v1, all JSON + Bearer)

Auth & accounts
- `POST /v1/auth/register` (requires valid invite token) → account + project membership
- `POST /v1/auth/login` → opaque access token (stored client-side in `CLOUD_SYNC_TOKEN`)
- `POST /v1/auth/logout`, `GET /v1/me` (memberships, roles)
- `GET /v1/projects` — list **only the caller's** project memberships (dashboard home)

Membership (admin, scoped to own project)
- `GET /v1/projects/{pid}/members`, `PUT /v1/projects/{pid}/members/{uid}` (change role), `DELETE .../members/{uid}` (remove; last-admin removal is refused so a project can't be orphaned)

Projects (admin)
- `POST /v1/projects` (multipart CEP upload) → parse, seed plots/csv_files, store zip in GCS
- `PUT /v1/projects/{pid}/cep` — re-upload updated CEP (version bump; see survey-drift risk)
- `POST /v1/projects/{pid}/invites` → invite URL (role, expiry, max uses)
- `PUT /v1/projects/{pid}/assignments` — csv_file ↔ user mapping
- `GET /v1/projects/{pid}/overview` — totals, per-user progress, per-csv progress, last activity
- `GET /v1/projects/{pid}/export.zip?...` — Collect-XML zip (layout matches `XMLDataExportProcess`: `idml.xml` + `1/{n}.xml`) — unchanged from sync plan

Join & client bootstrap (operator, called by Collect Earth)
- `GET /v1/join/{inviteToken}` — project metadata preview (name, survey, role) before registering
- `GET /v1/projects/{pid}/cep` — download the CEP zip (auth'd)
- `GET /v1/projects/{pid}/my-assignment` — list of assigned CSV files + download URLs + checksums
- `GET /v1/projects/{pid}/my-stats` — collected / actively-saved / remaining for the logged-in operator

Sync (operator; carried over from sync plan, project token replaced by user token)
- `POST /v1/projects/{pid}/records:batch` — envelopes `{recordKey, modifiedOn, activelySaved, step, surveyUri, xml, summary, deleted?, baseRevision?, clientVersion, payloadVersion}` → per-record `stored|stale|conflict|error`
- `GET /v1/projects/{pid}/records/{plotKey}` — pull a record (cross-machine editing / corrections)
- `GET /v1/projects/{pid}/reviews?since=` — review outcomes for my records (client pulls, surfaces rejections)

Review (admin/reviewer)
- `GET /v1/projects/{pid}/records?filters...` — browse summaries (jsonb filters, pagination)
- `PUT /v1/records/{id}/review` — approve/reject + comment
- `GET /v1/projects/{pid}/records/{id}/versions` — revision history

## 6. Java client changes (collect-earth)

Already implemented (kept):
- `EarthProperty`: `CLOUD_SYNC_ENABLED/URL/PROJECT_ID/TOKEN` (+getters) — `LocalPropertiesService.java`
- `RecordSavedListener` seam in `AbstractEarthSurveyService.flush()`/`storePlacemarkOld()`
- `CloudSyncQueueDao` (durable queue incl. `deleted` tombstone flag, shared `dataSource`)

Still to build from sync plan (unchanged): `CloudRecordSerializer` (DataMarshaller + balloon-map), `CloudApiClient`, `CloudSyncService` (scheduler/backoff/reconciliation), `RemovePlotsFromDBDlg` tombstone hook, `ServerController` shutdown flush, sync-status dialog.

New for the platform:
1. **"Join cloud project…" dialog** (`CollectEarthMenu`, likely under File/Projects): paste invite/project URL → `GET /v1/join/{token}` shows project name → login (or link to register in browser) → `POST /v1/auth/login` → download CEP to temp file → **reuse `EarthProjectsService.loadCompressedProjectFile(File)`** (existing, verified) → save `CLOUD_*` properties + token. One dialog, everything else is existing machinery.
2. **Assigned-CSV bootstrap**: after project load (and on "Refresh assignment" action), call `/my-assignment`, download assigned CSV(s) into the project folder, and point `EarthProperty.SAMPLE_FILE` at it — exactly what `CollectEarthTransferHandler`/`KmlImportService` already do when a user picks a CSV manually (`localPropertiesService.setValue(EarthProperty.SAMPLE_FILE, ...)`); `KmlGeneratorService` regenerates the KML from it with zero changes. Multiple assigned CSVs: merge into one local CSV (KML generator takes one file) or let the user switch via a small chooser.
3. **Operator identity = server account**: on login, set `EarthProperty.OPERATOR_KEY` to the server username (records are already stamped with operator; now it's authoritative). Grey out the free-text operator field in `PropertiesDialog` while cloud mode is on.
4. **Review-state pull** (later phase): `CloudSyncService` also polls `/reviews?since=`; rejected plots get flagged — minimal v1: a "Plots needing revision" dialog + regenerate KML with a distinct icon for rejected plots (KML icons already reflect record state via the NetworkLink refresh; extend that status source).
5. **CEP update check** (later phase): on start, compare local CEP/idml checksum with server; prompt to re-download.

## 7. Super-user feature catalog (brainstorm — requested ideas)

MVP (phases A–B below):
- CEP import, project lifecycle (draft → active → archived)
- Invite links with role + expiry; member management (deactivate, re-invite, revoke token/device)
- CSV-file-per-operator assignment with progress per assignment
- Overview dashboard: total/actively-saved/remaining, per-operator table, last-activity, per-CSV completion
- Web map of plots colored by status (MapLibre + plot lat/lon already parsed from CSVs)
- Export center: filtered Collect-XML zip / CSV of summaries

Coordination & quality (phase C+):
- **Review queue**: filter (e.g. "all plots classified as deforestation", "operator = X", "collected this week"), record detail view from summary JSON, approve/reject + comment, bulk actions; rejections flow back into the operator's client
- **Overlap/QA sampling**: assign the same subset to 2+ operators, inter-operator agreement report (per-attribute % agreement / Cohen's kappa) — the per-(plot, operator) record keying already supports this
- **Gold-standard calibration**: admin marks plots with reference answers; new operators do a training CSV first and get an accuracy score before real assignment
- **Quality monitors**: time-per-plot outliers (suspiciously fast operators), validation-error rates, share of records never actively saved, daily activity heatmaps
- **Reassignment/rebalancing**: move a CSV (or remainder of one) from a slow/departed operator to another; the client picks it up on next assignment refresh
- **Targets & deadlines**: per-operator weekly quotas, burn-down chart, projected completion date from velocity
- **Broadcast/messaging**: announcement banner shown in the dashboard and optionally in Collect Earth (fetched with assignment refresh); reviewer comment on a record appears in that plot's balloon
- **Survey/CEP versioning**: publish CEP v2, dashboard shows which clients still sync with old checksum
- **Audit log** of all admin actions
- **Project cloning/templates** (same survey, new grid), **archive with final export snapshot**
- **Webhooks/scheduled exports** (e.g. weekly zip to a bucket/email) for downstream pipelines (Saiku/IPCC ingestion stays: export.zip → existing import flow)

## 8. Phasing

- **Phase A — Platform foundation**: Postgres schema, auth (argon2 + opaque tokens), project CRUD + CEP import/parsing, invite URLs + registration, join-by-URL dialog in the Java client, record sync end-to-end (finish remaining sync-plan client tasks against the new API), minimal overview page.
- **Phase B — Assignment & stats**: assignments API + admin UI, client assigned-CSV bootstrap, operator my-stats page, per-assignment progress, web map, export center.
- **Phase C — Review & quality**: review queue + statuses, client review-pull + KML flagging, revision history (per-record `revision` from the sync plan), overlap sampling + agreement reports, gold-standard calibration.
- **Phase D — Coordination extras**: quality monitors, quotas/burn-down, broadcasts, webhooks, CEP versioning UX, audit log surfacing.

Each phase is shippable; A alone already replaces the fiddly PostgreSQL setup with something strictly better.

## 9. Security & auth notes

- Passwords: argon2id; opaque random tokens (DB-hashed) over JWTs — revocable, simple; token in `earth.properties` like other secrets (same exposure as today's DB password; document it).
- Invite tokens: single-purpose, expiring, hashed at rest; registration requires one (no open signup).
- Roles enforced server-side per project membership; operators can only read their own records/stats; reviewers read-all, write-reviews; admins everything.
- Rate-limit auth endpoints; HTTPS only (Cloud Run default); per-project data isolation per the tenancy model in §4b (middleware membership check, RLS second fence, cross-tenant 404s, CI isolation test suite).
- Project creation in the hosted model: provisioned by the platform operator on coordinator request (Phase A), or later self-service behind a `can_create_projects` flag. Either way the requesting coordinator becomes the project's first `admin` member and can then invite co-admins.
- GDPR-lean: store minimal PII (username, optional email), deletable accounts (records keep an anonymized operator label).

## 10. Risks / open questions

1. **Scope**: this is a real product (service + dashboard + client changes). Suggest treating collect-earth-cloud as its own repo/release train with an API version contract the Java client pins.
2. **Assignment granularity**: CSV-file-level confirmed as MVP unit. Row-level splitting inside one CSV = later (server can generate derived CSVs, schema supports it via `plots.csv_file_id`).
3. **Registration friction**: operators in the field with poor connectivity must register once online. Acceptable? (Invite URL → browser registration → login inside CE.)
4. **Survey republish drift**: CEP v2 with changed schema vs already-synced XML — mitigation as before (checksum tracking + dashboard warning), plus explicit CEP versioning in Phase D.
5. **Identity migration**: existing projects use free-text operator names; imported/legacy records need mapping to accounts (or an "unclaimed operator" bucket).
6. **Always-on cost**: Cloud SQL is the only always-billing piece; one shared instance for the whole platform (all projects) keeps it ~$30–60/month. Confirm FAO GCP ownership/billing (open from prior plan).
7. **Offline-first unchanged**: all management features degrade gracefully — the client only *requires* the server at join time; collection continues offline with queued sync (prior plan's core property, preserved).
8. **Java 8 client constraint** stands: Apache HttpClient 4.x + Jackson for all new client HTTP.

## 11. What this reuses (verified in code)

- `EarthProjectsService.loadCompressedProjectFile(File)` — CEP import path for join-by-URL (collect-earth-app/.../service/EarthProjectsService.java:282)
- `EarthProperty.SAMPLE_FILE` rewiring — the exact mechanism `CollectEarthTransferHandler`/`KmlImportService` use; KML regeneration follows automatically (`KmlGeneratorService` reads `getCsvFile()` everywhere)
- `applyPropertiesToCollectEarth()` — CEPs can pre-seed `cloud_sync_url`/`cloud_project_id` so even the join flow can be CEP-driven
- `DataMarshaller` XML envelope + LWW/tombstone semantics + queue/listener/properties from the sync plan (partially implemented)
- `XMLDataExportProcess` zip layout as the export contract into Collect/Saiku/IPCC
- `FileDividerToolDlg` — the manual workflow the assignment feature replaces (keep the tool; it becomes unnecessary in cloud projects)
