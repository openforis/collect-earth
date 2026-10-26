import type { GewView, GroundView, LatLng, ListFilter, PlotStatus } from "./types";

// Pure plot-list logic shared by the store and the UI (unit tested in plots.test.ts).

/**
 * An empty dictionary keyed by plot id. It has no prototype: in a plain {} a plot id like "constructor" or "toString"
 * finds the method of Object.prototype before it is put, and putting "__proto__" changes the prototype instead.
 */
export function byId<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * The plots of a load keyed by id (see {@link byId}), and their ids in the order of the file: an id repeated keeps the
 * place it first had, with its last data. Built from this load alone, so that loading again replaces the plots.
 */
export function indexPlots<F extends { properties: { id: string } }, P>(features: F[], toPlot: (feature: F) => P):
    { order: string[]; plots: Record<string, P> } {
  const plots = byId<P>();
  const order: string[] = [];
  for (const feature of features) {
    const id = feature.properties.id;
    if (!(id in plots)) order.push(id);
    plots[id] = toPlot(feature);
  }
  return { order, plots };
}

/**
 * The ids of the plots of a load before (see {@link indexPlots}) that are not in this one: a load tried again after one
 * that failed half-way takes them off the map, where a click on one would find no plot.
 */
export function plotsGone(before: Record<string, unknown>, now: Record<string, unknown>): string[] {
  return Object.keys(before).filter((id) => !(id in now));
}

export function matchesFilter(id: string, status: PlotStatus, filter: ListFilter, query: string): boolean {
  if (filter === "pending" && status === "saved") return false;
  if (filter === "saved" && status !== "saved") return false;
  const q = query.trim().toLowerCase();
  return !q || id.toLowerCase().includes(q);
}

export function visibleIds(order: string[], statuses: Record<string, PlotStatus>,
    filter: ListFilter, query: string): string[] {
  return order.filter((id) => matchesFilter(id, statuses[id] ?? "empty", filter, query));
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

/** Corners of the ground rectangle shown by Google Earth Web (rotated by its heading). */
export function footprintCorners(view: GewView): LatLng[] {
  const h = (view.heading * Math.PI) / 180;
  const cosLat = Math.cos((view.latitude * Math.PI) / 180);
  const hw = view.widthMeters / 2, hh = view.heightMeters / 2;
  return ([[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]] as const).map(([x, y]) => {
    // screen offset (x right, y up) -> east/north for a camera rotated clockwise by `heading`
    const east = x * Math.cos(h) + y * Math.sin(h);
    const north = -x * Math.sin(h) + y * Math.cos(h);
    return [view.latitude + north / METERS_PER_DEGREE, view.longitude + east / (METERS_PER_DEGREE * cosLat)] as LatLng;
  });
}

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

// ---------- linked plots map and Google Earth Web views ----------

/** Web Mercator metres per pixel at zoom 0 on the equator (256 px tiles). */
const MERCATOR_METERS_PER_PIXEL = 156543.03392;

/** Height of ground (metres) a map `heightPx` high shows at `zoom`, around `latitude`. */
export function heightForZoom(zoom: number, heightPx: number, latitude: number): number {
  return (MERCATOR_METERS_PER_PIXEL * Math.cos((latitude * Math.PI) / 180) * heightPx) / 2 ** zoom;
}

/** Zoom at which a map `heightPx` high shows `heightMeters` of ground around `latitude`. */
export function zoomForHeight(heightMeters: number, heightPx: number, latitude: number): number {
  return Math.log2((MERCATOR_METERS_PER_PIXEL * Math.cos((latitude * Math.PI) / 180) * heightPx) / heightMeters);
}

/**
 * Moved by less than `tolerance` of the view height and zoomed by less than `tolerance`. A view of no height (the
 * server may send 0) is the same as another of no height at the same place, within a metre: otherwise it would never be
 * the same as anything, and the map following Google Earth Web would be moved on every poll.
 */
export function sameView(a: GroundView, b: GroundView, tolerance = 0.03): boolean {
  const cosLat = Math.cos((a.center[0] * Math.PI) / 180);
  const moved = Math.hypot((a.center[0] - b.center[0]) * METERS_PER_DEGREE,
    (a.center[1] - b.center[1]) * METERS_PER_DEGREE * cosLat);
  if (!(a.heightMeters > 0) || !(b.heightMeters > 0)) {
    return !(a.heightMeters > 0) && !(b.heightMeters > 0) && moved < 1;
  }
  return moved < tolerance * Math.min(a.heightMeters, b.heightMeters)
    && Math.abs(Math.log(a.heightMeters / b.heightMeters)) < tolerance;
}

// ---------- a plots map reopened on the plot that was open ----------

/** The `plot` parameter of the address: Collect Earth reopens a plots map the user closed on the plot that was open. */
export function plotParam(search: string): string | null {
  const id = new URLSearchParams(search).get("plot");
  return id && id.trim() ? id : null;
}

/** The plot to select once the plots have loaded: the one asked for, if the survey has it (else none, silently). */
export function plotToRestore(requested: string | null, plots: Record<string, unknown>): string | null {
  return requested != null && Object.prototype.hasOwnProperty.call(plots, requested) ? requested : null;
}

/** The address without its `plot` parameter, so that reloading the page does not select that plot again. */
export function withoutPlotParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("plot");
  return url.toString();
}

/** The survey area seen from above: the middle of the plots, from high enough to see them all (5 km at least). */
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
  return { center, heightMeters: Math.max(5000, Math.round(span * 1.5)) };
}
