(function () {
  "use strict";
  var HOST = window.location.origin + "/earth/";

  var STATUS_COLORS = { empty: "#e53935", partial: "#fdd835", saved: "#43a047" };
  var STATUS_LABELS = { empty: "Not started", partial: "In progress", saved: "Completed" };
  var ACTIVE_COLOR = "#00e5ff";
  var ZOOM_THRESHOLD = 14; // below: circle markers; above: polygons (engines report zoom relative to this)
  var PLOT_ZOOM = 17;

  var plots = {};        // id -> {feature, status, listItem, center} (the engine owns its own layer handles keyed by id)
  var order = [];        // plot ids in CSV order (list order, "next" order)
  var activeId = null;
  var cursorId = null;   // keyboard cursor in the list (Enter opens it)
  var lastStatusPoll = null; // server "now" from previous /plotStatuses
  var engine = null;         // the active map engine (Leaflet or Google), chosen from /mapConfig
  var filterMode = "all";    // all | pending | saved
  var countsTimer = null;

  function $(id) { return document.getElementById(id); }

  // ---------- per-viewer UI preferences (best effort: storage can be unavailable) ----------
  var PREFS_KEY = "ce.plotsMap.prefs";
  function loadPrefs() {
    try { return JSON.parse(window.localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
  }
  var prefs = loadPrefs();
  function savePref(name, value) {
    prefs[name] = value;
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  // ---------- banners ----------
  // Load/warning banner. banner(null) clears it, but never a fallback notice: the
  // notice is shown before the plots load and must survive the successful load.
  function banner(msg) {
    var el = $("banner");
    if (!msg) { if (el.className !== "notice") el.className = "hidden"; return; }
    $("banner-close").hidden = true;
    $("banner-text").textContent = msg;
    el.className = "";
  }

  // Non-fatal, dismissible notice shown when the requested engine is unavailable and
  // the page falls back to Leaflet. Kept separate from banner() so the load/warning
  // banners are never accidentally dismissible.
  function fallbackNotice(msg) {
    $("banner-text").textContent = msg;
    $("banner-close").hidden = false;
    $("banner").className = "notice";
  }
  $("banner-close").onclick = function () { $("banner").className = "hidden"; };

  // Tell the engine its container changed size. Called synchronously right after the
  // layout change: a delayed resize could land in the middle of an animated pan to the
  // next plot and snap the map back to where it started.
  function resizeMap() {
    if (engine) engine.invalidateSize();
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
        $("progress-text").textContent = "No plots";
        return;
      }
      banner(null);
      fc.features.forEach(addPlot);
      engine.fitAll(allCenters());
      buildList();
      updateVisibility();
      updateCounts();
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
    if (!plots[id]) order.push(id);
    plots[id] = { feature: feature, status: "empty", listItem: null, center: center };
  }

  function allCenters() {
    return order.map(function (id) { return plots[id].center; });
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
    if (!STATUS_LABELS[status]) status = "empty";
    var changed = p.status !== status;
    p.status = status;
    if (p.listItem) {
      p.listItem.querySelector(".status-dot").className = "status-dot status-" + status;
      p.listItem.querySelector(".plot-status").textContent = STATUS_LABELS[status];
      p.listItem.hidden = !matchesFilter(id);
    }
    if (id === activeId) updateFormStatus();
    if (changed) scheduleCounts();
    if (id === activeId) return; // active plot keeps the cyan highlight
    engine.setPlotColor(id, STATUS_COLORS[status]);
  }

  // Counts are recomputed in one pass; batched so a large status poll does it once.
  function scheduleCounts() {
    if (countsTimer) return;
    countsTimer = setTimeout(function () { countsTimer = null; updateCounts(); }, 0);
  }

  function updateCounts() {
    var total = order.length, saved = 0, partial = 0;
    order.forEach(function (id) {
      if (plots[id].status === "saved") saved++;
      else if (plots[id].status === "partial") partial++;
    });
    $("count-all").textContent = total;
    $("count-pending").textContent = total - saved;
    $("count-saved").textContent = saved;
    var pct = total ? Math.round(saved * 100 / total) : 0;
    $("progress-text").textContent = saved + " of " + total + " completed (" + pct + "%)";
    $("progress-saved").style.width = (total ? saved * 100 / total : 0) + "%";
    $("progress-partial").style.width = (total ? partial * 100 / total : 0) + "%";
    updateEmptyListHint();
  }

  // ---------- list ----------
  // Built once after loading; filtering and status changes only toggle/patch items,
  // so grids with thousands of plots stay responsive while typing.
  function buildList() {
    var ul = $("plot-list");
    var fragment = document.createDocumentFragment();
    order.forEach(function (id) {
      var p = plots[id];
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.id = id;
      // no innerHTML: plot ids come from the survey CSV (untrusted for the DOM)
      var dot = document.createElement("span");
      dot.className = "status-dot status-" + p.status;
      var label = document.createElement("span");
      label.className = "plot-id";
      label.textContent = id;
      label.title = id;
      var statusText = document.createElement("span");
      statusText.className = "plot-status";
      statusText.textContent = STATUS_LABELS[p.status];
      li.appendChild(dot);
      li.appendChild(label);
      li.appendChild(statusText);
      p.listItem = li;
      fragment.appendChild(li);
    });
    ul.innerHTML = "";
    ul.appendChild(fragment);
    applyFilter();
  }

  // One delegated handler instead of one closure per plot
  $("plot-list").addEventListener("click", function (e) {
    var li = e.target.closest("li");
    if (li && li.dataset.id) selectPlot(li.dataset.id);
  });

  function matchesFilter(id) {
    var status = plots[id].status;
    if (filterMode === "pending" && status === "saved") return false;
    if (filterMode === "saved" && status !== "saved") return false;
    var query = $("filter").value.trim().toLowerCase();
    return !query || id.toLowerCase().indexOf(query) !== -1;
  }

  function applyFilter() {
    order.forEach(function (id) {
      var li = plots[id].listItem;
      if (li) li.hidden = !matchesFilter(id);
    });
    updateEmptyListHint();
  }

  function updateEmptyListHint() {
    if (!order.length) return;
    var anyVisible = order.some(function (id) { return plots[id].listItem && !plots[id].listItem.hidden; });
    $("list-empty").hidden = anyVisible;
  }

  var filterTimer = null;
  $("filter").addEventListener("input", function () {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilter, 120);
  });

  function setFilterMode(mode) {
    filterMode = mode;
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (chip) {
      chip.setAttribute("aria-checked", chip.dataset.filter === mode ? "true" : "false");
    });
    savePref("filter", mode);
    applyFilter();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (chip) {
    chip.onclick = function () { setFilterMode(chip.dataset.filter); };
  });
  setFilterMode(prefs.filter === "pending" || prefs.filter === "saved" ? prefs.filter : "all");

  function setCollapsed(collapsed) {
    if ($("sidebar").classList.contains("collapsed") === collapsed) return;
    $("sidebar").classList.toggle("collapsed", collapsed);
    savePref("collapsed", collapsed);
  }
  // The sidebar width is animated: resize the map once the transition has finished
  $("sidebar").addEventListener("transitionend", function (e) {
    if (e.target === $("sidebar") && e.propertyName === "width") resizeMap();
  });
  $("collapse-btn").onclick = function () { setCollapsed(!$("sidebar").classList.contains("collapsed")); };
  if (prefs.collapsed) $("sidebar").classList.add("collapsed");

  function goToNextUnfinished() {
    if (!order.length) return;
    var start = activeId ? order.indexOf(activeId) + 1 : 0;
    for (var i = 0; i < order.length; i++) {
      var id = order[(start + i) % order.length];
      if (plots[id].status !== "saved") { selectPlot(id); return; }
    }
  }
  $("next-unfinished").onclick = goToNextUnfinished;

  // Neighbour of `fromId` among the plots currently shown in the list (or all plots
  // when the filter hides everything); step is +1 / -1. Returns null at the ends.
  function neighbour(fromId, step) {
    var visible = order.filter(function (id) { return plots[id].listItem && !plots[id].listItem.hidden; });
    var ids = visible.length ? visible : order;
    var index = ids.indexOf(fromId);
    if (index === -1) return ids.length ? ids[step > 0 ? 0 : ids.length - 1] : null;
    var next = index + step;
    return next >= 0 && next < ids.length ? ids[next] : null;
  }

  function moveCursor(step) {
    var id = neighbour(cursorId || activeId, step);
    if (!id) return;
    if (cursorId && plots[cursorId] && plots[cursorId].listItem) plots[cursorId].listItem.classList.remove("cursor");
    cursorId = id;
    var li = plots[id].listItem;
    li.classList.add("cursor");
    li.scrollIntoView({ block: "nearest" });
  }

  $("form-prev").onclick = function () { var id = neighbour(activeId, -1); if (id) selectPlot(id); };
  $("form-next").onclick = function () { var id = neighbour(activeId, 1); if (id) selectPlot(id); };

  $("fit-all").onclick = function () { if (order.length) engine.fitAll(allCenters()); };
  $("center-active").onclick = function () { if (activeId) engine.flyTo(plots[activeId].center, PLOT_ZOOM); };

  // ---------- keyboard ----------
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
    if (typing) {
      if (e.key === "Escape") { e.target.blur(); }
      else if (e.key === "Enter" && e.target.id === "filter") {
        var first = neighbour(null, 1);
        if (first && matchesFilter(first)) selectPlot(first);
      }
      return;
    }
    if (e.key === "/") { e.preventDefault(); setCollapsed(false); $("filter").focus(); $("filter").select(); }
    else if (e.key === "n" || e.key === "N") { goToNextUnfinished(); }
    else if (e.key === "Escape") { closeForm(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (e.target === $("plot-list")) { e.preventDefault(); moveCursor(e.key === "ArrowDown" ? 1 : -1); }
    } else if (e.key === "Enter" && e.target === $("plot-list") && cursorId) { selectPlot(cursorId); }
  });

  // ---------- form panel resize ----------
  (function () {
    var panel = $("form-panel");
    if (prefs.formWidth) panel.style.width = prefs.formWidth + "px";
    $("resize-handle").addEventListener("mousedown", function (e) {
      e.preventDefault();
      document.body.classList.add("resizing");
      function onMove(ev) {
        var width = Math.round(window.innerWidth - ev.clientX);
        width = Math.max(380, Math.min(width, Math.round(window.innerWidth * 0.75)));
        panel.style.width = width + "px";
      }
      function onUp() {
        document.body.classList.remove("resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        savePref("formWidth", parseInt(panel.style.width, 10));
        resizeMap();
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  })();

  // ---------- web form <-> map messages (same-origin postMessage) ----------
  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return; // ignore cross-origin messages
    var data = event.data;
    if (!data || !data.type) return;
    var plotId = data.plotId;
    // ignore messages for anything but the active plot (stale iframe race)
    if (plotId == null || plotId !== activeId) return;
    if (!plots[plotId]) return;
    if (data.type === "ce:saved") {
      // setStatus leaves the active plot's cyan highlight alone; then advance.
      setStatus(plotId, "saved");
      goToNextUnfinished();
    } else if (data.type === "ce:dirty") {
      setStatus(plotId, "partial");
    }
  });

  // ---------- selection / form / aux windows ----------
  function updateFormStatus() {
    var pill = $("form-status");
    if (!activeId) { pill.textContent = ""; pill.className = "pill"; return; }
    var status = plots[activeId].status;
    pill.textContent = STATUS_LABELS[status];
    pill.className = "pill status-" + status;
  }

  function selectPlot(id) {
    var previous = activeId;
    activeId = id;
    if (previous && plots[previous]) {
      setStatus(previous, plots[previous].status); // restore color now that activeId points elsewhere
      if (plots[previous].listItem) {
        plots[previous].listItem.classList.remove("active");
        plots[previous].listItem.removeAttribute("aria-selected");
      }
    }
    if (cursorId && plots[cursorId] && plots[cursorId].listItem) plots[cursorId].listItem.classList.remove("cursor");
    cursorId = id;
    var p = plots[id];
    engine.setPlotColor(id, ACTIVE_COLOR);
    if (p.listItem) {
      p.listItem.classList.add("active");
      p.listItem.setAttribute("aria-selected", "true");
      if (!p.listItem.hidden) p.listItem.scrollIntoView({ block: "nearest" });
    }
    // Open the form panel and resize the map BEFORE moving it, so the plot ends up
    // centered in the remaining map area (resizing after an animated pan would
    // re-center on an intermediate position).
    if ($("form-panel").classList.contains("hidden")) {
      $("form-panel").classList.remove("hidden");
      engine.invalidateSize();
    }
    engine.flyTo(p.center, PLOT_ZOOM);

    // form iframe: /balloon does server-side $[...] substitution with these params
    var props = p.feature.properties;
    var params = [];
    Object.keys(props).forEach(function (k) {
      params.push(encodeURIComponent(k) + "=" + encodeURIComponent(props[k] == null ? "" : props[k]));
    });
    params.push("host=" + encodeURIComponent(HOST));
    params.push("local_port=" + encodeURIComponent(window.location.port));
    params.push("randomNumber=" + Date.now());
    $("form-frame").src = HOST + "balloon?" + params.join("&") + "&web=true";
    $("form-title").textContent = "Plot " + id;
    updateFormStatus();
    $("form-prev").disabled = !neighbour(id, -1);
    $("form-next").disabled = !neighbour(id, 1);
    $("center-active").disabled = false;

    // fire the auxiliary windows (GEE App, Google Earth Web, ...) like a balloon would;
    // plotId is needed because the coordinates-only path leaves placemarkId null (GEE App URL needs it)
    fetch(HOST + "openAuxiliaryWindows?latLongCoordinates=" + props.latitude + "," + props.longitude
        + "&plotId=" + encodeURIComponent(id))
      .catch(function () { /* non-fatal */ });
  }

  function closeForm() {
    if ($("form-panel").classList.contains("hidden")) return;
    $("form-panel").classList.add("hidden");
    $("form-frame").src = "about:blank";
    resizeMap();
  }
  $("form-close").onclick = closeForm;

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

  function engineConfig(apiKey) {
    return {
      zoomThreshold: ZOOM_THRESHOLD, emptyColor: STATUS_COLORS.empty, apiKey: apiKey,
      onEngineFailure: handleEngineFailure,
      baseLayer: prefs.baseLayer, onBaseLayerChange: function (name) { savePref("baseLayer", name); }
    };
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
    engine.init("mapdiv", engineConfig(""), { onPlotClick: selectPlot, onZoomChange: updateVisibility });
    // Re-add every already-loaded plot with its CURRENT color (active plot stays cyan).
    order.forEach(function (id) {
      var p = plots[id];
      engine.addPlot(id, ringsOf(p.feature), p.center);
      engine.setPlotColor(id, id === activeId ? ACTIVE_COLOR : STATUS_COLORS[p.status]);
    });
    // If the user was working on a plot when the engine died, stay on it
    // instead of zooming out to the whole grid.
    if (activeId && plots[activeId]) {
      engine.flyTo(plots[activeId].center, PLOT_ZOOM);
    } else if (order.length) {
      engine.fitAll(allCenters());
    }
    updateVisibility();
    fallbackNotice(reason + " - using Leaflet/ESRI. Check GOOGLE_MAPS_API_KEY in Properties (the key needs the Maps JavaScript API enabled).");
  }

  function boot(config) {
    var notice = selectEngine(config);
    engine.init("mapdiv", engineConfig(config.googleMapsApiKey || ""),
      { onPlotClick: selectPlot, onZoomChange: updateVisibility });
    if (notice) fallbackNotice(notice);
    $("gew-badge").hidden = config.viewerType !== "google_earth_web";
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
