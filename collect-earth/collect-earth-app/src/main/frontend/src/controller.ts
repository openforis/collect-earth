import { flushSync } from "react-dom";
import { fetchGewStatus, fetchImageryStatus, fetchMapConfig, fetchPlots, fetchStatuses, formUrl, gewArrangeWindows, gewMoveCamera,
  gewOpenOverview, gewShowPlot, openAuxiliaryWindows, postGewContext, showImagerySource } from "./api";
import { GoogleEngine } from "./engines/GoogleEngine";
import { LeafletEngine } from "./engines/LeafletEngine";
import { NoMapEngine } from "./engines/NoMapEngine";
import { IN_PANEL } from "./panel";
import { IN_HOME } from "./home";
import type { EngineConfig, MapEngine } from "./engines/MapEngine";
import { byId, footprintCorners, indexPlots, neighbour, nextUnfinished, normalizeStatus, plotParam, plotsGone, plotsNear, plotToRestore, surveyView,
  sameView, visibleIds, withoutPlotParam } from "./plots";
import type { MessageKey } from "./i18n";
import { reconcileImagery, sameImageryStatus, type ImageryExpectation } from "./imagery";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { ACTIVE_COLOR, STATUS_COLORS, type GewStatus, type GewView, type GroundView, type ImagerySource, type ImageryStatus,
  type LatLng, type ListFilter, type MapConfig, type PlotFeature, type PlotStatus } from "./types";

const ZOOM_THRESHOLD = 14; // below: dot markers; above: polygons
const PLOT_ZOOM = 17;
const POLL_MILLIS = 5000;
/** Google Earth Web status polling: fast while it is loading/moving, slow otherwise. */
const GEW_BUSY_POLL_MILLIS = 700;
const GEW_IDLE_POLL_MILLIS = 2000;
/** While Google Earth Web shows a plot the map follows its camera, so it is read often. */
const GEW_READY_POLL_MILLIS = 500;
/** How long Google Earth Web may take to fly to where the map sent it (its flights take ~3 s). */
const GEW_LEAD_MILLIS = 6000;
const GEW_EXPECT_MILLIS = 5000;
/** Neighbouring plots drawn in Google Earth Web around the current one. */
const GEW_CONTEXT_RADIUS_METERS = 3000;
const GEW_CONTEXT_MAX_PLOTS = 300;
/** The tabs of the imagery window: the user opens and closes them, so they are read now and then. */
const IMAGERY_POLL_MILLIS = 2000;
/** How long a source the user picked is shown pressed before the server's answer wins (it shows it in ~1 s). */
const IMAGERY_EXPECT_MILLIS = 5000;

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
  /** The tabs of the imagery window and the one shown: the source buttons. */
  imagery: ImageryStatus;
  /** The plot just submitted and the one the list moved to (null: none left), for a toast; key tells two apart. */
  submitted: { key: number; plotId: string; next: string | null } | null;
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
  /** Keyed by plot id, without a prototype (see byId), like every other dictionary of plots here. */
  private plots: Record<string, Plot> = byId();
  private prefs: Prefs = loadPrefs();
  private engine: MapEngine | null = null;
  private container: HTMLElement | null = null;
  private started = false;
  /** "generated" (the form built from the survey) or "balloon" (the CEP's HTML) */
  private webForm = "generated";
  private lastStatusPoll: number | null = null;
  /** Whether the statuses are polled: started by the first load that succeeds, and only once. */
  private statusPolling = false;
  private fellBack = false;
  /** The plot to select once the plots have loaded: the map was reopened on it (see plotParam). */
  private restorePlot: string | null = null;

  constructor() {
    this.state = {
      order: [], statuses: byId(), loaded: false, activeId: null, formUrl: null,
      filter: this.prefs.filter ?? "all", query: "",
      sidebarCollapsed: !!this.prefs.sidebarCollapsed, formWidth: this.prefs.formWidth ?? 560,
      banner: null, viewerType: "", language: "en", baseLayers: [], baseLayer: "", gew: null,
      imagery: { sources: [], visible: null }, submitted: null,
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
  /** Called once the map container is in the DOM; with none in Google Earth Web's panel (panel.ts) and on the home page (home.ts), which have no map. */
  async start(container: HTMLElement | null): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.container = container;
    this.restorePlot = plotParam(window.location.search);
    if (this.restorePlot != null) {
      // Out of the address at once: a reload by the user starts afresh
      try { window.history.replaceState(window.history.state, "", withoutPlotParam(window.location.href)); } catch { /* kept */ }
    }
    window.addEventListener("message", this.onFormMessage);
    let config: MapConfig;
    try { config = await fetchMapConfig(); } catch {
      config = { engine: "leaflet", googleMapsApiKey: "" }; // collection must still work
    }
    this.webForm = config.webForm ?? "generated";
    this.set({ viewerType: config.viewerType ?? "", language: config.language ?? "en" });
    if (this.usesGoogleEarthWeb()) this.pollGew();
    this.pollImagery();
    const notice = this.createEngine(config);
    if (notice) this.set({ banner: fallbackBanner(notice) });
    this.loadPlots();
  }

  // Google only when requested AND a key is present; otherwise Leaflet, with a notice
  // when we fell back from an explicit google_maps request.
  private createEngine(config: MapConfig): MessageKey | null {
    // Neither Google Earth Web's panel nor the home page of the Google Earth Pro viewer (home.ts) has a map
    if (IN_PANEL || IN_HOME || !this.container) {
      this.engine = new NoMapEngine();
      return null;
    }
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
      onUserViewChange: (view) => this.onMapMovedByUser(view),
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
      // From this answer alone, and put in place at once: a load tried again after one that failed half-way (below)
      // would otherwise find its plots there already, and leave them out of the list
      const { order, plots } = indexPlots(fc.features, (feature) => ({
        feature, rings: ringsOf(feature),
        center: [parseFloat(feature.properties.latitude), parseFloat(feature.properties.longitude)] as LatLng,
      }));
      // Those a load that failed half-way put on the map and this one no longer has: a click on one would find no plot
      const gone = plotsGone(this.plots, plots);
      gone.forEach((id) => engine.removePlot(id));
      this.plots = plots;
      const statuses = byId<PlotStatus>();
      // Those known already are kept: the polls ask only for the changes since the last one
      for (const id of order) statuses[id] = this.state.statuses[id] ?? "empty";
      // keep a fallback notice; clear a previous load error
      const banner = this.state.banner?.dismissible ? this.state.banner : null;
      // The plot open, if it is gone, is closed: nothing could be done with it
      const activeGone = this.state.activeId !== null && !(this.state.activeId in plots);
      this.set({ order, statuses, loaded: true, banner, ...(activeGone ? { activeId: null, formUrl: null } : {}) });
      // The engines replace a plot added again
      order.forEach((id) => this.addToEngine(id));
      engine.fitAll(this.allCenters());
      this.updateVisibility();
      // Each poll schedules the next: a second start would poll twice as often, for good
      if (!this.statusPolling) {
        this.statusPolling = true;
        this.pollStatuses();
      }
      // Reopened on the plot that was open: selected as a click would (the imagery skips a plot it shows already)
      const restore = plotToRestore(this.restorePlot, this.plots);
      this.restorePlot = null;
      if (restore) this.selectPlot(restore);
      // Warm up Google Earth Web over the survey area so the first plot appears quickly; not from its own page, which
      // that would load again, panel and all
      if (this.usesGoogleEarthWeb() && !this.state.activeId && !IN_PANEL) {
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
  /** The next poll starts once this one is answered: on a slow server, polls on a timer piled up. */
  private async pollStatuses(): Promise<void> {
    try {
      const data = await fetchStatuses(this.lastStatusPoll);
      this.lastStatusPoll = data.now;
      const updates = byId<PlotStatus>();
      for (const [id, status] of Object.entries(data.statuses)) {
        if (id in this.plots) updates[id] = normalizeStatus(status);
      }
      this.applyStatuses(updates);
    } catch { /* transient - the next poll retries */ }
    window.setTimeout(() => this.pollStatuses(), POLL_MILLIS);
  }

  private applyStatuses(updates: Record<string, PlotStatus>): void {
    const changed = Object.keys(updates).filter((id) => this.state.statuses[id] !== updates[id]);
    if (!changed.length) return;
    this.set({ statuses: Object.assign(byId<PlotStatus>(), this.state.statuses, updates) });
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
    if (!data?.type || data.plotId == null || data.plotId !== this.state.activeId || !(data.plotId in this.plots)) return;
    if (data.type === "ce:saved") {
      this.applyStatuses({ [data.plotId]: "saved" });
      const next = this.goToNextUnfinished();
      this.set({ submitted: { key: Date.now(), plotId: data.plotId, next } });
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
      this.leadGewTo(plot.center);
      this.setGewOptimistic({ state: "MOVING", plotId: id, message: null });
      this.pollGew();
    }
  };

  /** Selects the next plot not completed; returns it, null when there is none. */
  goToNextUnfinished = (): string | null => {
    const id = nextUnfinished(this.state.order, this.state.statuses, this.state.activeId);
    if (id) this.selectPlot(id);
    return id;
  };

  dismissSubmitted = (): void => {
    if (this.state.submitted) this.set({ submitted: null });
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
    let ready = false;
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
        ready = gew.state === "READY";
        if (ready) this.followGew(gew.view ?? null);
        if (ready) this.showSurveyAreaOnce();
      }
    } catch { /* server busy or restarting - retry */ }
    this.gewTimer = window.setTimeout(this.pollGew,
      busy ? GEW_BUSY_POLL_MILLIS : ready ? GEW_READY_POLL_MILLIS : GEW_IDLE_POLL_MILLIS);
  };

  /**
   * In Google Earth Web's panel, before any plot: Google Earth Web was opened without knowing where the plots are (there
   * is no plots map window to tell it, see panel.ts), so the panel moves it over the survey area, once it is ready.
   */
  private surveyAreaShown = false;
  private showSurveyAreaOnce(): void {
    if (!IN_PANEL || this.surveyAreaShown || this.state.activeId || !this.state.order.length) return;
    this.surveyAreaShown = true;
    gewMoveCamera(surveyView(this.allCenters()));
  }

  // ---------- linked views: the map and Google Earth Web look at the same place ----------
  /**
   * Off until the user selects a plot or moves the map: before that Google Earth Web shows the
   * survey area from afar while the map shows every plot, and neither should drag the other.
   */
  private viewsLinked = false;
  /** Google Earth Web's view at the last poll: the map follows it only when it changes. */
  private lastGewView: GroundView | null = null;
  /**
   * Where the map sent Google Earth Web. Until it gets there (or GEW_LEAD_MILLIS pass) its camera
   * still reports the old place, which the map must not go back to. `centerOnly`: a plot was
   * selected, and how far Google Earth Web frames it is for it to decide; the map then follows.
   */
  private gewLead: { view: GroundView; centerOnly: boolean; until: number } | null = null;

  private leadGewTo(center: LatLng): void {
    this.viewsLinked = true;
    this.gewLead = { view: { center, heightMeters: 0 }, centerOnly: true, until: Date.now() + GEW_LEAD_MILLIS };
  }

  /** The user moved or zoomed the map: Google Earth Web looks at the same ground. */
  private onMapMovedByUser(view: GroundView): void {
    const gew = this.state.gew;
    if (!this.usesGoogleEarthWeb() || !gew || gew.state !== "READY" || gew.cameraSync === false) return;
    this.viewsLinked = true;
    this.gewLead = { view, centerOnly: false, until: Date.now() + GEW_LEAD_MILLIS };
    gewMoveCamera(view);
  }

  /** The user moved Google Earth Web (or it framed a plot): the map looks at the same ground. */
  private followGew(gewView: GewView | null): void {
    // Tilted, not known, or no ground in view (a height of 0 would be an infinite zoom): nothing to follow
    if (!gewView || !(gewView.heightMeters > 0) || !this.engine) return;
    const view: GroundView = { center: [gewView.latitude, gewView.longitude], heightMeters: gewView.heightMeters };
    const lead = this.gewLead;
    if (lead) {
      const reached = sameView(view, lead.centerOnly ? { ...lead.view, heightMeters: view.heightMeters } : lead.view, 0.05);
      if (!reached && Date.now() < lead.until) return;
      this.gewLead = null;
      if (!lead.centerOnly) { this.lastGewView = view; return; } // it caught up with the map
    }
    if (!this.viewsLinked || (this.lastGewView && sameView(this.lastGewView, view))) {
      this.lastGewView = view;
      return;
    }
    // Not under the user's fingers: the next poll tries again
    if (this.engine.isUserInteracting()) return;
    this.lastGewView = view;
    const current = this.engine.getView();
    if (!current || !sameView(current, view)) this.engine.showView(view);
  }

  /** Neighbouring plots and their statuses, drawn by Google Earth Web around the plot. */
  private sendGewContext(id: string): void {
    const centers = byId<LatLng>();
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
    this.leadGewTo(this.plots[id].center);
    this.setGewOptimistic({ state: "MOVING", plotId: id, message: null });
    this.pollGew();
  };

  arrangeWindows = (): void => gewArrangeWindows();

  // ---------- the imagery window: a tab per source ----------
  private imageryTimer = 0;
  /** Bumped on every click on a source: a poll answer sent before it predates the click. */
  private imageryEpoch = 0;
  /** The source the user picked, kept as the one shown until the server shows it too: see reconcileImagery. */
  private imageryExpected: ImageryExpectation | null = null;

  /** The next poll starts once this one is answered, as for the statuses. */
  private pollImagery = async (): Promise<void> => {
    window.clearTimeout(this.imageryTimer);
    const epoch = this.imageryEpoch;
    try {
      const server = await fetchImageryStatus();
      if (epoch === this.imageryEpoch) {
        const { status, expected } = reconcileImagery(server, this.imageryExpected, Date.now());
        this.imageryExpected = expected;
        if (!sameImageryStatus(status, this.state.imagery)) this.set({ imagery: status });
      }
    } catch { /* server busy or restarting - retry */ }
    // Also after a stale answer: unlike the Google Earth Web poll, a click starts no poll of its own
    this.imageryTimer = window.setTimeout(this.pollImagery, IMAGERY_POLL_MILLIS);
  };

  /** Brings the tab of the source to the front; its button is shown pressed at once. */
  showImagery = (source: ImagerySource): void => {
    showImagerySource(source);
    this.imageryEpoch++;
    this.imageryExpected = { source, until: Date.now() + IMAGERY_EXPECT_MILLIS };
    this.set({ imagery: { ...this.state.imagery, visible: source } });
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
