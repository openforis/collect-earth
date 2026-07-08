# Phase 0 verification

## Automated (green in CI / locally)

| Check | Command | Result |
| --- | --- | --- |
| Full Java reactor builds (all 5 modules + `CollectEarth.jar`) | `mvn clean package -DskipTests -Dgpg.skip=true` | BUILD SUCCESS |
| Cloud record serializer round-trip (marshal → unmarshal) | `mvn test -Dtest=CloudRecordSerializerTest -am -Dsurefire.failIfNoSpecifiedTests=false` | 3/3 pass |
| Server typecheck | `npm run typecheck` (in `collect-earth-cloud`) | exit 0 |
| Server unit + integration suite | `npm test` | 30/30 pass (5 files) |

The server suite covers, via real HTTP where it matters:

- **`e2e.test.ts`** — the exact Phase-0 client sequence over a **real TCP socket** (not `inject`): provision → upload survey idml → gzipped `records:batch` → re-send idempotency → stale rejection → deletion tombstone (soft delete). This proves the `Content-Encoding: gzip` gunzip path works over a genuine connection.
- **`records.test.ts`** — gzip body, LWW (newer wins / older `stale`), two operators on one plot don't clobber, tombstone soft-delete + resurrection, malformed-envelope handling.
- **`isolation.test.ts`** — the §4b.8 tenant gate: authenticated as project A, **every** project-scoped endpoint against project B returns 404.
- **`auth.test.ts`** — invite preview → register → login → `/me`; wrong password / duplicate username / exhausted / invalid invite; operator-can't-invite (403); last-admin removal refused; CEP round-trip.
- **`assignments.test.ts`** — CSV upload (checksum + plot count), assign → `my-assignment` → authorized download, unassigned download 404, re-upload by filename, assignment-set replacement.

## Manual desktop walkthrough (requires Google Earth + a human)

The parts below drive the Swing UI and Google Earth and are not automatable here. Runbook:

### Setup
1. Start the server: `cd collect-earth-cloud && npm run dev` (memory backend; data resets on restart — fine for a smoke test). It listens on `http://localhost:8080`.
2. Provision a project:
   ```bash
   curl -s -X POST http://localhost:8080/v1/projects -H 'content-type: application/json' \
     -d '{"name":"Smoke test"}'
   ```
   Note the `projectId` and `adminToken` (use the admin token on the desktop so the client may also upload the survey).

### A. Manual cloud config + sync
3. Launch Collect Earth (`java -jar collect-earth-app/target/CollectEarth.jar`) with a survey loaded.
4. Tools → Settings → Database: pick **Cloud project**, enter URL `http://localhost:8080`, the `projectId`, and the token. **Test connection** → "Connection OK!". Apply → restart.
5. Collect a plot in the Google Earth balloon and save.
6. Tools → **Cloud sync status…** → within ~30 s "Waiting to sync" drains to 0 and "Synced" increments. (Or click **Sync now**.)
7. Confirm server-side:
   ```bash
   # the record doc exists (in-memory store: check via a second collector or the logs)
   curl -s http://localhost:8080/v1/projects/<pid> -H "authorization: Bearer <adminToken>"
   ```

### B. Offline queue drain
8. Stop the server. Collect 2–3 plots. The sync-status dialog shows them under "Waiting to sync" / "Failed (will retry)" and the app stays responsive (no modal).
9. Start the server again. Within one poll cycle the queue drains to "Synced".

### C. Deletion sync
10. Tools → Utilities → remove a synced plot. A tombstone enqueues; after the next cycle the server soft-deletes it (excluded from default listings, retained with `includeDeleted`).

### D. Join-by-URL (Phase A path)
11. Mint an invite (admin token):
    ```bash
    curl -s -X POST http://localhost:8080/v1/projects/<pid>/invites \
      -H "authorization: Bearer <adminToken>" -H 'content-type: application/json' \
      -d '{"role":"operator","maxUses":5}'
    ```
    Build the URL `http://localhost:8080/join/<inviteToken>`. (Upload a CEP first with `PUT /v1/projects/<pid>/cep` so there is something to download.)
12. In Collect Earth: File → **Join cloud project…** → paste the URL → preview → **Register** (or Log in) → the CEP downloads, the app switches to cloud mode and restarts. The operator field is greyed and seeded with the username; the title bar shows `[Cloud project]`.

## Notes discovered during verification

- **Survey upload is admin-only.** An operator client calling `ensureSurveyUploaded()` gets 403; the client now treats that as "the coordinator manages the survey," marks it done and stops retrying (record sync is unaffected). In Phase A the admin uploads the CEP via the dashboard, so this is the normal case.
