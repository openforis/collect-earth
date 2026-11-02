# CE Earth Viewer

Firebase-hosted viewer that Collect Earth opens for a plot. Replaces the GEE app
`users/collectearth/ce_scripts:frames_landsat_v4_tempSegmentation`.

## Run locally
    cd functions && npm install && cd ../web && npm install && cd ..
    # put the EE service-account key in functions/.secret.local (see docs/plans)
    npm --prefix web run build && firebase emulators:start
    # open http://localhost:5000/?geoJson=...&startTime=2000-01-01&endTime=2026-11-01&plot_id=test

## Tests
    npm --prefix functions test            # fast unit tests
    EE_LIVE=1 npm --prefix functions run test:live   # real Earth Engine
    npm --prefix web test

## Deploy
    npm run deploy            # tests, web build, firebase deploy (hosting + functions + firestore rules)
    npm run deploy:preview    # web build + a 7-day Hosting preview channel

`firebase deploy` on its own is also safe: the Hosting `predeploy` hook in
`firebase.json` rebuilds `web/dist` first, so a stale bundle is never shipped.

The `api` function is a 2nd-gen Cloud Function in `europe-west1` with a 300 s
timeout. Firebase Hosting's `/api/**` rewrite proxies to it, but that proxy gives
up after 60 s, which is too short for CCDC and cold time-series requests. In
production the web app therefore calls the function URL directly, with CORS:

- `web/.env.production` sets `VITE_API_BASE` to the function URL. 2nd-gen
  function URLs are deterministic, `https://<region>-<project id>.cloudfunctions.net/<functionId>`,
  so this is `https://europe-west1-ce-earth-viewer.cloudfunctions.net/api`. The
  Express app mounts its routes under `/api`, so a production request looks like
  `https://europe-west1-ce-earth-viewer.cloudfunctions.net/api/api/ccdc` (the
  same doubled segment the emulator's direct function URL has). The file holds no
  secret and is committed; `vite build` bakes it into `web/dist`.
- If the project id (or the function region/name) changes, update **both**
  `.firebaserc` and `web/.env.production` (and `region` in `functions/index.js`).
- In dev and tests `VITE_API_BASE` is unset, so requests stay relative (`/api/...`)
  and go through the Vite proxy or the Hosting emulator rewrite.
- The function answers CORS preflights and echoes an allowed `Origin` in
  `Access-Control-Allow-Origin`. The allowlist is `ALLOWED_ORIGINS` (comma-separated
  origins, e.g. `https://viewer.example.org,https://ce-earth-viewer.web.app`) if that
  environment variable is set on the function; otherwise it is
  `https://<project>.web.app`, `https://<project>.firebaseapp.com` (project from
  `GCLOUD_PROJECT`, set automatically by Cloud Functions) plus `http://localhost:5000`,
  `http://localhost:5173`, `http://127.0.0.1:5000` and `http://127.0.0.1:5173`.
  Set `ALLOWED_ORIGINS` (for example in `functions/.env`) when the app is served
  from a custom domain. Requests from other origins are still processed but get no
  CORS headers, so browsers block the response.
- The Hosting rewrite remains in `firebase.json` as a fallback for same-origin
  calls (`https://ce-earth-viewer.web.app/api/health`, quick manual checks); it just
  cannot carry requests longer than 60 s.

## Cache
API results are cached in the Firestore `cache` collection (one document per
endpoint + plot + dates + extras, written by the Admin SDK only; `firestore.rules`
denies all client access). Tile endpoints expire after 20 hours (EE map ids are
short-lived), series and CCDC results after 30 days (`TTL` in `functions/routes.js`).
Append `?refresh=1` to any API call to skip the cached value and recompute it.
Expired documents are ignored but not deleted: enable a Firestore TTL policy on
the `expiresAt` field of the `cache` collection so they are purged automatically.
