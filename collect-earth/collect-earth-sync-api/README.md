# Collect Earth Sync API

Firebase Functions service for multi-collector synchronization.

## Purpose

This folder contains the central REST API used by Collect Earth clients to exchange local-first collection events, plot status, edit claims, and conflict information. The desktop application should continue saving to its local database first; this API only coordinates background synchronization.

## Local Setup

Install dependencies from the functions folder:

```powershell
cd collect-earth-sync-api/functions
npm install
```

Run the Firebase emulator from `collect-earth-sync-api`:

```powershell
firebase emulators:start --only functions
```

Deploy when the Firebase project is configured:

```powershell
firebase deploy --only functions
```

## Initial API

All endpoints are exposed under the `syncApi` HTTPS function.

- `GET /health`: verifies that the API is running.
- `POST /api/v1/projects/register`: registers or validates a project fingerprint.
- `POST /api/v1/sync/events`: uploads local sync events.
- `GET /api/v1/sync/changes`: downloads server-side changes after a cursor.
- `GET /api/v1/plots/status`: fetches plot status.
- `POST /api/v1/plots/:plotKey/claim`: creates or renews a plot edit lease.

Authentication and Firestore security rules still need to be added before production use.
