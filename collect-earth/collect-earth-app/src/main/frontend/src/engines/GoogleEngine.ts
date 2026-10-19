import type { LatLng } from "../types";
import type { EngineCallbacks, EngineConfig, MapEngine } from "./MapEngine";

type PendingView = { type: "fit"; centers: LatLng[] } | { type: "fly"; center: LatLng; minZoom: number };

declare global {
  interface Window {
    gm_authFailure?: () => void;
    __ceGmapsReady?: () => void;
  }
}

const MAP_TYPES: Record<string, string> = {
  "Satellite + labels": "hybrid",
  "Satellite": "satellite",
  "Streets": "roadmap",
};

/**
 * Google Maps engine. The Maps JS API is loaded asynchronously from Google's host, so
 * the controller may call addPlot/fitAll/flyTo before the map exists: those calls are
 * recorded and flushed when it is ready. A rejected key or load failure is reported
 * through config.onEngineFailure, after which the controller swaps in Leaflet.
 */
export class GoogleEngine implements MapEngine {
  readonly name = "google" as const;
  private map: google.maps.Map | null = null;
  private defs: Record<string, { rings: LatLng[][]; center: LatLng; color: string }> = {};
  private layers: Record<string, { polygons: google.maps.Polygon[]; marker: google.maps.Marker }> = {};
  private callbacks!: EngineCallbacks;
  private config!: EngineConfig;
  private container: HTMLElement | null = null;
  private ready = false;
  private failed = false;
  private destroyed = false;
  private showPolygons = false;
  private pendingView: PendingView | null = null;
  private timeoutId: number | null = null;
  private zoomListener: google.maps.MapsEventListener | null = null;
  private script: HTMLScriptElement | null = null;
  private baseName = "Satellite + labels";

  init(container: HTMLElement, config: EngineConfig, callbacks: EngineCallbacks): void {
    this.container = container;
    this.config = config;
    this.callbacks = callbacks;
    if (config.baseLayer && MAP_TYPES[config.baseLayer]) this.baseName = config.baseLayer;
    // Google calls this global on an invalid/unauthorized key at runtime.
    window.gm_authFailure = () => this.fail("Google rejected the API key");
    window.__ceGmapsReady = () => this.onReady();
    const s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(config.apiKey)
      + "&v=weekly&loading=async&callback=__ceGmapsReady";
    s.async = true;
    s.onerror = () => this.fail("Google Maps script failed to load");
    this.script = s;
    // If the ready callback never runs (network blocked, silent stall), fall back.
    this.timeoutId = window.setTimeout(() => this.fail("Google Maps took too long to load"), 15000);
    document.head.appendChild(s);
  }

  addPlot(id: string, rings: LatLng[][], center: LatLng): void {
    this.defs[id] = { rings, center, color: this.config.emptyColor };
    if (this.ready) this.createPlot(id);
  }

  setPlotColor(id: string, color: string): void {
    const def = this.defs[id];
    if (def) def.color = color;
    const l = this.layers[id];
    if (!l) return;
    l.polygons.forEach((p) => p.setOptions({ strokeColor: color }));
    l.marker.setIcon(this.markerIcon(color));
  }

  flyTo(center: LatLng, minZoom: number): void {
    if (this.ready) this.doFlyTo(center, minZoom);
    else this.pendingView = { type: "fly", center, minZoom };
  }

  fitAll(centers: LatLng[]): void {
    if (this.ready) this.doFitAll(centers);
    else this.pendingView = { type: "fit", centers };
  }

  zoomBy(delta: number): void {
    if (this.map) this.map.setZoom((this.map.getZoom() ?? 3) + delta);
  }

  setZoomVisibilityMode(showPolygons: boolean): void {
    this.showPolygons = showPolygons;
    if (this.ready) Object.keys(this.layers).forEach((id) => this.applyVisibility(id));
  }

  isAboveThreshold(): boolean {
    return !!this.map && (this.map.getZoom() ?? 0) >= this.config.zoomThreshold;
  }

  // Google re-measures its container on its own (ResizeObserver); keep the center.
  invalidateSize(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    if (center) this.map.setCenter(center);
  }

  baseLayers(): string[] { return Object.keys(MAP_TYPES); }
  currentBaseLayer(): string { return this.baseName; }

  setBaseLayer(name: string): void {
    if (!MAP_TYPES[name]) return;
    this.baseName = name;
    this.map?.setMapTypeId(MAP_TYPES[name]);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timeoutId) { window.clearTimeout(this.timeoutId); this.timeoutId = null; }
    this.zoomListener?.remove();
    this.zoomListener = null;
    for (const l of Object.values(this.layers)) {
      l.polygons.forEach((p) => p.setMap(null));
      l.marker.setMap(null);
    }
    this.layers = {};
    this.defs = {};
    this.map = null;
    this.ready = false;
    // Clear the shared map container so Leaflet can reuse it.
    if (this.container) this.container.replaceChildren();
    // Remove the (possibly still in-flight) script and replace the globals with no-ops:
    // Google invokes them by name when a slow download completes after a fallback.
    this.script?.remove();
    this.script = null;
    window.gm_authFailure = () => {};
    window.__ceGmapsReady = () => {};
  }

  private fail(reason: string): void {
    // authFailure + onerror + timeout can all race; report once, never after teardown.
    if (this.failed || this.destroyed) return;
    this.failed = true;
    if (this.timeoutId) { window.clearTimeout(this.timeoutId); this.timeoutId = null; }
    this.config.onEngineFailure(reason);
  }

  private onReady(): void {
    if (this.failed || this.destroyed) return;
    if (this.timeoutId) { window.clearTimeout(this.timeoutId); this.timeoutId = null; }
    if (typeof google === "undefined" || !google.maps) { this.fail("Google Maps failed to initialize"); return; }
    const map = new google.maps.Map(this.container!, {
      mapTypeId: MAP_TYPES[this.baseName],
      tilt: 0,
      disableDefaultUI: true, // zoom / layer controls are part of the React UI
      scaleControl: true,
    });
    this.map = map;
    this.zoomListener = map.addListener("zoom_changed", () => this.callbacks.onZoomChange());
    this.ready = true;
    Object.keys(this.defs).forEach((id) => this.createPlot(id));
    if (this.pendingView) {
      const view = this.pendingView;
      this.pendingView = null;
      if (view.type === "fit") this.doFitAll(view.centers);
      else this.doFlyTo(view.center, view.minZoom);
    }
    this.callbacks.onZoomChange();
  }

  private markerIcon(color: string): google.maps.Symbol {
    // Pixel-scaled circle symbol (google.maps.Circle would be meter-scaled).
    return { path: google.maps.SymbolPath.CIRCLE, scale: 6, strokeColor: "#ffffff", strokeWeight: 1.5, fillColor: color, fillOpacity: 1 };
  }

  private createPlot(id: string): void {
    const def = this.defs[id];
    if (!def) return;
    const polygons = def.rings.map((ring) => {
      const poly = new google.maps.Polygon({
        paths: ring.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: def.color, strokeWeight: 2, strokeOpacity: 1, fillOpacity: 0, clickable: true,
      });
      poly.addListener("click", () => this.callbacks.onPlotClick(id));
      return poly;
    });
    const marker = new google.maps.Marker({
      position: { lat: def.center[0], lng: def.center[1] }, icon: this.markerIcon(def.color), title: id,
    });
    marker.addListener("click", () => this.callbacks.onPlotClick(id));
    this.layers[id] = { polygons, marker };
    this.applyVisibility(id);
  }

  private applyVisibility(id: string): void {
    const l = this.layers[id];
    if (!l) return;
    l.marker.setMap(this.showPolygons ? null : this.map);
    l.polygons.forEach((p) => p.setMap(this.showPolygons ? this.map : null));
  }

  private doFitAll(centers: LatLng[]): void {
    const bounds = new google.maps.LatLngBounds();
    centers.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
    this.map!.fitBounds(bounds, 40);
  }

  private doFlyTo(center: LatLng, minZoom: number): void {
    const map = this.map!;
    map.setCenter({ lat: center[0], lng: center[1] });
    map.setZoom(Math.max(map.getZoom() || minZoom, minZoom));
  }
}
