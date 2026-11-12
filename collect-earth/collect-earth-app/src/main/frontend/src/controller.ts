import { fetchGewStatus, fetchImageryStatus, fetchMapConfig, fetchPlots, fetchStatuses, formUrl, gewMoveCamera,
  openAuxiliaryWindows, postGewContext, showImagerySource } from "./api";
import { byId, changedAfterSubmit, type FormMessage, indexPlots, leftUnsubmitted, neighbour, nextUnfinished, normalizeStatus, plotsNear, surveyView,
  previousMessage, previousPlot, previousStands, type PreviousPlot, visibleIds } from "./plots";
import { imageryForNumber, reconcileImagery, sameImageryStatus, type ImageryExpectation } from "./imagery";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { formWindow, isFormMessage } from "./shortcuts";
import type { ImagerySource, ImageryStatus, LatLng, ListFilter, MapConfig, PlotFeature, PlotStatus } from "./types";

const POLL_MILLIS = 5000;
/** Google Earth Web's state, read until it is ready to be moved over the survey area. */
const GEW_POLL_MILLIS = 700;
/** Neighbouring plots drawn in Google Earth Web around the current one. */
const GEW_CONTEXT_RADIUS_METERS = 3000;
const GEW_CONTEXT_MAX_PLOTS = 300;
/** The tabs of the imagery window: the user opens and closes them, so they are read now and then. */
const IMAGERY_POLL_MILLIS = 2000;
/** How long a source the user picked is shown pressed before the server's answer wins (it shows it in ~1 s). */
const IMAGERY_EXPECT_MILLIS = 5000;

export interface UiState {
  order: string[];
  /**
   * What each plot is called on the screen, by id: the keys the collector may see (see plotLabel). Everything shown names
   * a plot by its label, everything else (the map, the form, the records, the statuses) by its id.
   */
  labels: Record<string, string>;
  statuses: Record<string, PlotStatus>;
  loaded: boolean;
  activeId: string | null;
  /** Counts the plots selected, the one open selected again included: the one-pane layout then shows its form again */
  selected: number;
  formUrl: string | null;
  filter: ListFilter;
  query: string;
  /** Collect Earth UI language (catalogues in i18n.ts; others fall back to English) */
  language: string;
  /** The tabs of the imagery window and the one shown: the source buttons. */
  imagery: ImageryStatus;
  /** The plot just submitted and the one the list moved to (null: none left), for a toast; key tells two apart. */
  submitted: { key: number; plotId: string; next: string | null } | null;
  /** A plot changed after it was submitted, and left without submitting it again, for a notice; key tells two apart. */
  unsubmitted: { key: number; plotId: string } | null;
}

interface Plot { feature: PlotFeature; center: LatLng; rings: LatLng[][] }

/** GeoJSON GeometryCollection of polygons -> [lat,lng] outer rings. */
function ringsOf(feature: PlotFeature): LatLng[][] {
  return feature.geometry.geometries
    .filter((g) => g.type === "Polygon")
    .map((g) => g.coordinates[0].map(([lng, lat]) => [lat, lng] as LatLng));
}

/**
 * Owns the plots, their statuses and the selection of the plots map in Google Earth Web's panel
 * (javascript_plots_map_panel.fmt), where Google Earth Web is the map; React subscribes to it through
 * useSyncExternalStore. Geometry lives outside the React state (it never changes after loading), so status polls only
 * copy the small id->status map.
 */
export class MapController {
  private state: UiState;
  private listeners = new Set<() => void>();
  /** Keyed by plot id, without a prototype (see byId), like every other dictionary of plots here. */
  private plots: Record<string, Plot> = byId();
  private prefs: Prefs = loadPrefs();
  private started = false;
  /** "generated" (the form built from the survey) or "balloon" (the CEP's HTML) */
  private webForm = "generated";
  private lastStatusPoll: number | null = null;
  /** Whether the statuses are polled: started by the first load that succeeds, and only once. */
  private statusPolling = false;
  /** The plot file of the plots loaded (see fetchPlots), and whether they are being loaded again */
  private plotsVersion: string | undefined;
  private loadingPlots = false;
  /** The plot open, when it was changed after it had been submitted: no longer submitted until it is again */
  private changedAfterSubmit: string | null = null;
  /** The answers of the plot submitted last in this session, for "Same as previous plot" in the form of the next ones */
  private previous: PreviousPlot | null = null;
  /** The operator working, as /api/app says (see setOperator) */
  private operator: string | null = null;

  constructor() {
    this.state = {
      order: [], labels: byId(), statuses: byId(), loaded: false, activeId: null, selected: 0, formUrl: null,
      filter: this.prefs.filter ?? "all", query: "", language: "en",
      imagery: { sources: [], visible: null }, submitted: null, unsubmitted: null,
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
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    window.addEventListener("message", this.onFormMessage);
    let config: MapConfig;
    try { config = await fetchMapConfig(); } catch {
      config = {}; // collection must still work
    }
    this.webForm = config.webForm ?? "generated";
    this.set({ language: config.language ?? "en" });
    this.pollGew();
    this.pollImagery();
    this.loadPlots();
  }

  private async loadPlots(): Promise<void> {
    this.loadingPlots = true;
    try {
      const fc = await fetchPlots();
      if (fc.plots !== this.plotsVersion) {
        // Another plot file: the statuses of its plots are asked for from the start, a poll under way left out
        this.plotsVersion = fc.plots;
        this.lastStatusPoll = null;
      }
      // None (e.g. no survey loaded): the list says so; the statuses tell when there is a plot file to load
      if (!fc.features || fc.features.length === 0) {
        this.plots = byId();
        this.set({ order: [], labels: byId(), statuses: byId(), loaded: true, ...(this.state.activeId !== null ? { activeId: null, formUrl: null } : {}) });
        this.startStatusPolling();
        return;
      }
      // From this answer alone, and put in place at once: a load tried again after one that failed half-way (below)
      // would otherwise find its plots there already, and leave them out of the list
      const { order, plots, labels } = indexPlots(fc.features, (feature) => ({
        feature, rings: ringsOf(feature),
        center: [parseFloat(feature.properties.latitude), parseFloat(feature.properties.longitude)] as LatLng,
      }));
      this.plots = plots;
      const statuses = byId<PlotStatus>();
      // Those known already are kept: the polls ask only for the changes since the last one
      for (const id of order) statuses[id] = this.state.statuses[id] ?? "empty";
      // The plot open, if it is gone, is closed: nothing could be done with it
      const activeGone = this.state.activeId !== null && !(this.state.activeId in plots);
      // nothing to go back to
      if (this.changedAfterSubmit != null && !(this.changedAfterSubmit in plots)) this.changedAfterSubmit = null;
      this.set({ order, labels, statuses, loaded: true, ...(activeGone ? { activeId: null, formUrl: null } : {}) });
      this.startStatusPolling();
    } catch {
      window.setTimeout(() => this.loadPlots(), 5000);
    } finally {
      this.loadingPlots = false;
    }
  }

  /** Each poll schedules the next: a second start would poll twice as often, for good */
  private startStatusPolling(): void {
    if (this.statusPolling) return;
    this.statusPolling = true;
    this.pollStatuses();
  }

  private allCenters(): LatLng[] {
    return this.state.order.map((id) => this.plots[id].center);
  }

  // ---------- statuses ----------
  /** The next poll starts once this one is answered: on a slow server, polls on a timer piled up. */
  private async pollStatuses(): Promise<void> {
    const version = this.plotsVersion;
    try {
      const data = await fetchStatuses(this.lastStatusPoll);
      // The plots were loaded again meanwhile: the answer is of the plot file before
      if (version !== this.plotsVersion) throw new Error("stale");
      // Another plot file (the settings applied, a plot file dropped, the cloud project's assigned file): the list
      // loads it, as nothing reloads this page in Google Earth Web's panel
      if (data.plots !== undefined && data.plots !== version && !this.loadingPlots) void this.loadPlots();
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
  }

  // Same-origin messages from the web form in the iframe, and from its window only
  private onFormMessage = (event: MessageEvent): void => {
    if (!isFormMessage(event, window.location.origin, formWindow())) return;
    const data = event.data as FormMessage | null;
    // ignore anything but the active plot (stale iframe race)
    if (!data?.type || data.plotId == null || data.plotId !== this.state.activeId || !(data.plotId in this.plots)) return;
    this.changedAfterSubmit = changedAfterSubmit(this.changedAfterSubmit, data);
    this.previous = previousPlot(this.previous, data, this.operator);
    if (data.type === "ce:ready") {
      // the form of the plot open asks for the answers of the plot submitted before: forgotten when they are of another
      // survey (another project opened) or another operator
      if (this.previous && !previousStands(this.previous, data.survey, this.operator)) this.previous = null;
      const reply = previousMessage(this.previous, data.plotId, data.survey, this.operator);
      if (reply) (event.source as Window | null)?.postMessage(reply, window.location.origin);
    } else if (data.type === "ce:saved") {
      this.applyStatuses({ [data.plotId]: "saved" });
      const next = this.goToNextUnfinished();
      this.set({ submitted: { key: Date.now(), plotId: data.plotId, next } });
    } else if (data.type === "ce:dirty") {
      this.applyStatuses({ [data.plotId]: "partial" });
    }
  };

  /** The operator working changed (or is first known): the answers another one submitted are not offered to this one */
  setOperator = (operator: string | null): void => {
    if (operator === this.operator) return;
    this.operator = operator;
    this.previous = null;
  };

  // ---------- selection ----------
  selectPlot = (id: string): void => {
    const plot = this.plots[id];
    if (!plot) return;
    if (this.state.formUrl != null) this.noticeIfUnsubmitted(id);
    this.set({ activeId: id, selected: this.state.selected + 1, formUrl: formUrl(plot.feature, this.webForm, this.state.language) });
    this.sendGewContext(id);
    openAuxiliaryWindows(plot.feature);
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

  /**
   * The form leaves the plot open, for plot `going` or for none: if it was changed after it had been submitted, a notice
   * says it is no longer submitted, with the way back to it. Navigation goes on: it is only told.
   */
  private noticeIfUnsubmitted(going: string | null): void {
    const plotId = leftUnsubmitted(this.changedAfterSubmit, this.state.activeId, going);
    if (!plotId) return;
    this.changedAfterSubmit = null;
    this.set({ unsubmitted: { key: Date.now(), plotId } });
  }

  /** key: the notice's, so that the end of an older one never dismisses a newer one */
  dismissUnsubmitted = (key?: number): void => {
    if (this.state.unsubmitted && (key == null || this.state.unsubmitted.key === key)) this.set({ unsubmitted: null });
  };

  /** Back to the plot the notice is about, which closes it */
  backToUnsubmitted = (): void => {
    const plotId = this.state.unsubmitted?.plotId;
    this.set({ unsubmitted: null });
    if (plotId && plotId in this.plots) this.selectPlot(plotId);
  };

  /** Previous/next plot among those currently shown in the list (all plots if none). */
  neighbourOf(id: string | null, step: 1 | -1): string | null {
    const { order, labels, statuses, filter, query } = this.state;
    const visible = visibleIds(order, statuses, filter, query, labels);
    return neighbour(visible.length ? visible : order, id, step);
  }

  step = (step: 1 | -1): void => {
    const id = this.neighbourOf(this.state.activeId, step);
    if (id) this.selectPlot(id);
  };

  closeForm = (): void => {
    if (this.state.formUrl == null) return;
    this.noticeIfUnsubmitted(null);
    this.set({ formUrl: null });
  };

  // ---------- Google Earth Web ----------
  /**
   * Before any plot: Google Earth Web was opened without knowing where the plots are, so the panel moves it over the
   * survey area once it is ready. Read until then, or until a plot is selected, which moves it to that plot.
   */
  private pollGew = async (): Promise<void> => {
    if (this.state.activeId) return;
    try {
      const gew = await fetchGewStatus();
      if (gew.state === "READY" && this.state.order.length && !this.state.activeId) {
        gewMoveCamera(surveyView(this.allCenters()));
        return;
      }
    } catch { /* server busy or restarting - retry */ }
    window.setTimeout(this.pollGew, GEW_POLL_MILLIS);
  };

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
    // Also after a stale answer: a click starts no poll of its own
    this.imageryTimer = window.setTimeout(this.pollImagery, IMAGERY_POLL_MILLIS);
  };

  /** Brings the tab of the source to the front; its button is shown pressed at once. */
  showImagery = (source: ImagerySource): void => {
    showImagerySource(source);
    this.imageryEpoch++;
    this.imageryExpected = { source, until: Date.now() + IMAGERY_EXPECT_MILLIS };
    this.set({ imagery: { ...this.state.imagery, visible: source } });
  };

  /** The source of key Alt+`n` (see imageryNumberOf), when it has a button */
  showImageryNumber = (n: number): void => {
    const source = imageryForNumber(this.state.imagery, n);
    if (source) this.showImagery(source);
  };

  // ---------- list ----------
  setFilter = (filter: ListFilter): void => { this.set({ filter }); this.savePref("filter", filter); };
  setQuery = (query: string): void => this.set({ query });
}
