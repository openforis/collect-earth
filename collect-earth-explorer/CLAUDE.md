# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A companion app to Collect Earth 2.0: the Google Earth Engine ancillary window that Collect Earth opens
for each plot, with a URL like `/?geoJson=...&startTime=YYYY-MM-DD&endTime=YYYY-MM-DD&plot_id=...`.
It replaces the GEE app `users/collectearth/ce_scripts:frames_landsat_v4_tempSegmentation`.

Product goal: let users customize this window to fit their survey and needs. The code does not do that
yet. The imagery layers (`state/PlotContext.tsx` `LayerId`), the chart cards (`App.tsx`) and the API
endpoints (`functions/routes.js`) are all hard-coded. Treat them as the defaults that a survey's
configuration would build on, not as a fixed set.

Two packages, no workspace tooling:

- `functions/` — CommonJS Node 22 Express API (2nd-gen Cloud Function `api`, `europe-west1`) that runs Earth Engine computations.
- `web/` — React 19 + TypeScript + Vite SPA (MapLibre map, Plotly charts).

Design and implementation plans (with later amendments) live in `docs/plans/`; one-time GCP/Firebase setup in `docs/setup.md`.

## Commands

From the repo root:

    npm test                                   # functions + web tests
    npm run emulate                            # build web, then firebase emulators:start (app at http://localhost:5000)
    npm run deploy                             # tests, build, firebase deploy (hosting + functions + rules)
    npm run deploy:preview                     # 7-day Hosting preview channel

Functions (`node:test`, no framework):

    npm --prefix functions test                            # unit tests: test/*.test.js and lib/**/*.test.js
    node --test functions/lib/plotRequest.test.js          # single file
    node --test --test-name-pattern="<name>" <file>        # single test
    EE_LIVE=1 npm --prefix functions run test:live         # hits real Earth Engine; skipped unless EE_LIVE is set

Web (vitest + jsdom + Testing Library, oxlint):

    npm --prefix web test                       # vitest run
    cd web && npx vitest run src/lib/api.test.ts -t "<name>"   # single file / single test
    npm --prefix web run lint                   # oxlint
    npm --prefix web run build                  # tsc -b && vite build -> web/dist
    npm --prefix web run dev                    # Vite dev server; /api proxied to the Hosting emulator on :5000

The EE key: the function reads the `EE_KEY` secret (service-account JSON). Locally it comes from
`functions/.secret.local` (single unquoted line `EE_KEY={...}`, git-ignored); live tests load it via
`test/live/loadSecret.js`. `EE_PROJECT` optionally overrides the key's `project_id`.

## Architecture

### Request flow
`functions/index.js` lazily builds the app from `app.js` (CORS, JSON body, `/api/health`, 404, error
middleware) plus `routes.js`. Every data endpoint is a `POST /api/...` built with `plotRoute()`:

1. `lib/plotRequest.parsePlotRequest(body)` normalises the plot (Polygon/LineString/MultiLineString/Point → single-ring Polygon, max 100 ha) and clamps dates; optional `validate` hook. Bad input throws `BadRequest` (400) before cache or EE.
2. `extrasOf(body)` builds endpoint-specific params (Landsat `year`, scene `sensor`/`timeStart`, CCDC `band`); these are part of the cache key.
3. `cache.withCache` (Firestore `cache` collection, key from `lib/cacheKey`) → on miss `eeAuth()` then the `ee/*` compute function. `?refresh=1` skips the read. Tile endpoints use `ignoreStart` (cache key ignores `start`). TTLs in `routes.js`: tiles 20 h, series/CCDC 30 days. Cache errors never fail a request.

Endpoints: `tiles/sentinel2`, `tiles/landsat`, `tiles/scene`, `series/modis`, `series/landsat`, `series/sentinel2`, `ccdc`.

### Layering in `functions/`
- `lib/` — pure, EE-free logic (validation, sensors per year, QA bits, CCDC response shaping, CORS allowlist, errors). Unit-tested next to the source (`lib/*.test.js`).
- `ee/` — Earth Engine code. Use `ee/promise.js` (`evaluate`, `getTileUrl`) to promisify EE callbacks and `ee/eeError.toError` for errors. `ee/vendor/temporalSegmentation.js` is a vendored copy of Daniel Wiell's CCDC segmentation library — don't refactor it.
- `test/` — supertest/unit tests with injected fakes (routes take an injectable `cache`; `createApp` takes an injectable `env`); `test/live/` needs real EE.

### Error contract
All errors are `{ error: { code, message, retryable } }` (`app.js` `errorToResponse`). EE messages matching transient patterns become 503 `ee_busy` with `retryable: true`; messages mentioning the key are masked. The web client (`web/src/lib/api.ts` `ApiFailure`, `isRetryable`) shows a Retry button only for retryable errors — keep both sides in sync.

### Production API URL / CORS (non-obvious)
Firebase Hosting's `/api/**` rewrite times out at 60 s, too short for CCDC/cold series (function timeout is 300 s). So in production the browser calls the function URL directly: `web/.env.production` sets `VITE_API_BASE`, giving URLs like `.../cloudfunctions.net/api/api/ccdc` (the doubled `/api` is intentional). In dev/tests `VITE_API_BASE` is unset and requests stay relative. If project id, region or function name change, update `.firebaserc`, `web/.env.production`, `region` in `functions/index.js` and the rewrite in `firebase.json` together. CORS allowlist: `ALLOWED_ORIGINS` env var, else the project's `web.app`/`firebaseapp.com` plus localhost:5000/5173.

### Web app
- `lib/urlParams.ts` parses the Collect Earth URL; its `toPolygon` mirrors the backend's (same ~55 m square for Points) so map and API agree.
- `state/PlotContext.tsx` holds all UI state (active layer, Landsat year, selected scene, compare mode/layer). Clicking a chart point sets a scene or Landsat year, which switches the map layer.
- `hooks/useApi.ts` is the single fetch primitive: aborts stale requests, keeps previous `data` while reloading, `enabled` option to pause, `retry()`. `components/LayerSources.ts` `useLayerTiles` wraps it for map tiles; chart cards use it for series.
- Chart cards (Plotly, several MB) are `React.lazy`-loaded in `App.tsx` so the map paints first. Tests mock MapLibre with `src/test/fakeMaplibre.ts`.
