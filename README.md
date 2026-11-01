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
