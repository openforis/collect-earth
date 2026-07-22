(function () {
  "use strict";
  window.CEMapEngines = window.CEMapEngines || {};

  // All Leaflet (L.*) map interaction lives here, behind the engine interface.
  // Relocated verbatim from the original map.js - zero behavior change.
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
      var map = L.map(containerId);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
      }).addTo(map);
      map.on("zoomend", function () { self._callbacks.onZoomChange(); });
      this._map = map;
    },

    // rings: array of [lat,lng] arrays; center: [lat,lng]
    addPlot: function (id, rings, center) {
      var self = this;
      var group = L.layerGroup();
      rings.forEach(function (latlngs) {
        group.addLayer(L.polygon(latlngs, { color: self._emptyColor, weight: 2, fill: false }));
      });
      var marker = L.circleMarker(center, { radius: 5, color: this._emptyColor, fillOpacity: 0.9 });
      group.on("click", function () { self._callbacks.onPlotClick(id); });
      marker.on("click", function () { self._callbacks.onPlotClick(id); });
      this._layers[id] = { layerGroup: group, marker: marker };
    },

    // colorHex applies to BOTH the polygons and the dot marker
    setPlotColor: function (id, colorHex) {
      var l = this._layers[id];
      if (!l) return;
      l.layerGroup.eachLayer(function (layer) { layer.setStyle({ color: colorHex }); });
      l.marker.setStyle({ color: colorHex });
    },

    // minZoom: zoom to at least this level without zooming out if already closer.
    // getZoom() is undefined before any view is set (empty-survey world view), so the
    // "|| minZoom" fallback reproduces both original setView call sites exactly.
    flyTo: function (center, minZoom) {
      var map = this._map;
      map.setView(center, Math.max(map.getZoom() || minZoom, minZoom));
    },

    fitAll: function (centers) {
      this._map.fitBounds(centers, { padding: [30, 30] });
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
    // form panel open/close). Not one of the core interface's data methods, but a
    // required side-effect of the original map.js - see report.
    invalidateSize: function () {
      this._map.invalidateSize();
    },

    destroy: function () {
      if (this._map) { this._map.remove(); this._map = null; }
      this._layers = {};
    }
  };
})();
