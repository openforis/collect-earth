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

1. `lib/plotRequest.parsePlotRequest(body)` normalises the plot (Polygon/LineString/MultiLineString/Point → single-ring Polygon, max 100 ha, 500 vertices, 0.1° extent, no self-crossing) and clamps dates; optional `validate` hook. Bad input throws `BadRequest` (400) before cache or EE.
2. `extrasOf(body)` builds endpoint-specific params (Landsat `year`, scene `sensor`/`timeStart`, CCDC `band`); these are part of the cache key.
3. `cache.withCache` (Firestore `cache` collection, key from `lib/cacheKey`) → on miss `eeAuth()` then the `ee/*` compute function. Concurrent identical computes in one instance share one promise; a NotFound (404) is cached for 1 h. The key drops dates a result does not use (`ignore`: Sentinel-2 composite ignores `start`, Landsat and Sentinel-1 composites and scenes both dates). TTLs in `routes.js`: tiles 20 h, series/CCDC 30 days. Cache errors never fail a request.

Endpoints: `tiles/sentinel2`, `tiles/landsat`, `tiles/sentinel1`, `tiles/scene`, `series/modis`, `series/landsat`, `series/sentinel2`, `series/sentinel1`, `series/precipitation` (ERA5-Land monthly rainfall at the plot centroid), `ccdc`, `tiles/difference`, and `GET /api/catalogue`. `tiles/difference` takes `left` and `right`, each `{ path, ...fields }` with `path` one of `tiles/landsat`, `tiles/sentinel2`, `tiles/scene` and that endpoint's own fields (`bands` ignored); each side is validated by its endpoint's hooks and built as the image that endpoint shows (`TILE_SOURCES` in `routes.js`), and the tiles are NDVI(right) − NDVI(left) (`ee/difference.js`). Sentinel-1 (`ee/sentinel1.js`, `COPERNICUS/S1_GRD`, IW with VV+VH) is a yearly radar composite and a per-acquisition backscatter series averaged in linear power, returned in dB.

### Layering in `functions/`
- `lib/` — pure, EE-free logic (validation, sensors per year, QA bits, CCDC response shaping, CORS allowlist, errors). Unit-tested next to the source (`lib/*.test.js`).
- `ee/` — Earth Engine code. Use `ee/promise.js` (`evaluate`, `getTileUrl`) to promisify EE callbacks and `ee/eeError.toError` for errors. `ee/vendor/temporalSegmentation.js` is a vendored copy of Daniel Wiell's CCDC segmentation library — don't refactor it.
- `test/` — supertest/unit tests with injected fakes (routes take an injectable `cache`; `createApp` takes an injectable `env`); `test/live/` needs real EE.

### Error contract
All errors are `{ error: { code, message, retryable } }` (`app.js` `errorToResponse`). EE messages matching transient patterns become 503 `ee_busy` with `retryable: true`; messages mentioning the key are masked. The web client (`web/src/lib/api.ts` `ApiFailure`, `isRetryable`) shows a Retry button only for retryable errors — keep both sides in sync.

### Production API URL / CORS (non-obvious)
Firebase Hosting's `/api/**` rewrite times out at 60 s, too short for CCDC/cold series (function timeout is 300 s). So in production the browser calls the function URL directly: `web/.env.production` sets `VITE_API_BASE`, giving URLs like `.../cloudfunctions.net/api/api/ccdc` (the doubled `/api` is intentional). In dev/tests `VITE_API_BASE` is unset and requests stay relative. If project id, region or function name change, update `.firebaserc`, `web/.env.production`, `region` in `functions/index.js` and the rewrite in `firebase.json` together. CORS allowlist: `ALLOWED_ORIGINS` env var, else the project's `web.app`/`firebaseapp.com` plus localhost:5000/5173.

Browser caching (`firebase.json` `hosting.headers`): `/assets/**` (content-hashed names) is `public, max-age=31536000, immutable`; everything else, including the page served by the SPA rewrite, is `no-cache` so a release shows at once. All matching rules apply in order and the last wins, so `**` stays first. The Windows Hosting emulator applies no `headers` at all (superstatic's `glob-slash` makes backslash globs), so check them on Linux or a preview channel.

### Customization
- `functions/catalogue.json` is the single source: layer and chart types with their parameters and defaults, the named indices (formulas), the band names a formula may use per sensor, and the standard configuration. The API requires it (`lib/catalogue.js` `paramOf`) and serves it; the web app imports the same file at build time (`web/src/lib/config.ts`).
- `web/src/lib/config.ts` `resolveConfig` turns the address's `config` into layer and chart entries (`{ type, params }`, defaults filled in). It never fails: a bad document, half or entry falls back to the standard configuration or is skipped, with a notice shown above the charts. Its checks mirror `paramOf` and `lib/formula.js`; the server is the authority, so change both sides together.
- API parameters are validated per endpoint and are part of the cache key (`extras`). `extras` holds only non-default values (`nonDefault` in `routes.js`), so a standard request keeps the key it always had. Keep it that way when adding a parameter. When a result's shape changes, version the endpoint name used for the key instead (`series/landsat@cloud`, `series/sentinel2@cloud` since their points gained `cloud`), so old answers are not served; the URL stays the same.
- `lib/formula.js` `checkFormula` is the only gate between a custom index formula from the address and `ee.Image.expression`. It allows numbers, the sensor's band names, `+ - * /`, parentheses, commas and `sqrt abs min max pow`. Do not loosen it or route a formula around it.
- Adding a type: an entry in `catalogue.json`, an Earth Engine function and a route; for a layer a branch in `useLayerTiles` and a label in `LayersPanel`, for a chart a card and a line in `CARDS` (`App.tsx`). Adding a named index is one line in `catalogue.json` `indices`.

### Web app
- `lib/urlParams.ts` parses the Collect Earth URL, from the query (`?geoJson=…&plot_id=…`) or the fragment Collect Earth builds (`#geoJson=…;plotId=…;config=…;`); `main.tsx` reloads on `hashchange` because Collect Earth reuses one tab. Its `toPolygon` mirrors the backend's (same ~55 m square for Points) so map and API agree.
- `lib/prewarm.ts` warms the next plot (the address's optional `next`): `api.ts` `whenIdle` fires once at most one `postApi` request (the slow CCDC) has been in flight for 2 s, then it sends, one at a time, the requests of the charts the stored folds leave open and of the remembered view (its layer at its year and bands; when comparing also the other side, or the difference) and fetches up to 12 tiles per tile layer at the zoom `MapView` opens with. Bodies come from `chartRequest` (`config.ts`), `layerRequest` and `tileSide` (`LayerSources.ts`), the same builders the cards and the map use, so the server keys match; keep it that way.
- `state/PlotContext.tsx` holds all UI state (the configuration's layers and charts, active layer, one year and one band combination per entry, selected scene, compare mode/layer). A Sentinel-2 entry's year is a calendar year or `LAST_12_MONTHS` (the API's default composite, sent without a window); one with a fixed `start`/`end` has none. Each imagery row of `LayersPanel` has a band selector and, unless its window is fixed, a debounced year slider; each side of Compare follows its own row. A layer id is an entry's position, or `"scene"`. Clicking a chart point sets a scene, which switches the map layer. A chart's change result can start a comparison (`compareAround`: an entry's composites of the year before and after; `compareScenes`: two scenes): the right-hand side then shows `compareYear` or `compareScene` instead of its row's year or the selected scene, until the Compare controls are used. While comparing, the Difference checkbox (`difference`, cleared with Compare; disabled for Sentinel-1 or the same image on both sides) replaces the swipe with one map of the NDVI change: `useDifferenceTiles` posts both sides as `tileSide` (`LayerSources.ts`) builds them, the same code `useLayerTiles` sends.
- The view is remembered between plots (Collect Earth reloads the page per plot): `state/view.ts` `storedView` reads `explorer.view.<hash of the configuration's layers>` (active layer, each entry's year and bands, Compare, compare layer, Difference) and checks each part (an outdated or broken value falls back to the default; a year is clamped into the new plot's range). A scene, `compareYear` and `compareScene` are never stored; a `"scene"` side stores the last entry layer. Card folds: `lib/folds.ts` `useFold`, used by all six cards, keeps the user's choice in `explorer.folds.<hash of the configuration's charts>` (`{"<position>:<type>": open}`), overriding the entry's `collapsed`; a folded card requests nothing until first opened, and keeps its data when folded again. Tests clear localStorage after each test (`src/test/setup.ts`).
- `components/Summary.tsx` shows one line per open Landsat/Sentinel-2 series chart above the charts (trend, a significant change year, the last image's date; `seriesStats.ts` `summarize`), from what the card publishes with `usePublishSummary` (`charts/cloudFilter.tsx`, on the cloud-filtered points) into `PlotContext` `summaries`; it makes no request. Each line scrolls to its card (`#chart-<position>`).
- `hooks/useApi.ts` is the single fetch primitive: aborts stale requests, keeps previous `data` while reloading, `enabled` option to pause, `retry()`. `components/LayerSources.ts` `useLayerTiles` wraps it for map tiles; chart cards use it for series.
- `SeriesChart` analyses its points in the browser (`lib/seriesStats.ts`, pure): a yearly median (per UTC calendar year, at 1 July, from 3 years), a trend on those medians (Mann-Kendall p, Theil-Sen slope, from 8 years; red when p < 0.05), a change year (Pettitt test on the medians, from 8 years, with Scene before/after buttons), unusually low observations (below their month's median by more than 2.5 robust standard deviations, from 24 points; coloured on trace 0, never a separate trace) and a seasonal profile (a second small Plot, from 6 months with 3 observations). Each has a checkbox; `lib/prefs.ts` `usePref` keeps the choices (`explorer.median`, `.trend`, `.change`, `.unusual`, `.season`) and the Landsat/Sentinel-2 cards' scene cloud limit (`explorer.maxCloud`, `charts/cloudFilter.tsx`; points carry the API's `cloud`) in localStorage, shared live by all charts. The chart entry's parameters of the same names (`median` … `season`, `maxCloud`, in `catalogue.json`) are the start values; one that differs from the standard is stored under `<key>.survey`, so a choice made under the standard does not override a survey's. Like `collapsed`, they never reach the API.
- `SeriesChart` takes optional `bars` (a bar trace on a right-hand `y2` axis, appended after trace 0) and `bar` (trace 0 as bars, for the rainfall card). The MODIS card's Rain switch (`rainfall` param, pref `explorer.rain`) requests `series/precipitation` through `chartRequest` only while on, and passes it as `bars`; it is never pre-warmed.
- Languages: `lib/i18n.ts` holds the interface in English, Spanish, French, Portuguese and Turkish (one flat dictionary each, no library) with `t(key, params)` (`{name}` placeholders; a sentence is one key, never assembled from fragments) and `tn` for counts (`Intl.PluralRules`). The language is the browser's: the first of `navigator.languages` whose primary subtag is one of the five, else English; chosen once at load (`lang`, also set as `<html lang>`), no switcher or stored choice. Every new user-visible text needs a key in all five; `i18n.test.ts` fails on a missing or extra key, an empty text or a lost placeholder (it cannot tell that a translation still matches a changed English text: update all five). Product and data names (Landsat, Sentinel-2, NDVI, CCDC…), dates (ISO), decimals (a dot) and CSV contents/file names stay as they are. Month names come from `Intl` (`monthNames`); Plotly gets a locale registered in `Plot.tsx` (`CONFIG.locale`), MapLibre `MAP_LOCALE`. The API stays English and language-neutral (its answers are cached for everyone): `api.ts` `errorText` shows an error by its `code` (keep its list in step with `functions/app.js`/`lib/errors.js`), `tileLabel` recognises the tile endpoints' English `label` forms, so a changed label in `functions/ee/*` needs its pattern there. Tests run in English (jsdom); `LayersPanel.es.test.tsx` shows how to render in another language (override `navigator.languages` in `vi.hoisted`).
- Chart cards (Plotly's reduced `plotly.js-basic-dist-min` build: scatter, bar and pie only, about 1.2 MB; a new trace type needs the full build) are `React.lazy`-loaded in `App.tsx` so the map paints first. Tests mock MapLibre with `src/test/fakeMaplibre.ts`.
