# Leaflet Map Viewer — Design (POC)

**Date:** 2026-07-21 · **Status:** validated with product owner · **Branch:** feature/gew-viewer

## Purpose

Proof of concept for moving Collect Earth away from Google Earth Pro: a new option that,
instead of opening the generated KML in GEP (or the OS KML handler), opens the plots in a
Leaflet map served by CE's embedded Jetty server. Users click plots to edit them through
the survey form; a collapsible left panel lists plots to collect with status icons that
recolor live as data is saved. This implements the "Plot Navigator" concept from the
GEP→GEW migration plan with Leaflet as the map surface.

## Decisions (from brainstorming)

- **Base imagery:** ESRI World Imagery tiles. The Leaflet window is the interaction hub;
  VHR interpretation continues in the auxiliary windows (GEE App, Google Earth Web, …)
  which open synchronously on plot click, preserving today's balloon-driven behavior.
- **Form display:** slide-in right panel (~40% width) with the survey form.
- **Launch:** Selenium-driven Chrome window (BrowserService pattern), opened at startup
  when the new property is enabled; relaunchable from a Tools menu entry.

## Architecture

- New `EarthProperty.OPEN_IN_LEAFLET_MAP` (checkbox in Properties dialog, default off).
- When enabled, `EarthApp` skips the `loadApp.kml` → OS → GEP handoff and calls a new
  `BrowserService.openLeafletMap()` → `http://localhost:8028/earth/map`.
- Page: `map.html` + JS + CSS, Leaflet bundled locally (no CDN), served by Jetty.
- Panes: center map (plots colored by status: red=empty, yellow=partial, green=saved;
  active plot highlighted cyan), left collapsible plot list (status dot, id, filter,
  "next unfinished"), right slide-in form panel (iframe of `/balloon`).

## Server side

New `LeafletMapController` (collect-earth-app `.../app/server/`):

- `GET /plotsGeoJson` — FeatureCollection of all plots. Uses
  `KmlGeneratorService.getKmlGenerator().getPlotObject(...)` + `fillSamplePoints()` +
  `fillExternalLine()` per CSV row (same calls as `PlacemarkBrowserServlet`). Feature
  properties carry plot id, center lat/long, elevation and all CSV extra columns (the
  `$[...]` substitution set). Cached; invalidated via `updateFilesUsedChecksum()`.
- `GET /plotStatuses` — `{plotId: empty|partial|saved}` via
  `EarthSurveyService.isPlacemarkSavedActively()` / `isPlacemarkEdited()`. Polled every 5 s.

Reused untouched: `/balloon` (server-side `$[...]` form rendering, BalloonServlet),
`/save-data-expanded` + `/placemark-info-expanded` (PlacemarkDataController),
`/openAuxiliaryWindows` (PlacemarkBrowserServlet, fires GEE/GEW/etc. fan-out; its
`lastPlacemark` dedupe is inherited).

## Behavior details

- Save round-trip unchanged; map/list recolor on next poll after save.
- Large grids: polygons rendered above a zoom threshold, colored circle markers below;
  map starts fitted to grid bounds. Target: 5,000 plots fluid.
- Window closed by user → Tools menu "Open plots map" relaunches (navigateTo retry).
- Jetty restarting → "reconnecting…" banner, fetch retry with backoff.
- Shapes: all in-memory generators supported (square, circle, hexagon, NFI/NFMA).
  Predefined-polygon surveys: WKT/GeoJSON columns parsed server-side (GeoTools);
  raw-KML polygon columns deferred (center marker + docs note).
- Failures: no CSV → "no survey plots loaded"; tiles offline → gray tiles, forms still
  work; `/plotsGeoJson` error → red banner.

## Known limitations

- **Live status coloring assumes CODE-typed plot key attributes.** The GeoJSON `id`
  is the raw CSV key text while `/plotStatuses` keys come from Collect record key
  values, which are parsed and reformatted for NUMBER/REAL attributes ("007"→"7",
  "10"→"10.0"). Numeric keys therefore silently break the red/yellow/green sync.
  Same latent gap exists in the GEP path (`getPlacemarksId`); fix by deriving both
  sides from one key-formatting path if a numerically-keyed survey ever needs this.

## Verification

- JUnit golden-file tests for `/plotsGeoJson` per shape generator (demo survey CSV).
- Parity test `/plotStatuses` vs `PlacemarkImageServlet` logic on seeded SQLite.
- Manual E2E (demo_survey.cep): enable option → map opens, plots red → click plot →
  panel + GEE/GEW fly-to → save → green ≤5 s → next-unfinished/filter/collapse →
  Tools-menu relaunch. Regression: option off → classic GEP flow untouched.
- Performance: 5,000-plot CSV pans smoothly.
