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

## Cache
API results are cached in the Firestore `cache` collection (one document per
endpoint + plot + dates + extras, written by the Admin SDK only; `firestore.rules`
denies all client access). Tile endpoints expire after 20 hours (EE map ids are
short-lived), series and CCDC results after 30 days (`TTL` in `functions/routes.js`).
Append `?refresh=1` to any API call to skip the cached value and recompute it.
Expired documents are ignored but not deleted: enable a Firestore TTL policy on
the `expiresAt` field of the `cache` collection so they are purged automatically.
