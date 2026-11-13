# CE Earth Viewer: Firebase-hosted replacement for the `frames_landsat_v4_tempSegmentation` GEE app

Date: 2026-11-01
Status: design validated, implementation plan pending

## Goal

Replace the Google Earth Engine (GEE) Code Editor app `frames_landsat_v4_tempSegmentation` with a
Firebase-hosted web site that Collect Earth opens for a clicked plot. End users need no Earth Engine
account. The site follows the Earth Map concept: a static frontend talks to a backend that holds a
single Earth Engine service account.

## Decisions taken

| Topic | Decision |
|---|---|
| EE access | Service account inside Firebase Cloud Functions (2nd gen, Node 20). No user login. |
| Entry point | Collect Earth link only. Same URL parameters as `testWithURL`: `geoJson`, `startTime`, `endTime`, `plot_id`. No drawing or file upload. |
| Maps | One MapLibre map with a layer switcher, replacing the three linked `ui.Map` panels. Swipe/compare control between any two layers. |
| Layers | Sentinel-2 last-12-months composite; Landsat yearly composites behind one 1984-to-present slider (sensor auto-picked per year); a single dated scene selected from a chart. |
| Charts | CCDC temporal segmentation (NDFI or NDVI), Landsat NDVI series, Sentinel-2 NDVI series, MODIS 16-day NDVI with burned area. |
| Improvements | Progressive loading per card, Firestore result cache per plot, Plotly interactivity (zoom, hover, CSV), responsive layout for tablets. |
| Frontend | React + Vite + TypeScript, MapLibre GL, Plotly. |
| Code location | New repo `ce-earth-viewer`, new Firebase project. This GEE repo remains the reference for the EE recipes. |
| Backend language | Node, because the EE JS client API is the same API the Code Editor uses, so `common/*` and the Wiell CCDC library port almost verbatim. |

## Architecture

```
Collect Earth ──URL──▶ Firebase Hosting (React + Vite static bundle)
                              │  HTTPS JSON, relative /api/** URLs (hosting rewrite, no CORS)
                              ▼
                      Cloud Functions 2nd gen (Node 20, @google/earthengine)
                        - authenticates once with the EE service account
                        - /tiles/*    → ee.getMap() tile URL templates
                        - /series/*   → reduceRegion time series as JSON
                        - /ccdc       → CCDC fit + segment chart data
                              │
                              ▼
                       Firestore cache (keyed by plot hash + dates + endpoint)
```

The frontend never talks to Earth Engine. EE quota is shared across all visitors through the one
service account, which is why caching matters.

Local development: `firebase emulators:start` runs Hosting, Functions and Firestore locally. The
Functions emulator calls real Earth Engine with the service account key.

## API

All endpoints are `POST /api/<name>` with body `{ plot: GeoJSON, start, end, ...extras }` and JSON
responses. They are independent so the frontend calls them in parallel.

| Endpoint | Extras | Returns | Typical time |
|---|---|---|---|
| `tiles/sentinel2` | none | `{ tileUrl, label, dateRange }` last-12-months composite | 2 to 5 s |
| `tiles/landsat` | `year` | `{ tileUrl, sensor, label }`; picks L4/5/7/8/9 by year | 2 to 5 s |
| `tiles/scene` | `sensor, date` | tile URL for one Landsat or Sentinel-2 scene | 2 to 5 s |
| `series/modis` | none | NDVI 16-day points plus burned-area dates | 3 to 8 s |
| `series/landsat` | none | per-scene `{date, ndvi, sensor, sceneId}` | 10 to 30 s |
| `series/sentinel2` | none | per-scene `{date, ndvi, sceneId}` | 5 to 20 s |
| `ccdc` | `band: "NDFI" or "NDVI"` | observed points, fitted segment curves, break dates | 20 to 90 s |

Tile URLs are EE `getMap` templates, valid for about 24 hours, consumed by MapLibre as a raster source.

**Cache**: Firestore document keyed by `sha1(plot geometry + start + end + endpoint + extras)`.
Series and CCDC results reused for 30 days; tile URLs for 20 hours. `?refresh=1` bypasses the cache.

**Errors**: `{ error: { code, message, retryable } }`, HTTP 4xx for bad input, 5xx for EE failures.
EE timeouts and concurrency errors are marked retryable so the frontend shows a Retry button on that
card only.

**Limits**: plot area capped at 100 ha; dates clamped to 1984 to today.

## Frontend

```
┌──────────────────────────────────────────┬────────────────────┐
│  Map (MapLibre GL)                       │  Plot 1234         │
│  ┌──────────────┐                        │  2000-01-01 →      │
│  │ Layers       │                        │  2026-10-30        │
│  │ ◉ Sentinel-2 │                        ├────────────────────┤
│  │ ○ Landsat ▸ [1984 ──●──── 2026]       │  ▸ CCDC   [NDFI▾]  │
│  │ ○ Scene: L8 2021-03-04                │    (plotly chart)  │
│  │ ☐ Plot outline  ☐ Subplots            ├────────────────────┤
│  │ ☐ Compare ▸ second layer radio        │  ▸ Landsat NDVI    │
│  └──────────────┘                        ├────────────────────┤
│                                          │  ▸ Sentinel-2 NDVI │
│                                          ├────────────────────┤
│                                          │  ▸ MODIS NDVI+fire │
└──────────────────────────────────────────┴────────────────────┘
```

- Startup parses the URL exactly as `testWithURL` does. The map centres on the plot and draws the
  outline from the GeoJSON before any EE call returns.
- Layers panel: radio group for the imagery layer, Sentinel-2 on by default. Landsat has a debounced
  year slider. The Scene entry appears once a chart point is clicked.
- Compare toggle: a second radio column picks the right-hand layer and a draggable vertical divider
  splits two synced MapLibre instances (`maplibre-gl-compare`).
- Chart cards: fixed order with CCDC first. Each card has its own loading, error and retry state.
  Plotly provides zoom, pan, hover tooltips and CSV download. Clicking a point in the Landsat,
  Sentinel-2 or CCDC charts loads that scene on the map.
- Responsive: below 900 px the side panel stacks under the map (map 50 vh), layers panel becomes a
  button.
- State: one top-level `PlotContext` (plot, dates, active layers, selected scene, per-card request
  status). No Redux.

## Porting the EE recipes

Backend package `functions/src/ee/`, one module per recipe, each exporting
`(plot: ee.Geometry, opts) => ee.ComputedObject` with a thin promisified `evaluate()` wrapper.
No `getInfo` inside mapped functions.

| New module | Source in ce_scripts | Notes |
|---|---|---|
| `landsatComposite.ts` | `common/SentinelLandsatImagery` | C2 L2 scaling, cloud mask, median, histogram-equalised SLD. Sensor by year: L4 1984 to 1993, L5 to 2011, L7 to 2012, L8 to present, L9 2022+. |
| `sentinel2Composite.ts` | `common/sentinel2`, `utils.sharpenSentinel` | Cloud-score masked median of last 12 months, false colour B8/B11/B4. |
| `landsatSeries.ts` | `charts_v2.getLandsatImagery`, `getMergedLandsat` | Roy harmonisation of L8/9 to L7, per-scene NDVI mean. |
| `sentinel2Series.ts` | `charts_v2.getSentinel2NDVI` | Per-scene NDVI mean. |
| `modisSeries.ts` | `charts_v2.getModis16DayNDVI`, `getBurnedArea` | MOD13Q1 NDVI plus MCD64A1 burned dates. |
| `ccdc.ts` | `WiellTemporalSegmentation/temporalSegmentation`, `uiChart` | Library copied as-is (pure `ee.*`). `chartPlot` rewritten to return `{observed, segments, breaks}` JSON. |

Bugs that disappear by construction: the bare `updateMap` call in the GEE entry script (frontend owns
map updates) and the `centerObject` timeout hacks (map centred from GeoJSON up front).

## Testing

- Fast unit tests (Vitest): sensor-by-year lookup, cache key hashing, URL parsing, response shaping.
- Live EE tests (Vitest, on demand): each EE module against the fixed Belize rectangle from
  `charts_v2`, asserting output shape and sanity (NDVI within -1 to 1, sorted dates, minimum scene
  count).
- Manual: `firebase emulators:start` with a Collect Earth URL.

## Setup and deployment

Repo layout:

```
ce-earth-viewer/
  firebase.json          hosting + rewrite /api/** → functions, emulators
  web/                   React + Vite + TypeScript, MapLibre, Plotly
  functions/             Node 20, TypeScript, @google/earthengine, Vitest
  docs/plans/
```

One-time cloud setup:

1. Create a Firebase project on the Blaze plan (Functions 2nd gen requires it).
2. Enable the Earth Engine API and register the project for Earth Engine.
3. Create a service account, register it for Earth Engine, store its key with
   `firebase functions:secrets:set EE_KEY`. The key never enters git.
4. `firebase deploy`. Preview channels via `firebase hosting:channel:deploy`.

Collect Earth change: point the app URL to `https://<project>.web.app/?geoJson=...`.

## First-version scope, in order

1. Scaffold, emulators, `tiles/sentinel2`, map showing the plot. End-to-end proof.
2. Landsat composite with year slider, scene loading.
3. MODIS, Landsat and Sentinel-2 series cards with Plotly, click-to-load scene.
4. CCDC card with NDFI/NDVI toggle.
5. Firestore cache, swipe compare, responsive layout, CSV download.

Out of scope: drawing plots, plot-file upload, NICFI, precipitation chart, user login.
