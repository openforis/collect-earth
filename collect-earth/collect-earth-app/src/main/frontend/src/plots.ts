import type { GroundView, LatLng, ListFilter, PlotStatus } from "./types";

// Pure plot-list logic shared by the store and the UI (unit tested in plots.test.ts).

/**
 * An empty dictionary keyed by plot id. It has no prototype: in a plain {} a plot id like "constructor" or "toString"
 * finds the method of Object.prototype before it is put, and putting "__proto__" changes the prototype instead.
 */
export function byId<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * The plots of a load keyed by id (see {@link byId}), their ids in the order of the file, and the label each is shown
 * by: an id repeated keeps the place it first had, with its last data. Built from this load alone, so that loading
 * again replaces the plots.
 */
export function indexPlots<F extends { properties: { id: string; visibleId?: string | null } }, P>(features: F[],
    toPlot: (feature: F) => P): { order: string[]; plots: Record<string, P>; labels: Record<string, string> } {
  const plots = byId<P>();
  const labels = byId<string>();
  const order: string[] = [];
  const place = byId<number>();
  for (const feature of features) {
    const id = feature.properties.id;
    if (!(id in plots)) {
      order.push(id);
      place[id] = order.length;
    }
    plots[id] = toPlot(feature);
    const label = labelOfFeature(feature.properties);
    // Every key hidden (an empty visible id): the plot is called by its place in the file, "#3", which tells nothing
    // of the hidden keys.
    labels[id] = label !== "" ? label : `#${place[id]}`;
  }
  return { order, plots, labels };
}

/**
 * What a plot is called on the screen: its visible id, the keys without those hidden from the collector (a blind quality
 * control copy "105,2" is called "105", like the main plot "101,1" is called "101"). The id itself stays the key of
 * everything else (the map, the form, the records). A plot file from before the visible id is called by its id.
 */
export function labelOfFeature(properties: { id: string; visibleId?: string | null }): string {
  return properties.visibleId != null ? properties.visibleId : properties.id;
}

/** The label of the plot `id` (see {@link labelOfFeature}); its id when it is not among `labels`, "" for no plot. */
export function plotLabel(labels: Record<string, string>, id: string | null | undefined): string {
  if (id == null) return "";
  return Object.prototype.hasOwnProperty.call(labels, id) ? labels[id] : id;
}

/** Whether a plot shown as `label` is in the list: the search looks in the label, never in the keys hidden from it. */
export function matchesFilter(label: string, status: PlotStatus, filter: ListFilter, query: string): boolean {
  if (filter === "pending" && status === "saved") return false;
  if (filter === "saved" && status !== "saved") return false;
  const q = query.trim().toLowerCase();
  return !q || label.toLowerCase().includes(q);
}

/** The ids of the plots in the list, searched by their labels (see {@link plotLabel}). */
export function visibleIds(order: string[], statuses: Record<string, PlotStatus>,
    filter: ListFilter, query: string, labels: Record<string, string>): string[] {
  return order.filter((id) => matchesFilter(plotLabel(labels, id), statuses[id] ?? "empty", filter, query));
}

/** First plot after `fromId` (wrapping around, CSV order) that is not completed. */
export function nextUnfinished(order: string[], statuses: Record<string, PlotStatus>,
    fromId: string | null): string | null {
  if (!order.length) return null;
  const start = fromId ? order.indexOf(fromId) + 1 : 0;
  for (let i = 0; i < order.length; i++) {
    const id = order[(start + i) % order.length];
    if (statuses[id] !== "saved") return id;
  }
  return null;
}

/**
 * A message of the form about its plot (see FormStore.post): `answers`, with a submit ("ce:saved"), those the next plot
 * may copy ("Same as previous plot"); `survey`, with a submit and when the form is ready ("ce:ready"), its survey's name.
 */
export interface FormMessage {
  type?: string; plotId?: string; unsubmitted?: boolean; answers?: Record<string, string>; survey?: string;
}

/**
 * The answers of the plot submitted last in this session, which the form of the next one may copy: by the operator
 * then, in the survey then, which another operator, or another survey, never gets
 */
export interface PreviousPlot { plotId: string; answers: Record<string, string>; survey: string; operator: string | null }

/**
 * The plot submitted last, after a message of the form (`previous` before it), `operator` being the one working: a
 * submit with its answers replaces it
 */
export function previousPlot(previous: PreviousPlot | null, message: FormMessage, operator: string | null): PreviousPlot | null {
  if (message.type !== "ce:saved" || message.plotId == null || !message.answers || typeof message.answers !== "object") return previous;
  return { plotId: message.plotId, answers: message.answers, survey: message.survey ?? "", operator };
}

/** Whether the answers of the plot before are still for the form of `survey` and the operator working */
export function previousStands(previous: PreviousPlot, survey: string | undefined, operator: string | null): boolean {
  return previous.survey === (survey ?? "") && previous.operator === operator;
}

/**
 * The answer to the form of plot `plotId` in `survey` when it is ready ("ce:ready"): the answers of the plot submitted
 * before, or null when there is none, it is that plot itself, or of another survey or operator.
 */
export function previousMessage(previous: PreviousPlot | null, plotId: string, survey: string | undefined, operator: string | null):
  { type: "ce:previous"; plotId: string; survey: string; answers: Record<string, string> } | null {
  if (!previous || previous.plotId === plotId || !previousStands(previous, survey, operator)) return null;
  return { type: "ce:previous", plotId: previous.plotId, survey: previous.survey, answers: previous.answers };
}

/**
 * The plots the search finds in the list the filter leaves out ("pending" or "saved"), and how many, for the user to be
 * offered them when it finds none in the list shown; null when it finds none there either, or nothing is filtered.
 */
export function matchesElsewhere(order: string[], statuses: Record<string, PlotStatus>, filter: ListFilter, query: string,
  labels: Record<string, string>): { count: number; filter: Exclude<ListFilter, "all"> } | null {
  if (filter === "all" || !query.trim()) return null;
  const other = filter === "pending" ? "saved" : "pending";
  const count = visibleIds(order, statuses, other, query, labels).length;
  return count ? { count, filter: other } : null;
}

/**
 * The plot open that was changed after it had been submitted, complete, after a message of its form (`changed` before
 * it): set by a change that took the submission back, and cleared by a submit. A plot never submitted, or submitted
 * with questions left unanswered, is never one.
 */
export function changedAfterSubmit(changed: string | null, message: FormMessage): string | null {
  if (message.plotId == null) return changed;
  if (message.type === "ce:dirty" && message.unsubmitted) return message.plotId;
  if (message.type === "ce:saved" && changed === message.plotId) return null;
  return changed;
}

/**
 * The plot to tell the user is no longer submitted as the form leaves it, for another plot (`going`) or for none (null):
 * `changed`, the plot open that was changed after it had been submitted, when it is the one left.
 */
export function leftUnsubmitted(changed: string | null, leaving: string | null, going: string | null): string | null {
  return changed != null && changed === leaving && going !== leaving ? changed : null;
}

/** Neighbour of `fromId` among `ids` (step +1/-1); null at the ends. When `fromId` is
 *  not among `ids`, the first (or last) id is returned. */
export function neighbour(ids: string[], fromId: string | null, step: 1 | -1): string | null {
  if (!ids.length) return null;
  const index = fromId == null ? -1 : ids.indexOf(fromId);
  if (index === -1) return step > 0 ? ids[0] : ids[ids.length - 1];
  const next = index + step;
  return next >= 0 && next < ids.length ? ids[next] : null;
}

export interface Counts { total: number; saved: number; partial: number; pending: number }

export function countStatuses(order: string[], statuses: Record<string, PlotStatus>): Counts {
  let saved = 0, partial = 0;
  for (const id of order) {
    if (statuses[id] === "saved") saved++;
    else if (statuses[id] === "partial") partial++;
  }
  return { total: order.length, saved, partial, pending: order.length - saved };
}

export function normalizeStatus(value: unknown): PlotStatus {
  return value === "saved" || value === "partial" ? value : "empty";
}

const METERS_PER_DEGREE = 111320;

/** Ids of the plots within `radiusMeters` of `center`, nearest first, at most `limit`. */
export function plotsNear(centers: Record<string, LatLng>, center: LatLng, radiusMeters: number, limit: number): string[] {
  const cosLat = Math.cos((center[0] * Math.PI) / 180);
  const near: [string, number][] = [];
  for (const [id, [lat, lng]] of Object.entries(centers)) {
    const dy = (lat - center[0]) * METERS_PER_DEGREE, dx = (lng - center[1]) * METERS_PER_DEGREE * cosLat;
    const d = Math.hypot(dx, dy);
    if (d <= radiusMeters) near.push([id, d]);
  }
  return near.sort((a, b) => a[1] - b[1]).slice(0, limit).map(([id]) => id);
}

/**
 * The highest view Google Earth Web is sent to: the server refuses a camera higher than this
 * (PlacemarkBrowserServlet.moveGoogleEarthWebCamera), and from there it shows the whole globe anyway.
 */
export const MAX_VIEW_HEIGHT = 2.0e7;

/**
 * The survey area seen from above: the middle of the plots, from high enough to see them all (5 km at least), but no
 * higher than {@link MAX_VIEW_HEIGHT}, which plots spread over continents would ask for.
 */
export function surveyView(centers: LatLng[]): GroundView {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lat, lng] of centers) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  }
  const center: LatLng = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  const metresPerDegree = 111320;
  const span = Math.max((maxLat - minLat) * metresPerDegree,
    (maxLng - minLng) * metresPerDegree * Math.cos((center[0] * Math.PI) / 180));
  return { center, heightMeters: Math.min(MAX_VIEW_HEIGHT, Math.max(5000, Math.round(span * 1.5))) };
}
