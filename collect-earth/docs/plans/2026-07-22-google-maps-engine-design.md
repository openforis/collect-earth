# Google Maps Engine for the Plots Map — Design

**Date:** 2026-07-22 · **Status:** validated with product owner · **Branch:** feature/gew-viewer
**Rollback point:** tag `leaflet-viewer-poc`

## Purpose

Add Google Maps as a second, switchable rendering engine for the Leaflet plots map,
keeping Leaflet fully working for testing/showcasing comparisons. Google's VHR
imagery (familiar from GEP/GEW) becomes available in the map window; everything
around the map (endpoints, form panel, status flow, postMessage) is untouched.

## Decisions (from brainstorming)

- **Switching:** Properties dialog only — new `EarthProperty.MAP_ENGINE`
  ("map_engine", `leaflet` | `google_maps`, default `leaflet`), combo in the
  External Services panel, enabled only when OPEN_IN_LEAFLET_MAP is on. Changing
  it goes through the usual restart/reload flow. No in-page toggle.
- **Key fallback:** missing key → instantiate Leaflet immediately + dismissible
  banner; runtime rejection (`gm_authFailure`) or script load failure → destroy()
  and re-instantiate Leaflet live, same banner. Collection never blocks on keys.
- **API key:** reuse `GOOGLE_MAPS_API_KEY` (Street View already uses it), served
  to the page by a new `GET /mapConfig` → `{engine, googleMapsApiKey}` on
  LeafletMapController. No key baked into static files.

## Architecture — engine adapter split

`map.js` refactors into three files under `leafletmap/` (served as today):

- **map-core.js** — all engine-agnostic logic unchanged in behavior: plot load,
  status polling, list, selection, form iframe, postMessage, aux windows. Talks
  to the map only via the engine interface:
  `init(container, config)`, `addPlot(id, rings, center)`, `setPlotColor(id, color)`,
  `flyTo(center, zoom)`, `fitAll(centers)`, `setZoomVisibilityMode(showPolys)`,
  `onPlotClick(cb)`, `onZoomChange(cb)`, `destroy()`.
- **engine-leaflet.js** — existing Leaflet code relocated behind the interface,
  zero behavior change (regression-safe move; verify against tag).
- **engine-google.js** — new. Loads the Maps JS API bootstrap with the key
  (sanctioned exception to the no-CDN rule: Google requires loading from Google),
  awaits `google.maps.importLibrary("maps")`. Map: `mapTypeId: 'hybrid'`,
  native mapType control on, `tilt: 0`, rotate off. Mapping: polygons →
  `google.maps.Polygon` (fill 0); status dots → `Marker` with circle `Symbol`
  (pixel-scaled — NOT `google.maps.Circle`, which is meter-scaled); fitBounds via
  `LatLngBounds`; `zoom_changed` drives the same ZOOM_THRESHOLD swap; colors are
  hex strings passed by core, so red/yellow/green/cyan semantics identical.

`map.html` loads core + both engines; core instantiates the one `/mapConfig` names.

## Edge cases

- Billing: one Google map load per map-window open (navigation is pan/zoom on the
  same instance). Document.
- The key must have "Maps JavaScript API" enabled in Google Cloud Console —
  banner text mentions this (likeliest first failure for existing keys).
- Offline: Google engine unavailable → automatic Leaflet fallback (ESRI tiles
  gray out offline too, but list/forms keep working as today).

## Verification

- Regression: `map_engine=leaflet` behaves identically to tag `leaflet-viewer-poc`
  (full E2E walk: click → form → yellow → submit → green → auto-advance).
- Same walk on `google_maps`.
- Fallback drills: no key → Leaflet + banner; bogus key → gm_authFailure → live
  fallback; script blocked → timeout → fallback.
- `node --check` all three JS files; no data-valued innerHTML in the new engine.
