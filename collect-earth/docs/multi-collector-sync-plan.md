# Multi-Collector Synchronization Plan

## Goal

Make Collect Earth practical for teams collecting the same project at the same time without making form entry depend on a slow cloud database round trip. The application should remain local-first: every form save writes to the local Collect Earth database immediately, while a background sync layer exchanges changes, plot status, and conflict information with a central service.

## Current Baseline

The active form flow is local and synchronous:

- `PlacemarkDataController.saveDataExpanded(...)` receives form updates from the local embedded server.
- `AbstractPlacemarkDataController.processCollectedData(...)` calls `DataAccessor.updateData(...)`.
- `CollectDataAccessor` delegates to `AbstractEarthSurveyService.updatePlacemarkData(...)`.
- `AbstractEarthSurveyService` saves records through Collect's `RecordManager`.
- `PlacemarkUpdateServlet` reports locally changed placemarks to Google Earth for icon/status updates.

This path should stay fast and local. Synchronization should be attached after successful local writes, not inserted into the form save transaction.

## Recommended Architecture

Use a local-first, asynchronous sync service.

1. Local Save
   The existing save path writes to the local Collect Earth database and returns to the form immediately.

2. Local Sync Journal
   After a successful local save, Collect Earth writes a compact event to a local sync store. Prefer a separate SQLite file, such as `collectEarthSync.db`, to avoid modifying Collect's managed schema.

3. Background Sync Worker
   A worker thread uploads pending events and downloads remote status updates on a short interval. Network failures leave events pending and do not block collection.

4. Central Sync API
   Use the in-repository Firebase Functions API backed by Firestore instead of direct client connections to a shared SQL database. The API validates project identity, user identity, record revisions, permissions, and conflicts.

5. Local Remote-Status Cache
   The client stores downloaded plot status locally so Google Earth icons and forms can show what other collectors have done even when the network is intermittent.

## Local Data Model

Add a small sync store with these tables:

- `ce_sync_event`: `event_id`, `project_id`, `survey_fingerprint`, `plot_key`, `operation`, `base_revision`, `payload_json`, `created_at`, `attempt_count`, `last_error`, `status`.
- `ce_sync_checkpoint`: `project_id`, `last_server_cursor`, `last_successful_sync_at`.
- `ce_remote_plot_status`: `plot_key`, `server_revision`, `status`, `completed_by`, `completed_at`, `locked_by`, `lock_expires_at`, `updated_at`.
- `ce_sync_conflict`: `plot_key`, `local_event_id`, `server_revision`, `server_payload_json`, `detected_at`, `resolution_status`.

The first payload format can be full-record JSON generated from `PlacemarkLoadResult` or Collect record values. A later optimization can switch to field-level changes.

## Central Data Model

The Firebase backend should store these Firestore collections:

- `projects`: projects and compatible survey/model fingerprints;
- `syncClients`: users/devices and collection teams;
- `plotStates`: current plot state by `project_id + plot_key`;
- `syncEvents`: immutable record event history;
- `plotLeases`: lock/lease documents for active editing;
- `syncConflicts`: conflict documents for records rejected by optimistic revision checks.

Each accepted event increments a server revision. Clients upload with their known `base_revision`; the server accepts matching revisions and rejects stale revisions with a conflict response.

## Plot Status and Team Feedback

Expose lightweight endpoints for status:

- `POST /sync/events`: upload local events.
- `GET /sync/changes?projectId=...&cursor=...`: download accepted remote events and status changes.
- `POST /plots/{plotKey}/claim`: claim or renew an editing lease.
- `GET /plots/status?projectId=...&updatedSince=...`: fetch completed, in-progress, locked, and conflicted plots.

Extend the local app so `PlacemarkUpdateServlet` combines local record summaries with `ce_remote_plot_status`. This allows Google Earth icons to show remote completion and in-progress states. Extend `PlacemarkLoadResult` with optional collaboration metadata, such as `completedBy`, `completedAt`, `lockedBy`, `remoteRevision`, and `conflictStatus`, so the form can warn before editing an already completed or claimed plot.

## Conflict Strategy

Start with plot-level optimistic concurrency.

- If no one else changed the plot since the client's `base_revision`, accept the upload.
- If another collector completed or changed the plot first, keep the local save, mark the event as conflicted, and show a conflict warning.
- If a user is offline, allow local collection but mark claims as offline/unverified.
- Do not silently overwrite another collector's completed plot.

Later, add field-level merge for non-overlapping edits if the survey model can identify stable field paths reliably.

## Implementation Phases

### Phase 1: Design Spike

- Define `SyncEvent`, `PlotSyncStatus`, and `SyncConflict` model classes.
- Decide how to serialize Collect records and survey fingerprints.
- Add local sync configuration to `LocalPropertiesService`: sync enabled, server URL, team/project ID, user/device ID, and sync interval.
- Build a tiny in-process fake sync server for development tests.

### Phase 2: Local Journal

- Add a sync store service in `collect-earth-app`, for example `PlotSyncJournalService`.
- Hook successful saves in `AbstractPlacemarkDataController.afterPlacemarkUpdate(...)` or immediately after `processCollectedData(...)`.
- Record create, partial update, submit/actively-saved, add-entity, and delete-entity operations.
- Keep form response behavior unchanged.

### Phase 3: Background Worker

- Add `PlotSyncService` with upload, download, retry, and checkpoint handling.
- Start and stop it from the desktop application lifecycle.
- Add visible sync status in the main window: online, offline, pending uploads, conflicts.
- Log sync failures without interrupting collection.

### Phase 4: Central API

- Implement the sync API in `collect-earth-sync-api` using Firebase Functions.
- Use Firestore collections for projects, clients, plot status, events, leases, and conflicts.
- Add Firebase Authentication or signed service tokens before production use.
- Add project/survey fingerprint validation so incompatible clients cannot sync into the same project.

### Phase 5: Team Awareness

- Merge remote status into `PlacemarkUpdateServlet` so Google Earth icons reflect other collectors.
- Add form warnings when a plot is completed, claimed, or conflicted.
- Add claim/lease renewal when a user opens or edits a plot.
- Add a simple conflict review screen or export report.

### Phase 6: Hardening

- Add integration tests for offline save, delayed upload, conflict rejection, duplicate event replay, and status download.
- Add database migration/version checks for the local sync store.
- Add telemetry/logging for sync latency, failed uploads, and conflict counts.
- Add import/export tools for sync diagnostics.

## Key Engineering Decisions

- Do not use a shared cloud SQL database directly from the form path.
- Do not block local saves on network availability.
- Use idempotent event IDs so retries are safe.
- Treat the server as authoritative for team status and revision order.
- Keep local Collect data usable even if synchronization is disabled.

## Open Questions

- What is the stable project identity: survey URI, generated date, IDM checksum, CSV checksum, or a new project UUID?
- Should teams require explicit plot claiming, or only warn when another collector has already completed a plot?
- Should completed plots be read-only by default, or editable with an override?
- Which central service stack should be used for v2: Java/Spring to match the app, or a smaller independent API service?
- How should administrators resolve conflicts: in Collect Earth, in a web dashboard, or by exporting conflict reports?
