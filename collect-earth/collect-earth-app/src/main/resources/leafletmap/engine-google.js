(function () {
  "use strict";
  window.CEMapEngines = window.CEMapEngines || {};

  // Google Maps rendering engine, implementing the SAME interface as engine-leaflet.js.
  // The Maps JS API is loaded asynchronously (Google requires loading from Google's own
  // host), so core may call addPlot/fitAll/flyTo/setZoomVisibilityMode BEFORE the map
  // exists. Those calls are recorded as plain state and flushed the moment the map is
  // ready. A missing/rejected key or a load failure is surfaced to core via
  // config.onEngineFailure(reason), which tears this engine down and swaps in Leaflet.
  window.CEMapEngines.google = {
    _map: null,
    _defs: {},            // id -> { rings, center, color }  (source of truth for plots)
    _layers: {},          // id -> { polygons: [google.maps.Polygon], marker: google.maps.Marker }
    _callbacks: null,     // { onPlotClick(id), onZoomChange() }
    _zoomThreshold: 14,
    _emptyColor: "#e53935",
    _containerId: null,
    _onEngineFailure: null,
    _ready: false,
    _failed: false,
    _destroyed: false,
    _showPolys: false,    // last requested visibility mode (markers below threshold by default)
    _pendingView: null,   // { type: 'fit', centers } | { type: 'fly', center, minZoom }
    _timeoutId: null,
    _zoomListener: null,
    _script: null,

    init: function (containerId, config, callbacks) {
      var self = this;
      this._callbacks = callbacks;
      this._defs = {};
      this._layers = {};
      this._zoomThreshold = config.zoomThreshold;
      this._emptyColor = config.emptyColor;
      this._containerId = containerId;
      this._onEngineFailure = config.onEngineFailure;
      this._map = null;
      this._ready = false;
      this._failed = false;
      this._destroyed = false;
      this._showPolys = false;
      this._pendingView = null;
      this._timeoutId = null;
      this._zoomListener = null;

      // Google calls this global on an invalid/unauthorized key at runtime.
      window.gm_authFailure = function () { self._fail("Google rejected the API key"); };
      // Bootstrap ready callback (matches the &callback= param below).
      window.__ceGmapsReady = function () { self._onReady(); };

      var s = document.createElement("script");
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(config.apiKey)
            + "&v=weekly&loading=async&callback=__ceGmapsReady";
      s.async = true;
      s.onerror = function () { self._fail("Google Maps script failed to load"); };
      this._script = s;
      // If the ready callback never runs (network blocked, silent stall), fall back.
      this._timeoutId = window.setTimeout(function () {
        self._fail("Google Maps took too long to load");
      }, 15000);
      document.head.appendChild(s);
    },

    // ---------- interface ----------

    // rings: array of [lat,lng] arrays; center: [lat,lng]
    addPlot: function (id, rings, center) {
      this._defs[id] = { rings: rings, center: center, color: this._emptyColor };
      if (this._ready) this._createPlot(id);
    },

    // colorHex applies to BOTH the polygons and the dot marker
    setPlotColor: function (id, colorHex) {
      var def = this._defs[id];
      if (def) def.color = colorHex;
      var l = this._layers[id];
      if (!l) return;
      l.polygons.forEach(function (p) { p.setOptions({ strokeColor: colorHex }); });
      l.marker.setIcon(this._markerIcon(colorHex));
    },

    // minZoom: zoom to at least this level without zooming out if already closer.
    // Mirrors engine-leaflet's setView(center, Math.max(getZoom()||minZoom, minZoom)).
    flyTo: function (center, minZoom) {
      if (this._ready) this._doFlyTo(center, minZoom);
      else this._pendingView = { type: "fly", center: center, minZoom: minZoom };
    },

    fitAll: function (centers) {
      if (this._ready) this._doFitAll(centers);
      else this._pendingView = { type: "fit", centers: centers };
    },

    // Zoom-dependent rendering: polygons above threshold, markers below (driven by core)
    setZoomVisibilityMode: function (showPolys) {
      this._showPolys = showPolys;
      if (this._ready) this._applyVisibility();
    },

    isAboveThreshold: function () {
      if (!this._ready || !this._map) return false;
      return this._map.getZoom() >= this._zoomThreshold;
    },

    // Google recomputes its own layout on container resize once told to; a no-op is
    // safe before the map exists.
    invalidateSize: function () {
      if (this._ready && this._map && typeof google !== "undefined" && google.maps) {
        google.maps.event.trigger(this._map, "resize");
      }
    },

    destroy: function () {
      this._destroyed = true;
      if (this._timeoutId) { window.clearTimeout(this._timeoutId); this._timeoutId = null; }
      if (this._zoomListener && typeof google !== "undefined" && google.maps) {
        google.maps.event.removeListener(this._zoomListener);
      }
      this._zoomListener = null;
      var layers = this._layers;
      Object.keys(layers).forEach(function (id) {
        var l = layers[id];
        l.polygons.forEach(function (p) { p.setMap(null); });
        l.marker.setMap(null);
      });
      this._layers = {};
      this._defs = {};
      this._map = null;
      this._ready = false;
      // Clear the shared map div (no innerHTML with data) so Leaflet can reuse it.
      var el = this._containerId ? document.getElementById(this._containerId) : null;
      if (el) { while (el.firstChild) el.removeChild(el.firstChild); }
      // Detach globals so a late gm_authFailure / ready callback cannot re-enter core.
      window.gm_authFailure = null;
      window.__ceGmapsReady = null;
    },

    // ---------- internals ----------

    _fail: function (reason) {
      // Guard double-failure (authFailure + onerror + timeout can all race) and any
      // failure arriving after a successful teardown.
      if (this._failed || this._destroyed) return;
      this._failed = true;
      if (this._timeoutId) { window.clearTimeout(this._timeoutId); this._timeoutId = null; }
      if (this._onEngineFailure) this._onEngineFailure(reason);
    },

    _onReady: function () {
      if (this._failed || this._destroyed) return;
      if (this._timeoutId) { window.clearTimeout(this._timeoutId); this._timeoutId = null; }
      if (typeof google === "undefined" || !google.maps) { this._fail("Google Maps failed to initialize"); return; }
      var self = this;
      var el = document.getElementById(this._containerId);
      var map = new google.maps.Map(el, {
        mapTypeId: "hybrid",
        tilt: 0,
        rotateControl: false,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false
      });
      this._map = map;
      this._zoomListener = map.addListener("zoom_changed", function () { self._callbacks.onZoomChange(); });
      this._ready = true;

      Object.keys(this._defs).forEach(function (id) { self._createPlot(id); });
      this._applyVisibility();
      if (this._pendingView) { this._applyView(this._pendingView); this._pendingView = null; }
      // Recompute zoom-based visibility from the real map zoom, exactly like core's
      // onZoomChange path would after Leaflet's fitBounds.
      this._callbacks.onZoomChange();
    },

    _markerIcon: function (colorHex) {
      // Pixel-scaled circle Symbol (NOT google.maps.Circle, which is meter-scaled).
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        strokeColor: colorHex,
        strokeWeight: 2,
        fillColor: colorHex,
        fillOpacity: 0.9
      };
    },

    _createPlot: function (id) {
      var self = this;
      var def = this._defs[id];
      if (!def) return;
      var polygons = [];
      def.rings.forEach(function (ring) {
        var path = ring.map(function (latlng) { return { lat: latlng[0], lng: latlng[1] }; });
        var poly = new google.maps.Polygon({
          paths: path,
          strokeColor: def.color,
          strokeWeight: 2,
          strokeOpacity: 1,
          fillOpacity: 0,
          clickable: true,
          map: null
        });
        poly.addListener("click", function () { self._callbacks.onPlotClick(id); });
        polygons.push(poly);
      });
      var marker = new google.maps.Marker({
        position: { lat: def.center[0], lng: def.center[1] },
        icon: this._markerIcon(def.color),
        map: null
      });
      marker.addListener("click", function () { self._callbacks.onPlotClick(id); });
      this._layers[id] = { polygons: polygons, marker: marker };
      this._applyVisibilityToPlot(id, this._showPolys);
    },

    _applyVisibility: function () {
      var self = this;
      var show = this._showPolys;
      Object.keys(this._layers).forEach(function (id) { self._applyVisibilityToPlot(id, show); });
    },

    _applyVisibilityToPlot: function (id, show) {
      var l = this._layers[id];
      if (!l) return;
      var map = this._map;
      if (show) {
        l.marker.setMap(null);
        l.polygons.forEach(function (p) { p.setMap(map); });
      } else {
        l.polygons.forEach(function (p) { p.setMap(null); });
        l.marker.setMap(map);
      }
    },

    _applyView: function (view) {
      if (view.type === "fit") this._doFitAll(view.centers);
      else this._doFlyTo(view.center, view.minZoom);
    },

    _doFitAll: function (centers) {
      var bounds = new google.maps.LatLngBounds();
      centers.forEach(function (c) { bounds.extend({ lat: c[0], lng: c[1] }); });
      this._map.fitBounds(bounds, 30);
    },

    _doFlyTo: function (center, minZoom) {
      var map = this._map;
      map.setCenter({ lat: center[0], lng: center[1] });
      var current = map.getZoom();
      map.setZoom(Math.max(current || minZoom, minZoom));
    }
  };
})();
