# Collect Earth Explorer

Firebase-hosted imagery and time-series window that Collect Earth opens for a plot. Replaces the GEE app
`users/collectearth/ce_scripts:frames_landsat_v4_tempSegmentation`.

Formerly the standalone `ce-earth-viewer` repository. It is deployed to the existing
`collectearth` GCP project (shared with collect-earth-cloud), with its cache in the
Firestore database named `explorer`.

## Run locally
    cd functions && npm install && cd ../web && npm install && cd ..
    # one-time cloud setup and the EE key: docs/setup.md
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
  so this is `https://europe-west1-collectearth.cloudfunctions.net/api`. The
  Express app mounts its routes under `/api`, so a production request looks like
  `https://europe-west1-collectearth.cloudfunctions.net/api/api/ccdc` (the
  same doubled segment the emulator's direct function URL has). The file holds no
  secret and is committed; `vite build` bakes it into `web/dist`.
- If the project id (or the function region/name) changes, update **both**
  `.firebaserc` and `web/.env.production` (and `region` in `functions/index.js`).
- In dev and tests `VITE_API_BASE` is unset, so requests stay relative (`/api/...`)
  and go through the Vite proxy or the Hosting emulator rewrite.
- The function answers CORS preflights and echoes an allowed `Origin` in
  `Access-Control-Allow-Origin`. The allowlist is `ALLOWED_ORIGINS` (comma-separated
  origins, e.g. `https://viewer.example.org,https://collectearth.web.app`) if that
  environment variable is set on the function; otherwise it is
  `https://<project>.web.app`, `https://<project>.firebaseapp.com` (project from
  `GCLOUD_PROJECT`, set automatically by Cloud Functions) plus `http://localhost:5000`,
  `http://localhost:5173`, `http://127.0.0.1:5000` and `http://127.0.0.1:5173`.
  Set `ALLOWED_ORIGINS` (for example in `functions/.env`) when the app is served
  from a custom domain. Requests from other origins are still processed but get no
  CORS headers, so browsers block the response.
- The Hosting rewrite remains in `firebase.json` as a fallback for same-origin
  calls (`https://collectearth.web.app/api/health`, quick manual checks); it just
  cannot carry requests longer than 60 s.

## Customizing per survey
A survey can decide which imagery layers and charts the Explorer shows by adding a `config`
parameter to the address: a URL-encoded JSON document. Without it the standard configuration is
used. Example:

```json
{
  "v": 1,
  "layers": [
    { "type": "sentinel2", "bands": "true-colour" },
    { "type": "sentinel2", "label": "Dry season 2019", "start": "2019-06-01", "end": "2019-09-30", "maxCloud": 30 },
    { "type": "landsat", "label": "Landsat", "years": [2000, 2024], "year": 2015 }
  ],
  "charts": [
    { "type": "landsat-series", "index": "NBR" },
    { "type": "sentinel2-series", "name": "NDRE", "formula": "(nir - rededge1) / (nir + rededge1)" },
    { "type": "modis", "index": "EVI", "collapsed": true },
    { "type": "ccdc", "band": "NDVI" }
  ]
}
```

- `layers` is the layers panel in order (the first opens first); `charts` is the chart cards in order.
  Leaving out one of the two keeps the standard list for it; `"charts": []` shows no charts.
- A type can be listed more than once with different parameters.
- In the layers panel each imagery row has a band selector (false or true colour) and a year
  slider. Landsat's `years` limits its slider and `year` is where it starts. Sentinel-2 takes the
  same two (from 2016); its slider ends with a stop for the last 12 months, where it starts
  without `year`. A Sentinel-2 entry with `start` and `end` is that fixed window, without a slider,
  and cannot also have `year` or `years`.
- `sentinel1` is a yearly Sentinel-1 radar composite (median VV and VH backscatter, which sees
  through cloud), with `label`, `years` and `year` (from 2015) like Landsat and `bands`:
  `"false-colour"` (VV, VH and their difference as red, green and blue; the default), `"vv"` or
  `"vh"` (one polarisation in grey).
- `sentinel1-series` charts the plot's mean Sentinel-1 backscatter in dB for each acquisition:
  `band` `"VH"` (the default) or `"VV"`, plus the analysis switches below and `collapsed`. It is
  in the standard configuration, collapsed, so it costs nothing until opened.
- `precipitation` charts monthly rainfall in mm at the plot (ERA5-Land, a global grid of about
  11 km, so it is the rainfall of the area rather than of the plot), as bars. It takes the analysis
  switches below, all off by default, and `collapsed`; it is in the standard configuration,
  collapsed.
- `hls-series` (not in the standard configuration) charts an index from NASA's Harmonized Landsat
  Sentinel-2: Landsat 8/9 and Sentinel-2 combined into one consistent 30 m series, an image every
  2-3 days since 2015 (Landsat only from 2013). It takes the same parameters as `landsat-series`;
  "Compare years" uses the configuration's Landsat layer and is left out without one.
- `modis` also takes `rainfall` (true or false, default false): whether the chart starts with the
  monthly rainfall drawn as bars under it. The chart's Rain switch turns it on and off, remembered
  like the analyses.
- An entry that is not understood is skipped and a notice is shown; the rest still works.
- Types, parameters, allowed values and defaults: `functions/catalogue.json`, served at
  `GET /api/catalogue`.
- The Landsat, Sentinel-2, HLS, MODIS and Sentinel-1 charts take `median`, `trend`, `change`, `unusual` and
  `season` (true or false): which analyses are switched on when the chart opens. Only `trend` is on
  by default (none on the rainfall chart). The Landsat, Sentinel-2 and HLS ones also take `maxCloud` (`"any"`, `"80"`, `"60"`, `"40"`,
  `"20"`, `"10"`; default `"40"`), the scene cloud limit the chart starts with. The user can still
  change all of these; the browser remembers the choice, separately for a survey that sets its own
  start value.
- Index charts take a named `index` (NDVI, EVI, EVI2, SAVI, MSAVI, GNDVI, NDMI, NBR, NBR2, NDWI,
  MNDWI, NDSI, NDBI, BSI) or a `formula` with a `name`. A formula may use numbers, `+ - * /`,
  parentheses, `sqrt abs min max pow` and the bands `blue green red nir swir1 swir2` as 0 to 1
  reflectance; Sentinel-2 adds `rededge1 rededge2 rededge3`. Landsat and HLS are surface reflectance and
  Sentinel-2 is top of atmosphere, so the same index reads somewhat differently on the two.

Ready-made documents ("starting points": deforestation, fire, cloudy tropics, drylands) are in
`catalogue.json` `presets`.

### The configuration editor (`/configure`)
`/configure?config=<URL-encoded document>&geoJson=<plot for the preview>&lang=<en|es|fr|pt|tr>` is a
page that edits this document, with a live preview of the Explorer beside it (on `geoJson`, else a
sample plot in Rondônia). It is meant to be embedded in an iframe by the dashboard and Collect Earth,
which keep their own Save and Cancel. It reads its input from the address only. When framed, on load
and after every change, it posts to the parent window (target origin `"*"`: the document is not
secret and hosts run at unknown origins):

```js
{ source: "collect-earth-explorer", type: "config", config: "<text to store>", valid: true }
```

`config` is compact JSON without defaults or blank values, `""` for the standard configuration, at
most 2000 characters; `valid` is false while a field is refused or the text is too long, and the host
should not save then.

`lang` (any page) sets the interface language when the host's differs from the browser's.
The preview opens the Explorer with `preview=1`, which keeps its remembered choices in memory only, so
the person's own remembered view, folds and analysis switches are neither used nor changed.

The address takes two forms. Query: `/?geoJson=…&startTime=…&endTime=…&plot_id=…&config=…`.
Fragment, as Collect Earth builds it: `/#geoJson=…;plotId=…;startTime=…;endTime=…;config=…;`
(each value URL-encoded).

Collect Earth may add `next` (fragment `next=…;`, query `&next=…`): the next plot's outline, in the
same form as `geoJson`. Once the current plot's requests have settled but perhaps the slowest (2 s with at most one in flight),
the page requests the next plot's open charts and first imagery layer, one at a time with CCDC last, and downloads
the imagery tiles on and around the plot (at most 12), so the next plot loads from the server's store and the
browser's cache. Nothing is shown; a missing or unreadable `next` just means no warming.

## Cache
API results are cached in the Firestore `cache` collection (one document per
endpoint + plot + dates + extras, written by the Admin SDK only; `firestore.rules`
denies all client access). Tile endpoints expire after 20 hours (EE map ids are
short-lived), series and CCDC results after 30 days (`TTL` in `functions/routes.js`).
"No imagery" (404) answers are cached for an hour.
Expired documents are ignored but not deleted: enable a Firestore TTL policy on
the `expiresAt` field of the `cache` collection so they are purged automatically.
