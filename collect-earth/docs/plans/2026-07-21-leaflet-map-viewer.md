# Leaflet Map Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A new Collect Earth option that opens the survey plots in a Leaflet map (ESRI World Imagery basemap) instead of Google Earth Pro, with click-to-edit forms in a slide-in panel and a live status-colored plot list.

**Architecture:** A new Spring controller on the existing embedded Jetty serves a self-contained Leaflet page plus two JSON endpoints (`/plotsGeoJson`, `/plotStatuses`). The survey form is reused verbatim via the existing `/balloon` endpoint (iframe); saves go through the untouched `/save-data-expanded`. Clicking a plot fires the existing `/openAuxiliaryWindows` fan-out (GEE App, Google Earth Web, …). A new `EarthProperty` gates the mode; when on, `EarthApp.simulateClickKmz()` opens the map in a Selenium-driven Chrome instead of handing `loadApp.kml` to the OS.

**Tech Stack:** Java 8, Spring MVC 5.3 (existing dispatcher), Jackson 2.15, Leaflet 1.9.4 (vendored, no CDN), plain ES5 JS (no build toolchain).

**Design doc:** `docs/plans/2026-07-21-leaflet-map-viewer-design.md`
**Branch:** `feature/gew-viewer` (work directly on it). Repo root for all paths: `collect-earth/` (the nested Maven root).

**Build/test commands** (run from `C:\Users\sanch\code\collect-earth\collect-earth`):
- Compile: `mvn -q compile -pl collect-earth-app -am -DskipTests`
- Test: `mvn test -pl collect-earth-app -Dtest=ClassName`

---

### Task 1: The gating property

**Files:**
- Modify: `collect-earth-core/src/main/java/org/openforis/collect/earth/app/service/LocalPropertiesService.java`

No unit test: pure enum + one-line getter with zero logic (the pattern is identical to `OPEN_ESRI_WAYBACK`, exercised daily in production).

**Step 1: Add the enum constant.** In the `EarthProperty` enum, directly after `OPEN_GOOGLE_EARTH_WEB("open_google_earth_web"),` add:

```java
				OPEN_IN_LEAFLET_MAP("open_in_leaflet_map"),
```

**Step 2: Add the getter.** Directly after `isGoogleEarthWebSupported()` add:

```java
	public boolean isLeafletMapSupported() {
		return isPropertyActivated(EarthProperty.OPEN_IN_LEAFLET_MAP);
	}
```

**Step 3: Compile.** `mvn -q compile -pl collect-earth-core -DskipTests` → BUILD SUCCESS (exit 0).

**Step 4: Commit.**
```bash
git add collect-earth/collect-earth-core
git commit -m "feat: add OPEN_IN_LEAFLET_MAP property for Leaflet map viewer mode"
```

---

### Task 2: Vendor Leaflet 1.9.4

**Files:**
- Create: `collect-earth-app/src/main/resources/leafletmap/vendor/leaflet.js`
- Create: `collect-earth-app/src/main/resources/leafletmap/vendor/leaflet.css`
- Create: `collect-earth-app/src/main/resources/leafletmap/vendor/images/` (marker/layers PNGs)

**Step 1: Download the dist** (PowerShell):
```powershell
$base = "collect-earth\collect-earth-app\src\main\resources\leafletmap\vendor"
New-Item -ItemType Directory -Force "$base\images" | Out-Null
Invoke-WebRequest "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"  -OutFile "$base\leaflet.js"
Invoke-WebRequest "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" -OutFile "$base\leaflet.css"
foreach ($img in "layers.png","layers-2x.png","marker-icon.png","marker-icon-2x.png","marker-shadow.png") {
  Invoke-WebRequest "https://unpkg.com/leaflet@1.9.4/dist/images/$img" -OutFile "$base\images\$img"
}
```

**Step 2: Sanity-check** `leaflet.js` is ~145 KB and starts with `/* @preserve` + version 1.9.4.

**Step 3: Commit.**
```bash
git add collect-earth/collect-earth-app/src/main/resources/leafletmap
git commit -m "chore: vendor Leaflet 1.9.4 (no-CDN policy)"
```

---

### Task 3: GeoJSON feature builder (TDD)

The only non-trivial pure logic: `SimplePlacemarkObject` → GeoJSON Feature. Isolated in its own class so it's testable without a survey/DB.

**Files:**
- Create: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/PlotGeoJsonBuilder.java`
- Test: `collect-earth-app/src/test/java/org/openforis/collect/earth/app/service/PlotGeoJsonBuilderTest.java`

**Background you need:** `SimplePlacemarkObject` (collect-earth-sampler, package `org.openforis.collect.earth.sampler.model`) getters used here: `getPlacemarkId()`, `getCoord()` (a `SimpleCoordinate` with `getLatitude()`/`getLongitude()`, both **String**), `getMultiShape()` (`List<List<SimpleCoordinate>>` — plot boundary + buffers), `getPoints()` (`List<SimplePlacemarkObject>`, each with `getShape()` = `List<SimpleCoordinate>` — the sample squares), `getElevation()` (int), `getAspect()`/`getSlope()` (double), `getValuesByColumn()` (`Map<String,String>`, may be null). Verify getter names against the class before coding; adjust if they differ.

**Step 1: Write the failing test.**

```java
package org.openforis.collect.earth.app.service;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

public class PlotGeoJsonBuilderTest {

	private SimplePlacemarkObject squarePlot() {
		SimplePlacemarkObject p = new SimplePlacemarkObject();
		p.setPlacemarkId("plot_1");
		p.setCoord(new SimpleCoordinate("41.90", "12.45"));
		SimpleCoordinate a = new SimpleCoordinate("41.899", "12.449");
		SimpleCoordinate b = new SimpleCoordinate("41.899", "12.451");
		SimpleCoordinate c = new SimpleCoordinate("41.901", "12.451");
		SimpleCoordinate d = new SimpleCoordinate("41.901", "12.449");
		p.setMultiShape(Collections.singletonList(Arrays.asList(a, b, c, d, a)));
		return p;
	}

	@Test
	public void buildsFeatureWithPolygonAndProperties() throws Exception {
		String json = new PlotGeoJsonBuilder().toFeature(squarePlot());
		JsonNode f = new ObjectMapper().readTree(json);
		assertEquals("Feature", f.get("type").asText());
		assertEquals("plot_1", f.get("properties").get("id").asText());
		assertEquals("41.90", f.get("properties").get("latitude").asText());
		JsonNode geom = f.get("geometry");
		assertEquals("GeometryCollection", geom.get("type").asText());
		JsonNode boundary = geom.get("geometries").get(0);
		assertEquals("Polygon", boundary.get("type").asText());
		// GeoJSON is [lon, lat]
		JsonNode first = boundary.get("coordinates").get(0).get(0);
		assertEquals(12.449, first.get(0).asDouble(), 1e-9);
		assertEquals(41.899, first.get(1).asDouble(), 1e-9);
		assertTrue(f.get("properties").has("elevation"));
	}
}
```

*(If `SimplePlacemarkObject`/`SimpleCoordinate` lack the no-arg constructor or setters used above, check the class and use whatever constructor exists — e.g. `new SimpleCoordinate(coord)` variants. Adapt the test, not the model.)*

**Step 2: Run it — must fail to compile** (class doesn't exist):
`mvn test -pl collect-earth-app -Dtest=PlotGeoJsonBuilderTest` → expect compilation error `cannot find symbol: PlotGeoJsonBuilder`.

**Step 3: Implement.**

```java
package org.openforis.collect.earth.app.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Serializes a plot (SimplePlacemarkObject) into a GeoJSON Feature consumed by
 * the Leaflet map page. Geometry is a GeometryCollection: first the plot
 * boundary/buffers (Polygons from multiShape), then one Polygon per sample
 * square. Properties carry the id, center, elevation/aspect/slope and every
 * CSV extra column so the page can build the /balloon form URL.
 */
public class PlotGeoJsonBuilder {

	private final ObjectMapper mapper = new ObjectMapper();

	public String toFeature(SimplePlacemarkObject plot) throws Exception {
		Map<String, Object> feature = new LinkedHashMap<>();
		feature.put("type", "Feature");
		feature.put("geometry", geometry(plot));
		feature.put("properties", properties(plot));
		return mapper.writeValueAsString(feature);
	}

	private Map<String, Object> geometry(SimplePlacemarkObject plot) {
		List<Map<String, Object>> geometries = new ArrayList<>();
		if (plot.getMultiShape() != null) {
			for (List<SimpleCoordinate> ring : plot.getMultiShape()) {
				geometries.add(polygon(ring));
			}
		}
		if (plot.getPoints() != null) {
			for (SimplePlacemarkObject sample : plot.getPoints()) {
				if (sample.getShape() != null && !sample.getShape().isEmpty()) {
					geometries.add(polygon(sample.getShape()));
				}
			}
		}
		Map<String, Object> geom = new LinkedHashMap<>();
		geom.put("type", "GeometryCollection");
		geom.put("geometries", geometries);
		return geom;
	}

	private Map<String, Object> polygon(List<SimpleCoordinate> ring) {
		List<double[]> coords = new ArrayList<>();
		for (SimpleCoordinate c : ring) {
			coords.add(new double[] { Double.parseDouble(c.getLongitude()), Double.parseDouble(c.getLatitude()) });
		}
		// GeoJSON polygons must be closed
		if (!coords.isEmpty()) {
			double[] first = coords.get(0);
			double[] last = coords.get(coords.size() - 1);
			if (first[0] != last[0] || first[1] != last[1]) {
				coords.add(first);
			}
		}
		Map<String, Object> poly = new LinkedHashMap<>();
		poly.put("type", "Polygon");
		poly.put("coordinates", new Object[] { coords });
		return poly;
	}

	private Map<String, Object> properties(SimplePlacemarkObject plot) {
		Map<String, Object> props = new LinkedHashMap<>();
		props.put("id", plot.getPlacemarkId());
		if (plot.getCoord() != null) {
			props.put("latitude", plot.getCoord().getLatitude());
			props.put("longitude", plot.getCoord().getLongitude());
		}
		props.put("elevation", plot.getElevation());
		props.put("aspect", plot.getAspect());
		props.put("slope", plot.getSlope());
		if (plot.getValuesByColumn() != null) {
			props.putAll(plot.getValuesByColumn());
		}
		return props;
	}
}
```

**Step 4: Run the test — must pass.**
`mvn test -pl collect-earth-app -Dtest=PlotGeoJsonBuilderTest` → `Tests run: 1, Failures: 0`.

**Step 5: Commit.**
```bash
git add collect-earth/collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/PlotGeoJsonBuilder.java collect-earth/collect-earth-app/src/test/java
git commit -m "feat: GeoJSON feature builder for Leaflet map plots (TDD)"
```

---

### Task 4: LeafletMapController — page + data endpoints

**Files:**
- Create: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/LeafletMapController.java`

Thin controller — logic lives in Task 3's builder and in existing services, so no unit test; verified end-to-end in Task 9. Mirror the style of `PlacemarkBrowserServlet` (same package, `@Controller`, `@Autowired` fields).

**Step 1: Implement.**

```java
package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.IOUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.PlotGeoJsonBuilder;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.model.CollectRecordSummary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;

import com.opencsv.CSVReader;

/**
 * Serves the Leaflet map page (classpath assets under /leafletmap) and the two
 * JSON endpoints it consumes: /plotsGeoJson (all plot geometries+properties)
 * and /plotStatuses (incremental id->status map for the live coloring).
 */
@Controller
public class LeafletMapController {

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private KmlGeneratorService kmlGeneratorService;

	private final Logger logger = LoggerFactory.getLogger(LeafletMapController.class);
	private final PlotGeoJsonBuilder geoJsonBuilder = new PlotGeoJsonBuilder();
	private final com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();

	// ---------- static page ----------

	@GetMapping("/map")
	public void mapPage(HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/map.html", "text/html; charset=UTF-8", response);
	}

	@GetMapping("/map/assets/{folder}/{file:.+}")
	public void vendorAsset(@PathVariable String folder, @PathVariable String file, HttpServletResponse response)
			throws IOException {
		serveClasspath("leafletmap/" + folder + "/" + file, contentType(file), response);
	}

	@GetMapping("/map/assets/{file:.+}")
	public void asset(@PathVariable String file, HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/" + file, contentType(file), response);
	}

	private String contentType(String file) {
		if (file.endsWith(".js")) return "application/javascript";
		if (file.endsWith(".css")) return "text/css";
		if (file.endsWith(".png")) return "image/png";
		if (file.endsWith(".html")) return "text/html; charset=UTF-8";
		return "application/octet-stream";
	}

	private void serveClasspath(String path, String contentType, HttpServletResponse response) throws IOException {
		// {file:.+} path variables cannot contain '/', so traversal is not possible; belt and braces:
		if (path.contains("..")) {
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}
		try (InputStream in = getClass().getClassLoader().getResourceAsStream(path)) {
			if (in == null) {
				response.setStatus(HttpServletResponse.SC_NOT_FOUND);
				return;
			}
			response.setHeader("Content-Type", contentType);
			IOUtils.copy(in, response.getOutputStream());
		}
	}

	// ---------- data endpoints ----------

	@GetMapping("/plotsGeoJson")
	public void plotsGeoJson(HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		try {
			KmlGenerator kmlGenerator = kmlGeneratorService.getKmlGenerator();
			StringBuilder sb = new StringBuilder("{\"type\":\"FeatureCollection\",\"features\":[");
			boolean first = true;
			try (CSVReader reader = CsvReaderUtils.getCsvReader(localPropertiesService.getCsvFile())) {
				String[] csvRow;
				while ((csvRow = reader.readNext()) != null) {
					try {
						SimplePlacemarkObject plot = kmlGenerator.getPlotObject(csvRow, null,
								earthSurveyService.getCollectSurvey(), false);
						kmlGenerator.fillSamplePoints(plot);
						kmlGenerator.fillExternalLine(plot);
						if (!first) sb.append(',');
						sb.append(geoJsonBuilder.toFeature(plot));
						first = false;
					} catch (Exception rowError) {
						// header row or malformed row - skip (same tolerance as the KML generation)
						logger.debug("Skipping CSV row: {}", (Object) csvRow);
					}
				}
			}
			sb.append("]}");
			response.getOutputStream().write(sb.toString().getBytes("UTF-8"));
		} catch (Exception e) {
			logger.error("Error generating plots GeoJSON", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
			response.getOutputStream().write(("{\"error\":\"" + e.getMessage() + "\"}").getBytes("UTF-8"));
		}
	}

	@GetMapping("/plotStatuses")
	public void plotStatuses(HttpServletResponse response,
			@RequestParam(value = "since", required = false) Long sinceMillis) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		try {
			Date since = sinceMillis == null ? new Date(0) : new Date(sinceMillis);
			long now = System.currentTimeMillis();
			Map<String, String> statuses = new LinkedHashMap<>();
			List<CollectRecordSummary> summaries = earthSurveyService.getRecordSummariesSavedSince(since);
			if (summaries != null) {
				for (CollectRecordSummary summary : summaries) {
					List<String> keys = summary.getRootEntityKeyValues();
					if (keys == null || keys.isEmpty()) continue;
					String[] keyArray = keys.toArray(new String[0]);
					try {
						Map<String, String> placemark = earthSurveyService.getPlacemark(keyArray, false);
						String status = "partial";
						if (earthSurveyService.isPlacemarkSavedActively(placemark)) {
							status = "saved";
						} else if (!earthSurveyService.isPlacemarkEdited(placemark)) {
							status = "empty";
						}
						statuses.put(String.join(",", keys), status);
					} catch (Exception e) {
						logger.debug("Could not read status for {}", keys);
					}
				}
			}
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("now", now);
			result.put("statuses", statuses);
			json.writeValue(response.getOutputStream(), result);
		} catch (Exception e) {
			logger.error("Error generating plot statuses", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		}
	}
}
```

**Note for implementer:** confirm `CollectRecordSummary.getRootEntityKeyValues()` exists (it's the standard Collect 4 API; `PlacemarkUpdateServlet` uses these summaries — check how it extracts the placemark id and use the same call). The status-key must equal the GeoJSON feature `id` — check `KmlGenerator.getPlotObject` to see how `placemarkId` relates to the CSV key columns (it is the comma-joined keys in multi-key surveys); if they differ, normalize both sides to the comma-joined key format.

**Step 2: Compile.** `mvn -q compile -pl collect-earth-app -am -DskipTests` → exit 0.

**Step 3: Commit.**
```bash
git add collect-earth/collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/LeafletMapController.java
git commit -m "feat: Leaflet map controller - page serving + plotsGeoJson + plotStatuses"
```

---

### Task 5: The map page (HTML/CSS/JS)

**Files:**
- Create: `collect-earth-app/src/main/resources/leafletmap/map.html`
- Create: `collect-earth-app/src/main/resources/leafletmap/map.css`
- Create: `collect-earth-app/src/main/resources/leafletmap/map.js`

All ES5, no build step. Asset URLs go through the controller: `/earth/map/assets/...`.

**Step 1: `map.html`**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Collect Earth - Plots Map</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="map/assets/vendor/leaflet.css">
<link rel="stylesheet" href="map/assets/map.css">
</head>
<body>
<div id="banner" class="hidden"></div>
<div id="layout">
  <div id="sidebar">
    <div id="sidebar-header">
      <button id="collapse-btn" title="Collapse">&#9776;</button>
      <span>Plots</span>
      <button id="next-unfinished">Next unfinished</button>
    </div>
    <input id="filter" type="text" placeholder="Filter by id...">
    <label id="only-pending-label"><input type="checkbox" id="only-pending"> only pending</label>
    <ul id="plot-list"></ul>
  </div>
  <div id="mapdiv"></div>
  <div id="form-panel" class="hidden">
    <div id="form-header">
      <span id="form-title"></span>
      <button id="form-close">&times;</button>
    </div>
    <iframe id="form-frame" src="about:blank"></iframe>
  </div>
</div>
<script src="map/assets/vendor/leaflet.js"></script>
<script src="map/assets/map.js"></script>
</body>
</html>
```

**Step 2: `map.css`**

```css
html, body { margin: 0; height: 100%; font-family: Arial, sans-serif; font-size: 13px; }
#layout { display: flex; height: 100%; }
#mapdiv { flex: 1; }
#sidebar { width: 260px; display: flex; flex-direction: column; border-right: 1px solid #ccc; background: #fafafa; }
#sidebar.collapsed { width: 34px; }
#sidebar.collapsed #plot-list, #sidebar.collapsed #filter,
#sidebar.collapsed #only-pending-label, #sidebar.collapsed #next-unfinished,
#sidebar.collapsed #sidebar-header span { display: none; }
#sidebar-header { display: flex; align-items: center; gap: 6px; padding: 6px; font-weight: bold; }
#collapse-btn { cursor: pointer; }
#next-unfinished { margin-left: auto; cursor: pointer; }
#filter { margin: 0 6px 4px 6px; padding: 3px; }
#only-pending-label { margin: 0 6px 4px 6px; color: #555; }
#plot-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
#plot-list li { padding: 4px 8px; cursor: pointer; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 6px; }
#plot-list li:hover { background: #eef; }
#plot-list li.active { background: #dde8ff; font-weight: bold; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.status-empty  { background: #e53935; }
.status-partial{ background: #fdd835; }
.status-saved  { background: #43a047; }
#form-panel { width: 40%; min-width: 420px; display: flex; flex-direction: column; border-left: 1px solid #ccc; }
#form-panel.hidden { display: none; }
#form-header { display: flex; align-items: center; padding: 6px; background: #f0f0f0; }
#form-close { margin-left: auto; cursor: pointer; font-size: 16px; }
#form-frame { flex: 1; border: 0; }
#banner { position: fixed; top: 0; left: 0; right: 0; z-index: 3000; background: #c62828; color: #fff; padding: 6px 12px; }
#banner.hidden { display: none; }
```

**Step 3: `map.js`** — the page logic. Key behaviors, all in one IIFE:

```javascript
(function () {
  "use strict";
  var HOST = window.location.origin + "/earth/";
  var map = L.map("mapdiv");
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  }).addTo(map);

  var STATUS_COLORS = { empty: "#e53935", partial: "#fdd835", saved: "#43a047" };
  var ZOOM_THRESHOLD = 14; // below: circle markers; above: polygons

  var plots = {};        // id -> {feature, layerGroup, marker, status, listItem, center}
  var activeId = null;
  var lastStatusPoll = null; // server "now" from previous /plotStatuses

  function banner(msg) {
    var el = document.getElementById("banner");
    if (!msg) { el.className = "hidden"; return; }
    el.textContent = msg;
    el.className = "";
  }

  // ---------- load plots ----------
  function loadPlots() {
    fetch(HOST + "plotsGeoJson").then(function (r) {
      if (!r.ok) throw new Error("plotsGeoJson HTTP " + r.status);
      return r.json();
    }).then(function (fc) {
      if (!fc.features || fc.features.length === 0) {
        banner("No survey plots loaded - import a CEP file / CSV grid in Collect Earth first.");
        return;
      }
      banner(null);
      var bounds = [];
      fc.features.forEach(function (f) { addPlot(f); bounds.push(plots[f.properties.id].center); });
      map.fitBounds(bounds, { padding: [30, 30] });
      renderList();
      updateVisibility();
      pollStatuses();
      setInterval(pollStatuses, 5000);
    }).catch(function (e) {
      banner("Could not load plots: " + e.message + " - retrying in 5s");
      setTimeout(loadPlots, 5000);
    });
  }

  function addPlot(feature) {
    var id = feature.properties.id;
    var center = [parseFloat(feature.properties.latitude), parseFloat(feature.properties.longitude)];
    var group = L.layerGroup();
    feature.geometry.geometries.forEach(function (g) {
      if (g.type !== "Polygon") return;
      var latlngs = g.coordinates[0].map(function (c) { return [c[1], c[0]]; });
      group.addLayer(L.polygon(latlngs, { color: STATUS_COLORS.empty, weight: 2, fill: false }));
    });
    var marker = L.circleMarker(center, { radius: 5, color: STATUS_COLORS.empty, fillOpacity: 0.9 });
    group.on("click", function () { selectPlot(id); });
    marker.on("click", function () { selectPlot(id); });
    plots[id] = { feature: feature, layerGroup: group, marker: marker, status: "empty", listItem: null, center: center };
  }

  // Zoom-dependent rendering: polygons above threshold, markers below
  function updateVisibility() {
    var showPolys = map.getZoom() >= ZOOM_THRESHOLD;
    Object.keys(plots).forEach(function (id) {
      var p = plots[id];
      if (showPolys) { map.removeLayer(p.marker); p.layerGroup.addTo(map); }
      else { map.removeLayer(p.layerGroup); p.marker.addTo(map); }
    });
  }
  map.on("zoomend", updateVisibility);

  // ---------- status ----------
  function pollStatuses() {
    var url = HOST + "plotStatuses" + (lastStatusPoll ? "?since=" + lastStatusPoll : "");
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      lastStatusPoll = data.now;
      Object.keys(data.statuses).forEach(function (id) {
        if (plots[id]) setStatus(id, data.statuses[id]);
      });
    }).catch(function () { /* transient - next poll retries */ });
  }

  function setStatus(id, status) {
    var p = plots[id];
    p.status = status;
    var color = STATUS_COLORS[status] || STATUS_COLORS.empty;
    p.layerGroup.eachLayer(function (l) { if (id !== activeId) l.setStyle({ color: color }); });
    p.marker.setStyle({ color: color });
    if (p.listItem) p.listItem.querySelector(".status-dot").className = "status-dot status-" + status;
  }

  // ---------- list ----------
  function renderList() {
    var ul = document.getElementById("plot-list");
    ul.innerHTML = "";
    var filter = document.getElementById("filter").value.toLowerCase();
    var onlyPending = document.getElementById("only-pending").checked;
    Object.keys(plots).forEach(function (id) {
      var p = plots[id];
      if (filter && id.toLowerCase().indexOf(filter) === -1) return;
      if (onlyPending && p.status === "saved") return;
      var li = document.createElement("li");
      // no innerHTML: plot ids come from the survey CSV (untrusted for the DOM)
      var dot = document.createElement("span");
      dot.className = "status-dot status-" + p.status;
      var label = document.createElement("span");
      label.textContent = id;
      li.appendChild(dot);
      li.appendChild(label);
      li.onclick = function () { selectPlot(id); };
      if (id === activeId) li.className = "active";
      p.listItem = li;
      ul.appendChild(li);
    });
  }
  document.getElementById("filter").oninput = renderList;
  document.getElementById("only-pending").onchange = renderList;
  document.getElementById("collapse-btn").onclick = function () {
    document.getElementById("sidebar").classList.toggle("collapsed");
    setTimeout(function () { map.invalidateSize(); }, 50);
  };
  document.getElementById("next-unfinished").onclick = function () {
    var ids = Object.keys(plots);
    var start = activeId ? ids.indexOf(activeId) + 1 : 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[(start + i) % ids.length];
      if (plots[id].status !== "saved") { selectPlot(id); return; }
    }
  };

  // ---------- selection / form / aux windows ----------
  function selectPlot(id) {
    if (activeId && plots[activeId]) {
      setStatus(activeId, plots[activeId].status); // restore color
      if (plots[activeId].listItem) plots[activeId].listItem.className = "";
    }
    activeId = id;
    var p = plots[id];
    p.layerGroup.eachLayer(function (l) { l.setStyle({ color: "#00e5ff" }); });
    if (p.listItem) { p.listItem.className = "active"; p.listItem.scrollIntoView({ block: "nearest" }); }
    map.setView(p.center, Math.max(map.getZoom(), 17));

    // form iframe: /balloon does server-side $[...] substitution with these params
    var props = p.feature.properties;
    var params = [];
    Object.keys(props).forEach(function (k) {
      params.push(encodeURIComponent(k) + "=" + encodeURIComponent(props[k] == null ? "" : props[k]));
    });
    params.push("host=" + encodeURIComponent(HOST));
    params.push("local_port=" + encodeURIComponent(window.location.port));
    params.push("randomNumber=" + Date.now());
    document.getElementById("form-frame").src = HOST + "balloon?" + params.join("&");
    document.getElementById("form-title").textContent = "Plot " + id;
    document.getElementById("form-panel").className = "";
    setTimeout(function () { map.invalidateSize(); }, 50);

    // fire the auxiliary windows (GEE App, Google Earth Web, ...) like a balloon would
    fetch(HOST + "openAuxiliaryWindows?latLongCoordinates=" + props.latitude + "," + props.longitude)
      .catch(function () { /* non-fatal */ });
  }

  document.getElementById("form-close").onclick = function () {
    document.getElementById("form-panel").className = "hidden";
    document.getElementById("form-frame").src = "about:blank";
    setTimeout(function () { map.invalidateSize(); }, 50);
  };

  loadPlots();
})();
```

**Note for implementer:** Leaflet 1.9's `leaflet.css` references `images/` relatively — the `/map/assets/vendor/{file}` route must also match `vendor/images/*.png`; that's why the two-level `{folder}/{file}` mapping exists in the controller. Verify by loading the page and checking the Network tab for 404s.

**Step 4: Commit.**
```bash
git add collect-earth/collect-earth-app/src/main/resources/leafletmap
git commit -m "feat: Leaflet map page - plot rendering, status list, form panel"
```

---

### Task 6: BrowserService.openLeafletMap()

**Files:**
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/BrowserService.java`

**Step 1:** Add `LEAFLET_MAP` to the `BrowserType` enum and `webDriverLeafletMap` to the volatile driver fields (exact pattern of `GOOGLE_EARTH_WEB` / `webDriverGoogleEarthWeb`, added in commit 15fd5493).

**Step 2:** Add next to `openGoogleEarthWeb`:

```java
	/**
	 * Opens the Collect Earth Leaflet plots map (served by the embedded server)
	 * in a Selenium-driven browser window.
	 */
	public void openLeafletMap() {
		Object lock = getOrCreateLock(BrowserType.LEAFLET_MAP);
		synchronized (lock) {
			try {
				String url = ServerController.getHostAddress(localPropertiesService.getHost(),
						localPropertiesService.getLocalPort()) + "map";
				webDriverLeafletMap = navigateTo(url, webDriverLeafletMap);
			} catch (final Exception e) {
				logger.error("Problems loading the Leaflet plots map", e);
			}
		}
	}
```

(`ServerController` is already imported in this class? If not, use the same import as `BalloonServlet`: `org.openforis.collect.earth.app.desktop.ServerController`.)

**Step 3: Compile.** `mvn -q compile -pl collect-earth-app -am -DskipTests` → exit 0.

**Step 4: Commit.** `git commit -am "feat: BrowserService.openLeafletMap()"`

---

### Task 7: EarthApp branch — skip GEP when Leaflet mode is on

**Files:**
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/desktop/EarthApp.java` (method `simulateClickKmz`, ~line 719)

Branching inside `simulateClickKmz()` covers every call site (server-start listener, project import, options-dialog reload) with one change.

**Step 1:** Replace the body of `simulateClickKmz()`:

```java
	private void simulateClickKmz() {
		try {
			if (getLocalProperties().isLeafletMapSupported()) {
				// Leaflet viewer mode: no KML handoff to Google Earth Pro;
				// open the plots map served by the embedded server instead.
				openLeafletMap();
			} else {
				getKmlGeneratorService().generateLoaderKmlFile();
				openKmlOnGoogleEarth();
			}
		} catch (final Exception e) {
			showMessage(Messages.getString("EarthApp.61")); //$NON-NLS-1$
			logger.error("The KMZ file could not be found", e); //$NON-NLS-1$
		}
	}
```

**Step 2:** Add the helper (near `openKmlOnGoogleEarth()`); find how `EarthApp` accesses Spring beans — other code uses `serverController.getContext().getBean(...)` (check `getKmlGeneratorService()` / `getLocalProperties()` for the existing accessor pattern and copy it):

```java
	private void openLeafletMap() {
		new Thread("Open Leaflet plots map") {
			@Override
			public void run() {
				try {
					BrowserService browserService = serverController.getContext().getBean(BrowserService.class);
					browserService.openLeafletMap();
				} catch (final Exception e) {
					logger.error("Error opening the Leaflet plots map", e);
				}
			}
		}.start();
	}
```

**Note:** check how `EarthApp` obtains `getLocalProperties()` — it exists (used for host/port); if named differently (e.g. `getLocalPropertiesService()`), adapt. Same for the Spring context accessor: search `getBean` in `EarthApp.java` and reuse the existing idiom.

**Step 3: Compile.** exit 0. **Step 4: Commit.** `git commit -am "feat: open Leaflet map instead of GEP when OPEN_IN_LEAFLET_MAP is on"`

---

### Task 8: Properties checkbox + Tools menu entry + strings

**Files:**
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/view/properties/ExternalServicesPanel.java`
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/view/CollectEarthMenu.java`
- Modify: `collect-earth-app/src/main/resources/org/openforis/collect/earth/app/view/Messages.properties` (+ `_fr`, `_es`, `_pt`)

**Step 1: Checkbox.** Mirror the `openGoogleEarthWebCheckbox` addition (commit 15fd5493 shows the full pattern): field `openInLeafletMapCheckbox`, creation with key `"OptionWizard.146"` and `EarthProperty.OPEN_IN_LEAFLET_MAP`, `registerComponent`, layout row `gridy(5)` **incrementing all subsequent gridy values by one** (read the whole layout method; planetPanel 5→6, SecureWatch 6→7, Maxar label/field 7→8, Extra label 8→9, Extra field 9→10), getter.

**Step 2: Menu entry.** In `CollectEarthMenu.java`, find the Tools menu construction (search `CollectEarthWindow.12` = "Tools") and add a menu item labeled with key `"CollectEarthMenu.openPlotsMap"` whose action calls `BrowserService.openLeafletMap()` (see how other menu items obtain services — follow the existing pattern in that class).

**Step 3: Strings.** ONLY in the 4 files that contain `OptionWizard.145`, add below it (keep each file's Latin-1 encoding — pure-ASCII strings below, so plain Edit is safe):
- en: `OptionWizard.146=Open plots in map window (instead of Google Earth)` and `CollectEarthMenu.openPlotsMap=Open plots map`
- fr: `OptionWizard.146=Ouvrir les parcelles dans une fenetre carte (au lieu de Google Earth)` / `CollectEarthMenu.openPlotsMap=Ouvrir la carte des parcelles`
- es: `OptionWizard.146=Abrir las parcelas en una ventana de mapa (en lugar de Google Earth)` / `CollectEarthMenu.openPlotsMap=Abrir el mapa de parcelas`
- pt: `OptionWizard.146=Abrir as parcelas numa janela de mapa (em vez do Google Earth)` / `CollectEarthMenu.openPlotsMap=Abrir o mapa de parcelas`

**CRITICAL:** Do NOT rewrite the `Messages_*.properties` files wholesale — they are ISO-8859-1 encoded; use surgical single-line Edit insertions only (a full-file rewrite re-encodes them to UTF-8 and corrupts every accent — this already happened once).

**Step 4: Compile.** exit 0. **Step 5: Commit.** `git commit -am "feat: Leaflet map option in properties dialog + Tools menu entry"`

---

### Task 9: End-to-end verification (manual, with fixes)

**Step 1: Full build.** `mvn -q install -DskipTests` → exit 0.

**Step 2: Run** `java -jar collect-earth-app/target/CollectEarth.jar`, load the demo survey (`resources/demo_survey.cep` via File → Import CEP if none loaded).

**Step 3: Walk the acceptance script** (from the design doc):
1. Properties → tick "Open plots in map window" → restart handoff: map window opens, no GEP, plots visible, map fitted; all plots red.
2. Click a plot → cyan highlight, right panel opens with the survey form (check browser devtools Network tab: no 404s on `map/assets/**`, `/balloon` loads with the form's earthFiles assets), GEE/GEW windows fly to the plot (if those checkboxes are on).
3. Fill mandatory fields → Save → within 5 s the plot turns green on map and in the list.
4. "Next unfinished", filter box, "only pending", sidebar collapse, form close — all behave.
5. Tools → "Open plots map" reopens a closed window.
6. Untick the property → restart → classic GEP flow works exactly as before.

**Step 4:** Fix whatever the script surfaces (likely candidates flagged in the task notes: `$[...]` param names the survey balloon expects but the GeoJSON properties miss — compare with a `<Data name=...>` dump from `generated/plots.kml`; the status-key vs feature-id mismatch; Leaflet CSS image paths). Re-run the script after each fix.

**Step 5: Final commit.**
```bash
git add -A -- collect-earth/
git commit -m "fix: Leaflet map viewer E2E fixes from acceptance run"
```

---

## Out of scope (YAGNI — deferred deliberately)

- Predefined-polygon surveys with raw-KML columns (center marker only).
- WebSockets/SSE status push (5 s polling is the GEP-parity baseline).
- Marker clustering libraries (zoom-threshold rendering suffices for 5k plots).
- Removing/retiring any GEP code path.
