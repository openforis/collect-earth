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
  `$[...]` substitution set). Cached against the CSV path + lastModified (synchronized
  rebuild) so racing startup requests and page reloads don't redo the per-plot
  coordinate transforms; client-aborted downloads log at debug, not error.
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

## Update 2026-10-19 — single `VIEWER_TYPE` switch

The two POC checkboxes (`OPEN_IN_LEAFLET_MAP`, `OPEN_GOOGLE_EARTH_WEB`) are replaced by one
"Plot viewer" selector backed by `EarthProperty.VIEWER_TYPE` (`viewer_type`):

| Value | Behaviour |
|---|---|
| `google_earth_pro` (default) | Legacy KML handoff to Google Earth Pro. |
| `plots_map` | Plots map window replaces Google Earth Pro. |
| `google_earth_web` | Plots map window + a Google Earth Web window that flies to each selected plot. |

`LocalPropertiesService.getViewerType()` migrates old settings when `viewer_type` is unset:
GEW flag on → `google_earth_web`; only the Leaflet flag on → `plots_map`; otherwise
`google_earth_pro`. Callers use `isPlotsMapViewer()` / `isGoogleEarthWebViewer()`. The map
imagery engine selector is enabled for both map modes. Google Earth Web is no longer offered
as an extra window in Google Earth Pro mode.

## Update 2026-10-19 — Google Earth Web interaction

`GoogleEarthWebService` (moved out of `BrowserService`) drives the Google Earth Web window:

- **One page load per plot, not two:** Google Earth Web is navigated without the forced
  `refresh()` other viewers need (its URL path changes, so navigation already loads it).
- **In-page moves when supported:** once loaded, the next plot URL is pushed onto the history
  with a `popstate` event. Google Earth Web rewrites its URL as the camera moves, so if the URL
  is still exactly the pushed one after 4 s it ignored the request: Collect Earth loads the page
  instead and stops trying for the session. Unverified against the live site (blocked in the
  development environment) — check the log line "does not follow in-page navigation".
- **Coalescing:** only the latest requested plot is shown; quick "next" presses never queue.
- **Watchdog (3 s):** re-draws the outline after a page reload; reports a closed window.
- **Information bar** in the Google Earth Web page: plot id, why the outline is hidden
  (tilted view, plot out of view) and a "Top-down view" button.
- **Window layout:** on first open, plots map left / Google Earth Web right, or each on its
  own screen with two monitors; "Arrange windows" in the map repeats it.
- **Map feedback:** `/googleEarthWeb/status` drives a chip in the plots map (opening, moving
  to plot X, plot X, closed → reopen, other plot → re-sync, error); `/googleEarthWeb/show`
  re-sends the plot, `/googleEarthWeb/open` warms the window up over the survey area on load.
- **Persistent profile:** the Google Earth Web window uses its own Chrome/Edge profile in
  `<CE data folder>/browser_profiles/google_earth_web`, so Google's cookie consent, sign-in and
  Google Earth Web settings survive restarts (other windows keep temporary profiles; Chrome
  cannot share one profile between processes). Falls back to a normal window if unavailable.
- **WAITING state:** while Google shows a consent or sign-in page the map says so; the plot is
  shown as soon as Google Earth Web is reached.
- **Status colours in Google Earth Web:** with each selection the map POSTs the plots within
  3 km (max 300, outlines only, with statuses) to `/googleEarthWeb/context`; the server rebuilds
  the JSON from typed values before it is embedded in the injected script. The current plot is
  drawn in the map's selection cyan (yellow means "in progress").
- **Linked views:** the watchdog (every 2 s) reports the ground area shown by Google Earth Web
  (`view` in `/googleEarthWeb/status`); the map outlines it as a dashed rectangle.
