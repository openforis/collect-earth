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
        map.setView([0, 0], 3);
        // A warning is a valid, final state (e.g. no survey file loaded) - show the
        // server's message and do NOT enter the retry path; the page must be reloaded.
        banner(fc.warning || "No survey plots loaded - import a CEP file / CSV grid in Collect Earth first.");
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
    if (p.listItem) p.listItem.querySelector(".status-dot").className = "status-dot status-" + status;
    if (id === activeId) return; // active plot keeps the cyan highlight
    var color = STATUS_COLORS[status] || STATUS_COLORS.empty;
    p.layerGroup.eachLayer(function (l) { l.setStyle({ color: color }); });
    p.marker.setStyle({ color: color });
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
    setTimeout(function () { map.invalidateSize(); }, 50);
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
    p.layerGroup.eachLayer(function (l) { l.setStyle({ color: "#00e5ff" }); });
    p.marker.setStyle({ color: "#00e5ff" });
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
    document.getElementById("form-frame").src = HOST + "balloon?" + params.join("&") + "&web=true";
    document.getElementById("form-title").textContent = "Plot " + id;
    document.getElementById("form-panel").className = "";
    setTimeout(function () { map.invalidateSize(); }, 50);

    // fire the auxiliary windows (GEE App, Google Earth Web, ...) like a balloon would;
    // plotId is needed because the coordinates-only path leaves placemarkId null (GEE App URL needs it)
    fetch(HOST + "openAuxiliaryWindows?latLongCoordinates=" + props.latitude + "," + props.longitude
        + "&plotId=" + encodeURIComponent(id))
      .catch(function () { /* non-fatal */ });
  }

  document.getElementById("form-close").onclick = function () {
    document.getElementById("form-panel").className = "hidden";
    document.getElementById("form-frame").src = "about:blank";
    setTimeout(function () { map.invalidateSize(); }, 50);
  };

  loadPlots();
})();
