import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GroundView, LatLng } from "../types";
import { byId, heightForZoom, zoomForHeight } from "../plots";
import type { EngineCallbacks, EngineConfig, MapEngine } from "./MapEngine";
import { UserIntent } from "./userIntent";

const ESRI_ATTRIBUTION = "&copy; Esri, Maxar, Earthstar Geographics";
/**
 * Google Earth Web frames a plot from a few hundred metres, closer than map tiles go: beyond their
 * last zoom the tiles are enlarged. Esri's imagery stops at 18 in much of the world (its zoom 19
 * tiles there say "Map data not yet available"), and plots are often in remote areas.
 */
const MAX_ZOOM = 22;
const IMAGERY_NATIVE_ZOOM = 18;

function createBaseLayers(): Record<string, L.Layer> {
  const imagery = () => L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: MAX_ZOOM, maxNativeZoom: IMAGERY_NATIVE_ZOOM, attribution: ESRI_ATTRIBUTION });
  const labels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: MAX_ZOOM, maxNativeZoom: IMAGERY_NATIVE_ZOOM, attribution: ESRI_ATTRIBUTION });
  return {
    "Satellite": imagery(),
    "Satellite + labels": L.layerGroup([imagery(), labels]),
    "Streets": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: MAX_ZOOM, maxNativeZoom: 19, attribution: "&copy; OpenStreetMap contributors" }),
  };
}

// Leaflet internals used to avoid animation races (no public API for these).
interface LeafletMapInternals {
  _loaded?: boolean;
  _animatingZoom?: boolean;
  _panAnim?: { _inProgress?: boolean };
}

export class LeafletEngine implements MapEngine {
  readonly name = "leaflet" as const;
  private map: L.Map | null = null;
  /** Keyed by plot id, without a prototype (see byId). */
  private layers: Record<string, { group: L.FeatureGroup; marker: L.CircleMarker }> = byId();
  private callbacks!: EngineCallbacks;
  private zoomThreshold = 14;
  private emptyColor = "#e53935";
  private base: Record<string, L.Layer> = {};
  private baseName = "";
  private pending: (() => void) | null = null;
  /** Target of the last flyTo, used to re-center correctly if a resize lands mid-pan. */
  private viewTarget: L.LatLng | null = null;
  private footprint: L.Polygon | null = null;
  private intent = new UserIntent();

  init(container: HTMLElement, config: EngineConfig, callbacks: EngineCallbacks): void {
    this.callbacks = callbacks;
    this.layers = byId();
    this.zoomThreshold = config.zoomThreshold;
    this.emptyColor = config.emptyColor;
    // Canvas rendering: one <canvas> instead of thousands of SVG nodes for large grids.
    // Zoom buttons are part of the React UI, so Leaflet's own control is off.
    // Fractional zoom, so the map can show exactly the ground Google Earth Web shows.
    const map = L.map(container, { preferCanvas: true, zoomControl: false, zoomSnap: 0 });
    this.base = createBaseLayers();
    const names = Object.keys(this.base);
    this.baseName = config.baseLayer && names.includes(config.baseLayer) ? config.baseLayer : names[0];
    this.base[this.baseName].addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    map.on("zoomend", () => this.callbacks.onZoomChange());
    map.on("dragstart", () => { this.viewTarget = null; });
    map.on("moveend", () => {
      const view = this.getView();
      if (view && this.intent.isUsers()) this.callbacks.onUserViewChange(view);
    });
    this.intent.attach(container);
    this.map = map;
  }

  addPlot(id: string, rings: LatLng[][], center: LatLng): void {
    // A plot added again (the plots loaded again) replaces the one there: two would be drawn, one of them for good
    this.removePlot(id);
    const group = L.featureGroup();
    for (const latlngs of rings) {
      // Faint fill makes the whole plot clickable, not only its outline
      group.addLayer(L.polygon(latlngs, { color: this.emptyColor, weight: 2, fillColor: this.emptyColor, fillOpacity: 0.04 }));
    }
    // White outline keeps the status color readable on any imagery
    const marker = L.circleMarker(center, { radius: 6, color: "#ffffff", weight: 1.5, fillColor: this.emptyColor, fillOpacity: 1 });
    const tooltip: L.TooltipOptions = { className: "plot-tooltip", direction: "top", offset: [0, -6] };
    group.bindTooltip(id, tooltip);
    marker.bindTooltip(id, tooltip);
    group.on("click", () => this.callbacks.onPlotClick(id));
    marker.on("click", () => this.callbacks.onPlotClick(id));
    this.layers[id] = { group, marker };
  }

  removePlot(id: string): void {
    const existing = this.layers[id];
    if (existing) {
      existing.group.remove();
      existing.marker.remove();
      delete this.layers[id];
    }
  }

  setPlotColor(id: string, color: string): void {
    const l = this.layers[id];
    if (!l) return;
    l.group.eachLayer((layer) => (layer as L.Path).setStyle({ color, fillColor: color }));
    l.marker.setStyle({ fillColor: color });
  }

  flyTo(center: LatLng, minZoom: number): void {
    const map = this.map!;
    this.viewTarget = L.latLng(center);
    this.intent.programmatic();
    this.whenIdle(() => map.setView(center, Math.max(map.getZoom() || minZoom, minZoom)));
  }

  fitAll(centers: LatLng[]): void {
    const map = this.map!;
    this.viewTarget = null;
    this.intent.programmatic();
    this.whenIdle(() => map.fitBounds(L.latLngBounds(centers), { padding: [40, 40], maxZoom: 17 }));
  }

  zoomBy(delta: number): void {
    this.intent.gesture();
    this.map?.setZoom(this.map.getZoom() + delta);
  }

  setZoomVisibilityMode(showPolygons: boolean): void {
    const map = this.map!;
    for (const l of Object.values(this.layers)) {
      if (showPolygons) { map.removeLayer(l.marker); l.group.addTo(map); }
      else { map.removeLayer(l.group); l.marker.addTo(map); }
    }
  }

  isAboveThreshold(): boolean {
    return this.map!.getZoom() >= this.zoomThreshold;
  }

  // Leaflet keeps the top-left corner fixed on resize; re-centering keeps the selected
  // plot in the middle of the map. A no-op when the size did not actually change.
  invalidateSize(): void {
    const map = this.map;
    if (!map) return;
    const internals = map as unknown as LeafletMapInternals;
    if (!internals._loaded) { map.invalidateSize(); return; }
    const before = map.getSize();
    const panning = !!internals._panAnim?._inProgress;
    const center = panning && this.viewTarget ? this.viewTarget : map.getCenter();
    map.invalidateSize({ pan: false });
    if (before.equals(map.getSize()) || internals._animatingZoom) return;
    this.intent.programmatic();
    map.setView(center, map.getZoom(), { animate: false });
  }

  getView(): GroundView | null {
    const map = this.map;
    if (!map || !(map as unknown as LeafletMapInternals)._loaded) return null;
    const center = map.getCenter();
    return { center: [center.lat, center.lng], heightMeters: heightForZoom(map.getZoom(), map.getSize().y, center.lat) };
  }

  showView(view: GroundView): void {
    const map = this.map;
    if (!map || map.getSize().y <= 0) return;
    this.viewTarget = L.latLng(view.center);
    this.intent.programmatic();
    this.whenIdle(() => map.setView(view.center, zoomForHeight(view.heightMeters, map.getSize().y, view.center[0])));
  }

  isUserInteracting(): boolean {
    return this.intent.isUsers();
  }

  setFootprint(corners: LatLng[] | null): void {
    const map = this.map;
    if (!map) return;
    if (!corners) { this.footprint?.remove(); this.footprint = null; return; }
    if (this.footprint) { this.footprint.setLatLngs(corners); return; }
    this.footprint = L.polygon(corners, {
      className: "gew-footprint",
      color: "#ffffff", weight: 2, dashArray: "6 6", fill: true, fillColor: "#8ab4f8", fillOpacity: 0.08,
      interactive: false, renderer: L.svg(), // own SVG layer: crisp dashes above the canvas plots
    }).addTo(map);
  }

  baseLayers(): string[] { return Object.keys(this.base); }
  currentBaseLayer(): string { return this.baseName; }

  setBaseLayer(name: string): void {
    const map = this.map;
    if (!map || !this.base[name] || name === this.baseName) return;
    map.removeLayer(this.base[this.baseName]);
    this.base[name].addTo(map);
    this.baseName = name;
  }

  destroy(): void {
    this.intent.detach();
    this.map?.remove();
    this.map = null;
    this.layers = byId();
    this.pending = null;
    this.footprint = null;
  }

  // Leaflet finishes a running zoom animation by moving to ITS target, overriding any
  // setView made meanwhile (e.g. pressing "next" quickly). Defer view changes until
  // the animation has ended; only the latest request is kept.
  private whenIdle(fn: () => void): void {
    const map = this.map!;
    if (!(map as unknown as LeafletMapInternals)._animatingZoom) { fn(); return; }
    const waiting = this.pending !== null;
    this.pending = fn;
    if (waiting) return;
    map.once("zoomend", () => {
      const next = this.pending;
      this.pending = null;
      if (next && this.map === map) this.whenIdle(next);
    });
  }
}
