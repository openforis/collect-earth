(function () {
  "use strict";
  var HOST = window.location.origin + "/earth/";

  var STATUS_COLORS = { empty: "#e53935", partial: "#fdd835", saved: "#43a047" };
  var ZOOM_THRESHOLD = 14; // below: circle markers; above: polygons (engines report zoom relative to this)

  var plots = {};        // id -> {feature, status, listItem, center} (the engine owns its own layer handles keyed by id)
  var activeId = null;
  var lastStatusPoll = null; // server "now" from previous /plotStatuses
  var engine = null;         // the active map engine (Leaflet or Google), chosen from /mapConfig

  function banner(msg) {
    var el = document.getElementById("banner");
    // A fallbackNotice() may have made the element dismissible - reset that
    // state so regular banners are never accidentally click-to-hide.
    el.onclick = null;
    el.style.cursor = "";
    el.title = "";
    if (!msg) { el.className = "hidden"; return; }
    el.textContent = msg;
    el.className = "";
  }

  // Non-fatal, dismissible notice shown when the requested engine is unavailable and
  // the page falls back to Leaflet. Kept separate from banner() so the existing
  // load/warning banners keep behaving exactly as before.
  function fallbackNotice(msg) {
    var el = document.getElementById("banner");
    el.textContent = msg;
    el.className = "";
    el.style.cursor = "pointer";
    el.title = "Click to dismiss";
    el.onclick = function () { el.className = "hidden"; el.onclick = null; el.style.cursor = ""; el.title = ""; };
  }

  // ---------- load plots ----------
  function loadPlots() {
    fetch(HOST + "plotsGeoJson").then(function (r) {
      if (!r.ok) throw new Error("plotsGeoJson HTTP " + r.status);
      return r.json();
    }).then(function (fc) {
      if (!fc.features || fc.features.length === 0) {
        engine.flyTo([0, 0], 3);
        // A warning is a valid, final state (e.g. no survey file loaded) - show the
        // server's message and do NOT enter the retry path; the page must be reloaded.
        banner(fc.warning || "No survey plots loaded - import a CEP file / CSV grid in Collect Earth first.");
        return;
      }
      banner(null);
      var centers = [];
      fc.features.forEach(function (f) { addPlot(f); centers.push(plots[f.properties.id].center); });
      engine.fitAll(centers);
      renderList();
      updateVisibility();
      pollStatuses();
      setInterval(pollStatuses, 5000);
    }).catch(function (e) {
      banner("Could not load plots: " + e.message + " - retrying in 5s");
      setTimeout(loadPlots, 5000);
    });
  }

  // GeoJSON MultiPolygon -> array of [lat,lng] rings (swap lng/lat). Shared by the
  // initial load and the runtime fallback that re-adds plots to a fresh engine.
  function ringsOf(feature) {
    var rings = [];
    feature.geometry.geometries.forEach(function (g) {
      if (g.type !== "Polygon") return;
      rings.push(g.coordinates[0].map(function (c) { return [c[1], c[0]]; }));
    });
    return rings;
  }

  function addPlot(feature) {
    var id = feature.properties.id;
    var center = [parseFloat(feature.properties.latitude), parseFloat(feature.properties.longitude)];
    engine.addPlot(id, ringsOf(feature), center);
    plots[id] = { feature: feature, status: "empty", listItem: null, center: center };
  }

  // Zoom-dependent rendering: polygons above threshold, markers below (engine swaps them)
  function updateVisibility() {
    engine.setZoomVisibilityMode(engine.isAboveThreshold());
  }

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
    if (p.listItem) p.listItem.querySelector(".status-dot").className = "status-dot status-" + status;
    if (id === activeId) return; // active plot keeps the cyan highlight
    var color = STATUS_COLORS[status] || STATUS_COLORS.empty;
    engine.setPlotColor(id, color);
  }

  // ---------- list ----------
  function renderList() {
    var ul = document.getElementById("plot-list");
    ul.innerHTML = "";
    var filter = document.getElementById("filter").value.toLowerCase();
    var onlyPending = document.getElementById("only-pending").checked;
    Object.keys(plots).forEach(function (k) { plots[k].listItem = null; });
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
    setTimeout(function () { engine.invalidateSize(); }, 50);
  };
  function goToNextUnfinished() {
    var ids = Object.keys(plots);
    var start = activeId ? ids.indexOf(activeId) + 1 : 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[(start + i) % ids.length];
      if (plots[id].status !== "saved") { selectPlot(id); return; }
    }
  }
  document.getElementById("next-unfinished").onclick = goToNextUnfinished;

  // ---------- web form <-> map messages (same-origin postMessage) ----------
  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return; // ignore cross-origin messages
    var data = event.data;
    if (!data || !data.type) return;
    var plotId = data.plotId;
    // ignore messages for anything but the active plot (stale iframe race)
    if (plotId == null || plotId !== activeId) return;
    var p = plots[plotId];
    if (!p) return;
    if (data.type === "ce:saved") {
      // Active plot keeps its cyan highlight: only record the status and update the
      // list dot (not the map polygon color), then advance to the next unfinished plot.
      p.status = "saved";
      if (p.listItem) p.listItem.querySelector(".status-dot").className = "status-dot status-saved";
      goToNextUnfinished();
    } else if (data.type === "ce:dirty") {
      p.status = "partial";
      if (p.listItem) p.listItem.querySelector(".status-dot").className = "status-dot status-partial";
    }
  });

  // ---------- selection / form / aux windows ----------
  function selectPlot(id) {
    var previous = activeId;
    activeId = id;
    if (previous && plots[previous]) {
      setStatus(previous, plots[previous].status); // restore color now that activeId points elsewhere
      if (plots[previous].listItem) plots[previous].listItem.className = "";
    }
    var p = plots[id];
    engine.setPlotColor(id, "#00e5ff");
    if (p.listItem) { p.listItem.className = "active"; p.listItem.scrollIntoView({ block: "nearest" }); }
    engine.flyTo(p.center, 17);

    // form iframe: /balloon does server-side $[...] substitution with these params
    var props = p.feature.properties;
    var params = [];
    Object.keys(props).forEach(function (k) {
      params.push(encodeURIComponent(k) + "=" + encodeURIComponent(props[k] == null ? "" : props[k]));
    });
    params.push("host=" + encodeURIComponent(HOST));
    params.push("local_port=" + encodeURIComponent(window.location.port));
    params.push("randomNumber=" + Date.now());
    document.getElementById("form-frame").src = HOST + "balloon?" + params.join("&") + "&web=true";
    document.getElementById("form-title").textContent = "Plot " + id;
    document.getElementById("form-panel").className = "";
    setTimeout(function () { engine.invalidateSize(); }, 50);

    // fire the auxiliary windows (GEE App, Google Earth Web, ...) like a balloon would;
    // plotId is needed because the coordinates-only path leaves placemarkId null (GEE App URL needs it)
    fetch(HOST + "openAuxiliaryWindows?latLongCoordinates=" + props.latitude + "," + props.longitude
        + "&plotId=" + encodeURIComponent(id))
      .catch(function () { /* non-fatal */ });
  }

  document.getElementById("form-close").onclick = function () {
    document.getElementById("form-panel").className = "hidden";
    document.getElementById("form-frame").src = "about:blank";
    setTimeout(function () { engine.invalidateSize(); }, 50);
  };

  // ---------- engine selection ----------
  // Chooses google only when the property asks for it AND a non-blank key is present
  // AND the Google engine file is loaded. Otherwise Leaflet, with a dismissible notice
  // when we fell back from an explicit google_maps request (never for a plain leaflet
  // config). Returns the notice text, or null when no notice is warranted.
  function selectEngine(config) {
    var engineName = config.engine;
    var key = config.googleMapsApiKey || "";
    var engines = window.CEMapEngines || {};
    if (engineName === "google_maps" && key !== "" && engines.google) {
      engine = engines.google;
      return null;
    }
    engine = engines.leaflet;
    if (engineName === "google_maps") {
      var suffix = " - using Leaflet/ESRI. Check GOOGLE_MAPS_API_KEY in Properties (the key needs the Maps JavaScript API enabled).";
      if (key === "") return "Google Maps selected but the API key is blank" + suffix;
      return "Google Maps engine is unavailable" + suffix;
    }
    return null;
  }

  // ---------- runtime engine failure -> live Leaflet fallback ----------
  // Fired by an engine (Google) that fails at runtime: key rejected, script load
  // failure, or ready-timeout. Guarded so it runs exactly once, even if the engine
  // reports failure twice or after its own teardown.
  var fellBack = false;
  function handleEngineFailure(reason) {
    if (fellBack) return;
    fellBack = true;
    if (engine && engine.destroy) engine.destroy();
    engine = (window.CEMapEngines || {}).leaflet;
    engine.init("mapdiv",
      { zoomThreshold: ZOOM_THRESHOLD, emptyColor: STATUS_COLORS.empty, apiKey: "", onEngineFailure: handleEngineFailure },
      { onPlotClick: selectPlot, onZoomChange: updateVisibility });
    // Re-add every already-loaded plot with its CURRENT color (active plot stays cyan).
    var centers = [];
    Object.keys(plots).forEach(function (id) {
      var p = plots[id];
      engine.addPlot(id, ringsOf(p.feature), p.center);
      centers.push(p.center);
      var color = (id === activeId) ? "#00e5ff" : (STATUS_COLORS[p.status] || STATUS_COLORS.empty);
      engine.setPlotColor(id, color);
    });
    if (centers.length) engine.fitAll(centers);
    updateVisibility();
    fallbackNotice(reason + " - using Leaflet/ESRI. Check GOOGLE_MAPS_API_KEY in Properties (the key needs the Maps JavaScript API enabled).");
  }

  function boot(config) {
    var notice = selectEngine(config);
    engine.init("mapdiv",
      { zoomThreshold: ZOOM_THRESHOLD, emptyColor: STATUS_COLORS.empty, apiKey: (config.googleMapsApiKey || ""), onEngineFailure: handleEngineFailure },
      { onPlotClick: selectPlot, onZoomChange: updateVisibility });
    if (notice) fallbackNotice(notice);
    loadPlots();
  }

  // Fetch the engine choice FIRST, then instantiate the map and load plots.
  fetch(HOST + "mapConfig").then(function (r) { return r.json(); }).then(function (config) {
    boot(config || {});
  }).catch(function () {
    // Config endpoint unreachable - default to Leaflet so collection still works.
    boot({ engine: "leaflet", googleMapsApiKey: "" });
  });
})();
