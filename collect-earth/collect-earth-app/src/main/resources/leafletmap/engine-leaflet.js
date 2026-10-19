(function () {
  "use strict";
  window.CEMapEngines = window.CEMapEngines || {};

  var ESRI_ATTRIBUTION = "&copy; Esri, Maxar, Earthstar Geographics";

  // Base layers offered in the layer switcher. The first one is the default.
  function createBaseLayers() {
    var imagery = function () {
      return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: ESRI_ATTRIBUTION });
    };
    var labels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: ESRI_ATTRIBUTION });
    return {
      "Satellite (ESRI)": imagery(),
      "Satellite + labels (ESRI)": L.layerGroup([imagery(), labels]),
      "Streets (OpenStreetMap)": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" })
    };
  }

  // All Leaflet (L.*) map interaction lives here, behind the engine interface.
  window.CEMapEngines.leaflet = {
    _map: null,
    _layers: {},          // id -> { layerGroup, marker } (this engine owns its own layer handles)
    _callbacks: null,     // { onPlotClick(id), onZoomChange() }
    _zoomThreshold: 14,   // supplied by core via init config (ZOOM_THRESHOLD lives in core)
    _emptyColor: "#e53935",

    init: function (containerId, config, callbacks) {
      var self = this;
      this._callbacks = callbacks;
      this._layers = {};
      this._zoomThreshold = config.zoomThreshold;
      this._emptyColor = config.emptyColor;
      // Canvas rendering: one <canvas> instead of thousands of SVG nodes for large grids
      var map = L.map(containerId, { preferCanvas: true, zoomControl: true });

      var baseLayers = createBaseLayers();
      var names = Object.keys(baseLayers);
      var initial = names.indexOf(config.baseLayer) !== -1 ? config.baseLayer : names[0];
      baseLayers[initial].addTo(map);
      L.control.layers(baseLayers, null, { position: "topleft" }).addTo(map);
      L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
      map.on("baselayerchange", function (e) {
        if (config.onBaseLayerChange) config.onBaseLayerChange(e.name);
      });

      map.on("zoomend", function () { self._callbacks.onZoomChange(); });
      this._map = map;
    },

    // rings: array of [lat,lng] arrays; center: [lat,lng]
    addPlot: function (id, rings, center) {
      var self = this;
      var group = L.featureGroup();
      rings.forEach(function (latlngs) {
        // Faint fill makes the whole plot clickable, not only its outline
        group.addLayer(L.polygon(latlngs, { color: self._emptyColor, weight: 2, fillColor: self._emptyColor, fillOpacity: 0.04 }));
      });
      // White outline keeps the status color readable on any imagery
      var marker = L.circleMarker(center, {
        radius: 6, color: "#ffffff", weight: 1.5, fillColor: this._emptyColor, fillOpacity: 1
      });
      var tooltip = { className: "plot-tooltip", direction: "top", offset: [0, -6] };
      group.bindTooltip(String(id), tooltip);
      marker.bindTooltip(String(id), tooltip);
      group.on("click", function () { self._callbacks.onPlotClick(id); });
      marker.on("click", function () { self._callbacks.onPlotClick(id); });
      this._layers[id] = { layerGroup: group, marker: marker };
    },

    // colorHex applies to BOTH the polygons (stroke) and the dot marker (fill)
    setPlotColor: function (id, colorHex) {
      var l = this._layers[id];
      if (!l) return;
      l.layerGroup.eachLayer(function (layer) { layer.setStyle({ color: colorHex, fillColor: colorHex }); });
      l.marker.setStyle({ fillColor: colorHex });
    },

    // minZoom: zoom to at least this level without zooming out if already closer.
    // getZoom() is undefined before any view is set (empty-survey world view), so the
    // "|| minZoom" fallback covers that case.
    flyTo: function (center, minZoom) {
      var map = this._map;
      this._whenIdle(function () {
        map.setView(center, Math.max(map.getZoom() || minZoom, minZoom));
      });
    },

    // Leaflet finishes a running zoom animation by moving to ITS target, overriding any
    // setView made meanwhile (e.g. pressing "next" quickly). Defer view changes until
    // the animation has ended; only the latest request is kept.
    _pending: null,
    _whenIdle: function (fn) {
      var self = this, map = this._map;
      if (!map._animatingZoom) { fn(); return; }
      var waiting = this._pending !== null;
      this._pending = fn;
      if (waiting) return;
      map.once("zoomend", function () {
        var next = self._pending;
        self._pending = null;
        if (next && self._map === map) self._whenIdle(next);
      });
    },

    fitAll: function (centers) {
      var map = this._map;
      this._whenIdle(function () { map.fitBounds(centers, { padding: [40, 40], maxZoom: 17 }); });
    },

    // Zoom-dependent rendering: polygons above threshold, markers below
    setZoomVisibilityMode: function (showPolys) {
      var map = this._map;
      var layers = this._layers;
      Object.keys(layers).forEach(function (id) {
        var l = layers[id];
        if (showPolys) { map.removeLayer(l.marker); l.layerGroup.addTo(map); }
        else { map.removeLayer(l.layerGroup); l.marker.addTo(map); }
      });
    },

    isAboveThreshold: function () {
      return this._map.getZoom() >= this._zoomThreshold;
    },

    // Leaflet needs to be told when its container was resized (sidebar collapse,
    // form panel open/close/resize). Leaflet keeps the top-left corner fixed on
    // resize; re-centering keeps the selected plot in the middle of the map.
    invalidateSize: function () {
      var map = this._map;
      if (!map || !map._loaded) { if (map) map.invalidateSize(); return; }
      if (map._animatingZoom) {
        // the container must be measured now; the re-centering waits for the animation
        map.invalidateSize({ pan: false });
        return;
      }
      var center = map.getCenter();
      map.invalidateSize({ pan: false });
      map.setView(center, map.getZoom(), { animate: false });
    },

    destroy: function () {
      if (this._map) { this._map.remove(); this._map = null; }
      this._layers = {};
      this._pending = null;
    }
  };
})();
