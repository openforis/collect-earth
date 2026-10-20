import { flushSync } from "react-dom";
import { fetchGewStatus, fetchMapConfig, fetchPlots, fetchStatuses, formUrl, gewArrangeWindows, gewOpenOverview,
  gewShowPlot, openAuxiliaryWindows, postGewContext } from "./api";
import { GoogleEngine } from "./engines/GoogleEngine";
import { LeafletEngine } from "./engines/LeafletEngine";
import type { EngineConfig, MapEngine } from "./engines/MapEngine";
import { footprintCorners, neighbour, nextUnfinished, normalizeStatus, plotsNear, visibleIds } from "./plots";
import type { MessageKey } from "./i18n";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { ACTIVE_COLOR, STATUS_COLORS, type GewStatus, type LatLng, type ListFilter, type MapConfig, type PlotFeature,
  type PlotStatus } from "./types";

const ZOOM_THRESHOLD = 14; // below: dot markers; above: polygons
const PLOT_ZOOM = 17;
const POLL_MILLIS = 5000;
/** Google Earth Web status polling: fast while it is loading/moving, slow otherwise. */
const GEW_BUSY_POLL_MILLIS = 700;
const GEW_IDLE_POLL_MILLIS = 2000;
const GEW_EXPECT_MILLIS = 5000;
/** Neighbouring plots drawn in Google Earth Web around the current one. */
const GEW_CONTEXT_RADIUS_METERS = 3000;
const GEW_CONTEXT_MAX_PLOTS = 300;

/** A message over the map: a translatable key (with params), or a server text as is. */
export interface Banner {
  severity: "error" | "warning";
  dismissible: boolean;
  key?: MessageKey;
  params?: Record<string, string>;
  text?: string;
}

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
  /** Collect Earth UI language (catalogues in i18n.ts; others fall back to English) */
  language: string;
  baseLayers: string[];
  baseLayer: string;
  /** Google Earth Web window state; null unless the viewer is "Plots map + Google Earth Web". */
  gew: GewStatus | null;
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
  /** "generated" (the form built from the survey) or "balloon" (the CEP's HTML) */
  private webForm = "generated";
  private lastStatusPoll: number | null = null;
  private fellBack = false;

  constructor() {
    this.state = {
      order: [], statuses: {}, loaded: false, activeId: null, formUrl: null,
      filter: this.prefs.filter ?? "all", query: "",
      sidebarCollapsed: !!this.prefs.sidebarCollapsed, formWidth: this.prefs.formWidth ?? 560,
      banner: null, viewerType: "", language: "en", baseLayers: [], baseLayer: "", gew: null,
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
    this.webForm = config.webForm ?? "generated";
    this.set({ viewerType: config.viewerType ?? "", language: config.language ?? "en" });
    if (this.usesGoogleEarthWeb()) this.pollGew();
    const notice = this.createEngine(config);
    if (notice) this.set({ banner: fallbackBanner(notice) });
    this.loadPlots();
  }

  // Google only when requested AND a key is present; otherwise Leaflet, with a notice
  // when we fell back from an explicit google_maps request.
  private createEngine(config: MapConfig): MessageKey | null {
    const key = config.googleMapsApiKey ?? "";
    const wantsGoogle = config.engine === "google_maps";
    this.engine = wantsGoogle && key !== "" ? new GoogleEngine() : new LeafletEngine();
    this.initEngine(this.engine.name === "google" ? key : "");
    if (wantsGoogle && key === "") return "gmaps.keyBlank";
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
  private onEngineFailure(reason: MessageKey): void {
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
    this.set({ banner: fallbackBanner(reason) });
  }

  private async loadPlots(): Promise<void> {
    try {
      const fc = await fetchPlots();
      const engine = this.engine!;
      if (!fc.features || fc.features.length === 0) {
        engine.flyTo([0, 0], 3);
        // A warning is a final state (e.g. no survey loaded): no retry, the page is reloaded.
        this.set({ loaded: true, banner: fc.warning
          ? { severity: "error", dismissible: false, text: fc.warning }
          : { severity: "error", dismissible: false, key: "banner.noSurvey" } });
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
      // Warm up Google Earth Web over the survey area so the first plot appears quickly
      if (this.usesGoogleEarthWeb() && !this.state.activeId) {
        gewOpenOverview(gridCenter(this.allCenters()));
        if (!this.state.gew || this.state.gew.state === "CLOSED") this.setGewOptimistic({ state: "OPENING", plotId: null, message: null });
        this.pollGew();
      }
    } catch (e) {
      this.set({ banner: { severity: "error", dismissible: false, key: "banner.loadFailed",
        params: { error: (e as Error).message } } });
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
    flushSync(() => this.set({ activeId: id, formUrl: formUrl(plot.feature, this.webForm, this.state.language) }));
    if (previous && previous !== id) this.engine.setPlotColor(previous, STATUS_COLORS[this.state.statuses[previous]]);
    this.engine.setPlotColor(id, ACTIVE_COLOR);
    if (wasClosed) this.engine.invalidateSize();
    this.engine.flyTo(plot.center, PLOT_ZOOM);
    if (this.usesGoogleEarthWeb()) this.sendGewContext(id);
    openAuxiliaryWindows(plot.feature);
    if (this.usesGoogleEarthWeb()) {
      this.setGewOptimistic({ state: "MOVING", plotId: id, message: null });
      this.pollGew();
    }
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

  // ---------- Google Earth Web ----------
  private usesGoogleEarthWeb(): boolean {
    return this.state.viewerType === "google_earth_web";
  }

  private gewTimer = 0;
  /** Bumped on every local (optimistic) state change: older poll responses are stale. */
  private gewEpoch = 0;
  /**
   * After a user action the server handles the request asynchronously, so for a moment it
   * still reports the previous state. Until it reports the expected plot (or needs the user,
   * or fails) the immediate feedback is kept; after GEW_EXPECT_MILLIS the server wins.
   */
  private gewExpected: { plotId: string | null; until: number } | null = null;

  private setGewOptimistic(gew: GewStatus): void {
    this.gewEpoch++;
    this.gewExpected = { plotId: gew.plotId, until: Date.now() + GEW_EXPECT_MILLIS };
    this.set({ gew });
  }

  private serverCaughtUp(gew: GewStatus): boolean {
    const expected = this.gewExpected;
    if (!expected) return true;
    const caughtUp = (gew.plotId === expected.plotId && gew.state !== "CLOSED")
      || gew.state === "WAITING" || gew.state === "ERROR" || Date.now() > expected.until;
    if (caughtUp) this.gewExpected = null;
    return caughtUp;
  }

  /** Poll the window state; quickly while it is opening/moving so the map shows progress. */
  private pollGew = async (): Promise<void> => {
    window.clearTimeout(this.gewTimer);
    let busy = false;
    const epoch = this.gewEpoch;
    try {
      const gew = await fetchGewStatus();
      // The user acted while this request was in flight: its answer predates that action.
      // No reschedule here - the action started its own poll, which keeps the chain going.
      if (epoch !== this.gewEpoch) return;
      if (!this.serverCaughtUp(gew)) {
        busy = true; // keep the immediate feedback and ask again soon
      } else {
        busy = gew.state === "OPENING" || gew.state === "MOVING";
        const old = this.state.gew;
        if (!old || old.state !== gew.state || old.plotId !== gew.plotId || old.message !== gew.message) this.set({ gew });
        // Where Google Earth Web is looking, outlined on the map
        this.engine?.setFootprint(gew.state === "READY" && gew.view ? footprintCorners(gew.view) : null);
      }
    } catch { /* server busy or restarting - retry */ }
    this.gewTimer = window.setTimeout(this.pollGew, busy ? GEW_BUSY_POLL_MILLIS : GEW_IDLE_POLL_MILLIS);
  };

  /** Neighbouring plots and their statuses, drawn by Google Earth Web around the plot. */
  private sendGewContext(id: string): void {
    const centers: Record<string, LatLng> = {};
    for (const plotId of this.state.order) centers[plotId] = this.plots[plotId].center;
    const near = plotsNear(centers, this.plots[id].center, GEW_CONTEXT_RADIUS_METERS, GEW_CONTEXT_MAX_PLOTS);
    postGewContext(id, near.map((plotId) => ({
      id: plotId,
      status: this.state.statuses[plotId] ?? "empty",
      // outline only (the first ring); neighbours' sample points would just add clutter
      rings: this.plots[plotId].rings.slice(0, 1).map((ring) => ring.map(([lat, lng]) => [lng, lat] as [number, number])),
    })));
  }

  /** Show the selected plot in Google Earth Web again (reopens a closed window). */
  showActiveInGoogleEarthWeb = (): void => {
    const id = this.state.activeId;
    if (!id) return;
    this.sendGewContext(id);
    gewShowPlot(this.plots[id].feature);
    this.setGewOptimistic({ state: "MOVING", plotId: id, message: null });
    this.pollGew();
  };

  arrangeWindows = (): void => gewArrangeWindows();

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

/** Centre of the plots' bounding box. */
function gridCenter(centers: LatLng[]): LatLng {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lat, lng] of centers) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  }
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

/** Dismissible notice after falling back from Google Maps to Leaflet. */
function fallbackBanner(reason: MessageKey): Banner {
  return { severity: "warning", dismissible: true, key: "banner.googleFallback", params: { reason } };
}
