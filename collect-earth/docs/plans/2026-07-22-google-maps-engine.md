# Google Maps Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: subagent-driven execution, implementation subagents on Opus. Review gate after every task.

**Goal:** Google Maps as a second, Properties-switchable rendering engine for the plots map, with Leaflet kept intact and automatic fallback when the Google key is missing/rejected.

**Architecture:** Engine-adapter split of map.js (map-core + engine-leaflet + engine-google) behind a 9-method interface; new `MAP_ENGINE` property + `/mapConfig` endpoint feeding the page the engine choice and the existing `GOOGLE_MAPS_API_KEY`. Server endpoints, form panel, postMessage contract untouched.

**Design doc:** `docs/plans/2026-07-22-google-maps-engine-design.md` (requirements contract).
**Branch:** `feature/gew-viewer`. **Rollback/regression reference:** tag `leaflet-viewer-poc`.
Maven root: nested `collect-earth/`. Never `git add -A` (untracked .docx files at repo root). Commit trailer on every commit:
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: MAP_ENGINE property, /mapConfig endpoint, Properties combo

**Files:**
- Modify: `collect-earth-core/src/main/java/org/openforis/collect/earth/app/service/LocalPropertiesService.java`
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/LeafletMapController.java`
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/view/properties/ExternalServicesPanel.java`
- Modify: `Messages.properties` + `_fr`/`_es`/`_pt` (SURGICAL single-line inserts ONLY — the files are ISO-8859-1; a wholesale rewrite corrupts them, it has happened twice)

Steps:
1. Core: enum `MAP_ENGINE("map_engine")` (next to OPEN_IN_LEAFLET_MAP); getter:
```java
	public static final String MAP_ENGINE_LEAFLET = "leaflet";
	public static final String MAP_ENGINE_GOOGLE = "google_maps";

	public String getMapEngine() {
		String engine = getValue(EarthProperty.MAP_ENGINE);
		return MAP_ENGINE_GOOGLE.equals(engine) ? MAP_ENGINE_GOOGLE : MAP_ENGINE_LEAFLET;
	}
```
2. VERIFY the exact enum constant + getter for the Google Maps key (grep GOOGLE_MAPS in LocalPropertiesService; Street View code in BrowserService/GeolocalizeMapService shows the getter in use). Use it in step 3.
3. `/mapConfig` on LeafletMapController (same JSON style as /plotStatuses):
```java
	@GetMapping("/mapConfig")
	public void mapConfig(HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		Map<String, Object> config = new LinkedHashMap<>();
		config.put("engine", localPropertiesService.getMapEngine());
		config.put("googleMapsApiKey", /* verified key getter, "" if null */);
		json.writeValue(response.getOutputStream(), config);
	}
```
4. Properties UI: read ExternalServicesPanel to find the existing combo-box idiom (check BrowserDisplayPanel too if none there — mirror whichever pattern componentFactory offers, e.g. createComboBox bound to an EarthProperty). Add a two-entry combo (labels from Messages keys, values `leaflet`/`google_maps`) right below the Leaflet checkbox, enabled only when `openInLeafletMapCheckbox` is selected (mirror how planetApiKeyField follows openPlanetCheckbox). Renumber subsequent gridy rows.
5. Strings (below OptionWizard.146 in the 4 files that have it): `OptionWizard.147=Map imagery engine` — en: as-is; fr: `Moteur d'imagerie de la carte`; es: `Motor de imagenes del mapa`; pt: `Motor de imagens do mapa`. Combo item labels can be literal "Leaflet (ESRI imagery)" / "Google Maps" (product names, not translated).
6. Compile core + app. `git diff --stat` MUST show each properties file with ~1 insertion. Commit: `feat: MAP_ENGINE property, /mapConfig endpoint, engine selector UI`.

### Task 2: Adapter refactor — zero-behavior-change gate

**Files:**
- Create: `collect-earth-app/src/main/resources/leafletmap/map-core.js`
- Create: `collect-earth-app/src/main/resources/leafletmap/engine-leaflet.js`
- Modify: `collect-earth-app/src/main/resources/leafletmap/map.html` (script tags: vendor/leaflet.js, engine-leaflet.js, engine-google.js placeholder comment, map-core.js — core LAST)
- Delete: `collect-earth-app/src/main/resources/leafletmap/map.js`

Engine interface (attach implementations to `window.CEMapEngines = { leaflet: ..., google: ... }`; each engine object exposes):
```js
{
  init: function (containerId, config, callbacks) {},  // callbacks: { onPlotClick(id), onZoomChange() }
  addPlot: function (id, rings, center) {},            // rings: array of [lat,lng] arrays
  setPlotColor: function (id, colorHex) {},            // polygons AND dot marker
  flyTo: function (center, minZoom) {},
  fitAll: function (centers) {},
  setZoomVisibilityMode: function (showPolys) {},
  isAboveThreshold: function () {},                    // current zoom >= ZOOM_THRESHOLD
  destroy: function () {}
}
```
Rules:
- `map-core.js` = current map.js minus every direct `L.*`/`map.*` call, which move into `engine-leaflet.js` verbatim (tile layer, polygon/marker creation, visibility swap, setView/fitBounds, zoomend). Core keeps: fetch/poll logic, plots dictionary (feature, status, listItem — engine owns its own layer handles keyed by id), list rendering, selection semantics (cyan for active, restore-previous via setPlotColor), postMessage handler, form iframe URL building, banner, aux-window call, `goToNextUnfinished`.
- Core selects the engine: fetch `/mapConfig` FIRST; engine = `google_maps` && key non-blank ? google : leaflet (with banner when falling back per design). For this task only leaflet exists — structure the selection but hard-fall-back to leaflet if `CEMapEngines.google` is undefined.
- ZOOM_THRESHOLD stays in core; engines report zoom via `isAboveThreshold`/`onZoomChange`.
- NO behavior changes. The acceptance is: a reviewer diffing `git show leaflet-viewer-poc:.../map.js` against core+engine finds every branch/side-effect preserved.
- `node --check` both files. Compile app (resources only, but run it). Commit: `refactor: split map.js into engine-agnostic core + Leaflet engine`.

### Task 3: Google engine + runtime fallback

**Files:**
- Create: `collect-earth-app/src/main/resources/leafletmap/engine-google.js`
- Modify: `map.html` (add the script tag), `map-core.js` (fallback wiring only)

Steps:
1. Loader inside `engine-google.js` `init`:
```js
	window.gm_authFailure = function () { config.onEngineFailure('Google rejected the API key'); };
	var s = document.createElement('script');
	s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(config.apiKey)
	      + '&v=weekly&loading=async&callback=__ceGmapsReady';
	s.onerror = function () { config.onEngineFailure('Google Maps script failed to load'); };
	// plus a 15s timeout guard that calls onEngineFailure if __ceGmapsReady never fires
```
2. Map: `new google.maps.Map(el, { mapTypeId: 'hybrid', tilt: 0, rotateControl: false, mapTypeControl: true, streetViewControl: false, fullscreenControl: false })`.
3. Feature mapping per the design doc table — polygons `google.maps.Polygon` (strokeWeight 2, fillOpacity 0), dots `google.maps.Marker` with `{ path: google.maps.SymbolPath.CIRCLE, scale: 6, strokeColor/fillColor, fillOpacity: 0.9 }`, `LatLngBounds` for fitAll, `zoom_changed` → onZoomChange, click listeners → onPlotClick(id).
4. Core fallback: `onEngineFailure(reason)` → `engine.destroy()` (Google engine's destroy nulls the map div) → instantiate leaflet engine → re-add all plots with their current status colors → banner(reason + ' - using Leaflet/ESRI. Check GOOGLE_MAPS_API_KEY in Properties (the key needs the Maps JavaScript API enabled).') non-fatal/dismissible.
5. NEVER innerHTML with data. `node --check` all three JS files. Commit: `feat: Google Maps engine with automatic Leaflet fallback`.

### Task 4: Build gate + acceptance

1. `mvn -q install "-DskipTests" "-Dgpg.skip=true"` → 0; `mvn test -pl collect-earth-app "-Dgpg.skip=true"` → all pass.
2. Manual (user): leaflet regression walk == tag behavior; switch property to Google Maps → restart → same walk on Google imagery; no-key and bogus-key fallback drills.

## Out of scope (YAGNI)
- In-page engine toggle; per-plot imagery-date logic; vendoring Google code (forbidden by Google ToS); marker clustering.
