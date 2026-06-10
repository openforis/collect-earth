# Central Sync API Starting Plan

## Purpose

Create an in-repository server-side Firebase Functions project for Collect Earth team synchronization. The desktop app should not connect directly to a shared cloud SQL database. Instead, each Collect Earth client talks to this REST API, and the API owns authentication, project compatibility checks, plot status, conflict detection, and central storage.

## Recommended Stack

Use Firebase Functions, following the same deployment approach already used for Earth Map.

- Node.js 20 Firebase Functions
- Firebase Admin SDK
- Express for REST routing
- Cloud Firestore for durable project, event, plot status, lease, and conflict documents
- Optional Realtime Database later for live presence if lease/status polling is not enough

## Initial Repository Layout

```text
collect-earth-sync-api/
  firebase.json
  README.md
  functions/
    package.json
    index.js
    services/
      syncService.js
```

## First API Scope

Start with only the endpoints needed to prove the local-first sync loop:

- `POST /api/v1/projects/register`: register or validate a project and survey fingerprint.
- `POST /api/v1/sync/events`: upload local client events.
- `GET /api/v1/sync/changes`: download server changes after a cursor.
- `GET /api/v1/plots/status`: fetch plot completion, lock, and conflict status.
- `POST /api/v1/plots/{plotKey}/claim`: claim or renew a temporary editing lease.

Do not build dashboards, administration screens, or advanced merge tools in the first version.

## Minimum Database Tables

Use Firestore collections instead of SQL tables:

- `projects`: project identity, survey fingerprint, name, created date.
- `syncClients`: registered device/user identity.
- `plotStates`: latest server revision and status for each plot.
- `syncEvents`: immutable accepted event log.
- `plotLeases`: temporary editing claims.
- `syncConflicts`: rejected or conflicting updates.

Every event should have a client-generated idempotency key so retrying uploads is safe.

## First Desktop-App Integration

The first Collect Earth change should be small:

1. Add sync settings to local properties: enabled, server URL, project ID, user/device ID.
2. Add a local sync journal table or separate SQLite file.
3. After a successful local save, enqueue a sync event.
4. Run a background worker that uploads events and downloads plot status.
5. Show pending/conflict status without blocking the form.

## First Milestone

The first milestone is not full collaboration. It is this working loop:

1. Collector A saves plot `123` locally.
2. Collector A uploads the event in the background.
3. The API stores the event and marks plot `123` completed or partially filled.
4. Collector B downloads status updates.
5. Collector B sees that plot `123` has already been worked on before opening or saving it.

Once this loop is reliable, add leases, conflict review, and administrator tools.
