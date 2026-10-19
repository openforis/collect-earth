import { flushSync } from "react-dom";
import { fetchMapConfig, fetchPlots, fetchStatuses, formUrl, openAuxiliaryWindows } from "./api";
import { GoogleEngine } from "./engines/GoogleEngine";
import { LeafletEngine } from "./engines/LeafletEngine";
import type { EngineConfig, MapEngine } from "./engines/MapEngine";
import { neighbour, nextUnfinished, normalizeStatus, visibleIds } from "./plots";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { ACTIVE_COLOR, STATUS_COLORS, type LatLng, type ListFilter, type MapConfig, type PlotFeature, type PlotStatus } from "./types";

const ZOOM_THRESHOLD = 14; // below: dot markers; above: polygons
const PLOT_ZOOM = 17;
const POLL_MILLIS = 5000;

export interface Banner { severity: "error" | "warning"; text: string; dismissible: boolean }

export interface UiState {
  order: string[];
  statuses: Record<string, PlotStatus>;
  loaded: boolean;
  activeId: string | null;
  formUrl: string | null;
  filter: ListFilter;
  query: string;
  sidebarCollapsed: boolean;
  formWidth: number;
  banner: Banner | null;
  viewerType: string;
  baseLayers: string[];
  baseLayer: string;
}

interface Plot { feature: PlotFeature; center: LatLng; rings: LatLng[][] }

/** GeoJSON GeometryCollection of polygons -> [lat,lng] outer rings. */
function ringsOf(feature: PlotFeature): LatLng[][] {
  return feature.geometry.geometries
    .filter((g) => g.type === "Polygon")
    .map((g) => g.coordinates[0].map(([lng, lat]) => [lat, lng] as LatLng));
}

/**
 * Owns the plots, their statuses, the selection and the map engine; React subscribes
 * to it through useSyncExternalStore. Geometry lives outside the React state (it never
 * changes after loading), so status polls only copy the small id->status map.
 */
export class MapController {
  private state: UiState;
  private listeners = new Set<() => void>();
  private plots: Record<string, Plot> = {};
  private prefs: Prefs = loadPrefs();
  private engine: MapEngine | null = null;
  private container: HTMLElement | null = null;
  private lastStatusPoll: number | null = null;
  private fellBack = false;

  constructor() {
    this.state = {
      order: [], statuses: {}, loaded: false, activeId: null, formUrl: null,
      filter: this.prefs.filter ?? "all", query: "",
      sidebarCollapsed: !!this.prefs.sidebarCollapsed, formWidth: this.prefs.formWidth ?? 560,
      banner: null, viewerType: "", baseLayers: [], baseLayer: "",
    };
  }

  // ---------- store ----------
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): UiState => this.state;

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private savePref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    this.prefs = { ...this.prefs, [key]: value };
    savePrefs(this.prefs);
  }

  // ---------- start-up ----------
  /** Called once the map container is in the DOM. */
  async start(container: HTMLElement): Promise<void> {
    if (this.container) return;
    this.container = container;
    window.addEventListener("message", this.onFormMessage);
    let config: MapConfig;
    try { config = await fetchMapConfig(); } catch {
      config = { engine: "leaflet", googleMapsApiKey: "" }; // collection must still work
    }
    this.set({ viewerType: config.viewerType ?? "" });
    const notice = this.createEngine(config);
    if (notice) this.set({ banner: { severity: "warning", text: notice, dismissible: true } });
    this.loadPlots();
  }

  // Google only when requested AND a key is present; otherwise Leaflet, with a notice
  // when we fell back from an explicit google_maps request.
  private createEngine(config: MapConfig): string | null {
    const key = config.googleMapsApiKey ?? "";
    const wantsGoogle = config.engine === "google_maps";
    this.engine = wantsGoogle && key !== "" ? new GoogleEngine() : new LeafletEngine();
    this.initEngine(this.engine.name === "google" ? key : "");
    if (wantsGoogle && key === "") return "Google Maps selected but the API key is blank" + FALLBACK_SUFFIX;
    return null;
  }

  private initEngine(apiKey: string): void {
    const engine = this.engine!;
    const config: EngineConfig = {
      zoomThreshold: ZOOM_THRESHOLD, emptyColor: STATUS_COLORS.empty, apiKey,
      onEngineFailure: (reason) => this.onEngineFailure(reason),
      baseLayer: this.prefs.baseLayer,
    };
    engine.init(this.container!, config, {
      onPlotClick: (id) => this.selectPlot(id),
      onZoomChange: () => this.updateVisibility(),
    });
    this.set({ baseLayers: engine.baseLayers(), baseLayer: engine.currentBaseLayer() });
  }

  // Runtime engine failure (Google key rejected, script blocked, timeout): swap in a
  // fresh Leaflet engine and re-add every plot with its current color. Runs once.
  private onEngineFailure(reason: string): void {
    if (this.fellBack) return;
    this.fellBack = true;
    this.engine?.destroy();
    this.engine = new LeafletEngine();
    this.initEngine("");
    const { order, activeId } = this.state;
    for (const id of order) this.addToEngine(id);
    if (activeId) this.engine.flyTo(this.plots[activeId].center, PLOT_ZOOM);
    else if (order.length) this.engine.fitAll(this.allCenters());
    this.updateVisibility();
    this.set({ banner: { severity: "warning", text: reason + FALLBACK_SUFFIX, dismissible: true } });
  }

  private async loadPlots(): Promise<void> {
    try {
      const fc = await fetchPlots();
      const engine = this.engine!;
      if (!fc.features || fc.features.length === 0) {
        engine.flyTo([0, 0], 3);
        // A warning is a final state (e.g. no survey loaded): no retry, the page is reloaded.
        this.set({ loaded: true, banner: { severity: "error", dismissible: false,
          text: fc.warning || "No survey plots loaded - import a CEP file / CSV grid in Collect Earth first." } });
        return;
      }
      const order: string[] = [];
      for (const feature of fc.features) {
        const id = feature.properties.id;
        if (!this.plots[id]) order.push(id);
        this.plots[id] = {
          feature, rings: ringsOf(feature),
          center: [parseFloat(feature.properties.latitude), parseFloat(feature.properties.longitude)],
        };
      }
      const statuses: Record<string, PlotStatus> = {};
      order.forEach((id) => { statuses[id] = "empty"; this.addToEngine(id); });
      // keep a fallback notice; clear a previous load error
      const banner = this.state.banner?.dismissible ? this.state.banner : null;
      this.set({ order, statuses, loaded: true, banner });
      engine.fitAll(this.allCenters());
      this.updateVisibility();
      this.pollStatuses();
      window.setInterval(() => this.pollStatuses(), POLL_MILLIS);
    } catch (e) {
      this.set({ banner: { severity: "error", dismissible: false,
        text: "Could not load plots: " + (e as Error).message + " - retrying in 5s" } });
      window.setTimeout(() => this.loadPlots(), 5000);
    }
  }

  private addToEngine(id: string): void {
    const plot = this.plots[id];
    this.engine!.addPlot(id, plot.rings, plot.center);
    this.engine!.setPlotColor(id, id === this.state.activeId ? ACTIVE_COLOR : STATUS_COLORS[this.state.statuses[id] ?? "empty"]);
  }

  private allCenters(): LatLng[] {
    return this.state.order.map((id) => this.plots[id].center);
  }

  private updateVisibility(): void {
    if (this.engine) this.engine.setZoomVisibilityMode(this.engine.isAboveThreshold());
  }

  // ---------- statuses ----------
  private async pollStatuses(): Promise<void> {
    try {
      const data = await fetchStatuses(this.lastStatusPoll);
      this.lastStatusPoll = data.now;
      const updates: Record<string, PlotStatus> = {};
      for (const [id, status] of Object.entries(data.statuses)) {
        if (this.plots[id]) updates[id] = normalizeStatus(status);
      }
      this.applyStatuses(updates);
    } catch { /* transient - the next poll retries */ }
  }

  private applyStatuses(updates: Record<string, PlotStatus>): void {
    const changed = Object.keys(updates).filter((id) => this.state.statuses[id] !== updates[id]);
    if (!changed.length) return;
    this.set({ statuses: { ...this.state.statuses, ...updates } });
    for (const id of changed) {
      // the active plot keeps its cyan highlight
      if (id !== this.state.activeId) this.engine?.setPlotColor(id, STATUS_COLORS[updates[id]]);
    }
  }

  // Same-origin messages from the web form in the iframe
  private onFormMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return;
    const data = event.data as { type?: string; plotId?: string } | null;
    // ignore anything but the active plot (stale iframe race)
    if (!data?.type || data.plotId == null || data.plotId !== this.state.activeId || !this.plots[data.plotId]) return;
    if (data.type === "ce:saved") {
      this.applyStatuses({ [data.plotId]: "saved" });
      this.goToNextUnfinished();
    } else if (data.type === "ce:dirty") {
      this.applyStatuses({ [data.plotId]: "partial" });
    }
  };

  // ---------- selection ----------
  selectPlot = (id: string): void => {
    const plot = this.plots[id];
    if (!plot || !this.engine) return;
    const previous = this.state.activeId;
    const wasClosed = this.state.formUrl == null;
    // Render the form panel synchronously, then resize the map BEFORE moving it, so the
    // plot ends up centered in the remaining map area.
    flushSync(() => this.set({ activeId: id, formUrl: formUrl(plot.feature) }));
    if (previous && previous !== id) this.engine.setPlotColor(previous, STATUS_COLORS[this.state.statuses[previous]]);
    this.engine.setPlotColor(id, ACTIVE_COLOR);
    if (wasClosed) this.engine.invalidateSize();
    this.engine.flyTo(plot.center, PLOT_ZOOM);
    openAuxiliaryWindows(plot.feature);
  };

  goToNextUnfinished = (): void => {
    const id = nextUnfinished(this.state.order, this.state.statuses, this.state.activeId);
    if (id) this.selectPlot(id);
  };

  /** Previous/next plot among those currently shown in the list (all plots if none). */
  neighbourOf(id: string | null, step: 1 | -1): string | null {
    const { order, statuses, filter, query } = this.state;
    const visible = visibleIds(order, statuses, filter, query);
    return neighbour(visible.length ? visible : order, id, step);
  }

  step = (step: 1 | -1): void => {
    const id = this.neighbourOf(this.state.activeId, step);
    if (id) this.selectPlot(id);
  };

  closeForm = (): void => {
    if (this.state.formUrl == null) return;
    flushSync(() => this.set({ formUrl: null }));
    this.engine?.invalidateSize();
  };

  // ---------- list / layout ----------
  setFilter = (filter: ListFilter): void => { this.set({ filter }); this.savePref("filter", filter); };
  setQuery = (query: string): void => this.set({ query });
  setSidebarCollapsed = (collapsed: boolean): void => {
    this.set({ sidebarCollapsed: collapsed });
    this.savePref("sidebarCollapsed", collapsed);
  };
  setFormWidth = (width: number, persist: boolean): void => {
    this.set({ formWidth: width });
    if (persist) this.savePref("formWidth", width);
  };
  dismissBanner = (): void => this.set({ banner: null });

  // ---------- map tools ----------
  resizeMap = (): void => { this.engine?.invalidateSize(); };
  zoomBy = (delta: number): void => { this.engine?.zoomBy(delta); };
  fitAll = (): void => { if (this.state.order.length) this.engine?.fitAll(this.allCenters()); };
  centerActive = (): void => {
    const id = this.state.activeId;
    if (id) this.engine?.flyTo(this.plots[id].center, PLOT_ZOOM);
  };
  setBaseLayer = (name: string): void => {
    this.engine?.setBaseLayer(name);
    this.set({ baseLayer: name });
    this.savePref("baseLayer", name);
  };
}

const FALLBACK_SUFFIX = " - using Leaflet/ESRI. Check GOOGLE_MAPS_API_KEY in Properties (the key needs the Maps JavaScript API enabled).";
