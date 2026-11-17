# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A companion app to Collect Earth 2.0: the Google Earth Engine ancillary window that Collect Earth opens
for each plot, with a URL like `/?geoJson=...&startTime=YYYY-MM-DD&endTime=YYYY-MM-DD&plot_id=...`.
It replaces the GEE app `users/collectearth/ce_scripts:frames_landsat_v4_tempSegmentation`.

Product goal: let users customize this window to fit their survey and needs. A survey passes a
configuration document in the address (`config`), listing imagery layers and chart cards from the
catalogue with their parameters; without one the standard configuration applies. See "Customization"
below and the README. The cloud dashboard editor and the desktop pass-through are not built yet
(`docs/plans/2026-11-16-explorer-customization.md`, "Follow-on plans").

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

Endpoints: `tiles/sentinel2`, `tiles/landsat`, `tiles/scene`, `series/modis`, `series/landsat`, `series/sentinel2`, `ccdc`, and `GET /api/catalogue`.

### Layering in `functions/`
- `lib/` — pure, EE-free logic (validation, sensors per year, QA bits, CCDC response shaping, CORS allowlist, errors). Unit-tested next to the source (`lib/*.test.js`).
- `ee/` — Earth Engine code. Use `ee/promise.js` (`evaluate`, `getTileUrl`) to promisify EE callbacks and `ee/eeError.toError` for errors. `ee/vendor/temporalSegmentation.js` is a vendored copy of Daniel Wiell's CCDC segmentation library — don't refactor it.
- `test/` — supertest/unit tests with injected fakes (routes take an injectable `cache`; `createApp` takes an injectable `env`); `test/live/` needs real EE.

### Error contract
All errors are `{ error: { code, message, retryable } }` (`app.js` `errorToResponse`). EE messages matching transient patterns become 503 `ee_busy` with `retryable: true`; messages mentioning the key are masked. The web client (`web/src/lib/api.ts` `ApiFailure`, `isRetryable`) shows a Retry button only for retryable errors — keep both sides in sync.

### Production API URL / CORS (non-obvious)
Firebase Hosting's `/api/**` rewrite times out at 60 s, too short for CCDC/cold series (function timeout is 300 s). So in production the browser calls the function URL directly: `web/.env.production` sets `VITE_API_BASE`, giving URLs like `.../cloudfunctions.net/api/api/ccdc` (the doubled `/api` is intentional). In dev/tests `VITE_API_BASE` is unset and requests stay relative. If project id, region or function name change, update `.firebaserc`, `web/.env.production`, `region` in `functions/index.js` and the rewrite in `firebase.json` together. CORS allowlist: `ALLOWED_ORIGINS` env var, else the project's `web.app`/`firebaseapp.com` plus localhost:5000/5173.

### Customization
- `functions/catalogue.json` is the single source: layer and chart types with their parameters and defaults, the named indices (formulas), the band names a formula may use per sensor, and the standard configuration. The API requires it (`lib/catalogue.js` `paramOf`) and serves it; the web app imports the same file at build time (`web/src/lib/config.ts`).
- `web/src/lib/config.ts` `resolveConfig` turns the address's `config` into layer and chart entries (`{ type, params }`, defaults filled in). It never fails: a bad document, half or entry falls back to the standard configuration or is skipped, with a notice shown above the charts. Its checks mirror `paramOf` and `lib/formula.js`; the server is the authority, so change both sides together.
- API parameters are validated per endpoint and are part of the cache key (`extras`). `extras` holds only non-default values (`nonDefault` in `routes.js`), so a standard request keeps the key it always had. Keep it that way when adding a parameter.
- `lib/formula.js` `checkFormula` is the only gate between a custom index formula from the address and `ee.Image.expression`. It allows numbers, the sensor's band names, `+ - * /`, parentheses, commas and `sqrt abs min max pow`. Do not loosen it or route a formula around it.
- Adding a type: an entry in `catalogue.json`, an Earth Engine function and a route; for a layer a branch in `useLayerTiles` and a label in `LayersPanel`, for a chart a card and a line in `CARDS` (`App.tsx`). Adding a named index is one line in `catalogue.json` `indices`.

### Web app
- `lib/urlParams.ts` parses the Collect Earth URL, from the query (`?geoJson=…&plot_id=…`) or the fragment Collect Earth builds (`#geoJson=…;plotId=…;config=…;`); `main.tsx` reloads on `hashchange` because Collect Earth reuses one tab. Its `toPolygon` mirrors the backend's (same ~55 m square for Points) so map and API agree.
- `lib/prewarm.ts` warms the next plot (the address's optional `next`): `api.ts` `whenIdle` fires once at most one `postApi` request (the slow CCDC) has been in flight for 2 s, then it sends the open charts' and first layer's requests one at a time and fetches up to 12 tiles at the zoom `MapView` opens with. Bodies come from `chartRequest` (`config.ts`) and `layerRequest` (`LayerSources.ts`), the same builders the cards and the map use, so the server keys match; keep it that way.
- `state/PlotContext.tsx` holds all UI state (the configuration's layers and charts, active layer, one year and one band combination per entry, selected scene, compare mode/layer). A Sentinel-2 entry's year is a calendar year or `LAST_12_MONTHS` (the API's default composite, sent without a window); one with a fixed `start`/`end` has none. Each imagery row of `LayersPanel` has a band selector and, unless its window is fixed, a debounced year slider; each side of Compare follows its own row. A layer id is an entry's position, or `"scene"`. Clicking a chart point sets a scene, which switches the map layer.
- `hooks/useApi.ts` is the single fetch primitive: aborts stale requests, keeps previous `data` while reloading, `enabled` option to pause, `retry()`. `components/LayerSources.ts` `useLayerTiles` wraps it for map tiles; chart cards use it for series.
- Chart cards (Plotly, several MB) are `React.lazy`-loaded in `App.tsx` so the map paints first. Tests mock MapLibre with `src/test/fakeMaplibre.ts`.
