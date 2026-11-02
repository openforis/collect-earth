import { MAP_STATUSES, type MapFile, type MapPlots, type MapStatus, type MapTiles } from "./api";
import type { MessageKey } from "./i18n";
import { pathFor } from "./router";

/** From this many plots shown, nearby plots are grouped into numbered circles (leaflet.markercluster). */
export const CLUSTER_FROM = 5000;

/** How a status is drawn: a circle (on a canvas), told apart by its fill, outline and dashes as well as its colour. */
export interface StatusStyle {
  /** Okabe–Ito colours (told apart with the common colour blindnesses), the grey darker for contrast on the map. */
  color: string;
  fillOpacity: number;
  /** Outline width in pixels. */
  weight: number;
  dashArray?: string;
  radius: number;
}

export const STATUS_STYLE: Record<MapStatus, StatusStyle> = {
  // A hollow ring.
  notStarted: { color: "#616161", fillOpacity: 0, weight: 2, radius: 5 },
  // A dashed ring, lightly filled.
  started: { color: "#E69F00", fillOpacity: 0.35, weight: 2, dashArray: "3 2", radius: 5 },
  // A full dot.
  submitted: { color: "#0072B2", fillOpacity: 0.85, weight: 1, radius: 5 },
  // A full, larger dot.
  accepted: { color: "#009E73", fillOpacity: 0.85, weight: 1, radius: 6 },
  // A full dot with a thick outline.
  recheck: { color: "#CC79A7", fillOpacity: 0.85, weight: 3, radius: 6 },
  // A larger ring with a thick dashed outline.
  differs: { color: "#D55E00", fillOpacity: 0.5, weight: 3, dashArray: "4 2", radius: 7 },
};

export function statusLabelKey(status: MapStatus): MessageKey {
  return `map.status.${status}` as MessageKey;
}

/** How the status is drawn, in words (the legend's cue besides the colour). */
export function statusDrawnKey(status: MapStatus): MessageKey {
  return `map.drawn.${status}` as MessageKey;
}

/** The legend's symbol for a status, drawn as on the map (an inline SVG). */
export function symbolSvg(status: MapStatus, size = 20): string {
  const s = STATUS_STYLE[status];
  const r = Math.min(size / 2 - s.weight, s.radius + 2);
  const dash = s.dashArray ? ` stroke-dasharray="${s.dashArray}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${s.color}" fill-opacity="${s.fillOpacity}" stroke="${s.color}" stroke-width="${s.weight}"${dash}/></svg>`;
}

/** The points whose status is shown, in the map's order. */
export function shownIndexes(map: MapPlots, shown: ReadonlySet<MapStatus>): Uint32Array {
  const codes = MAP_STATUSES.map((s) => shown.has(s));
  let n = 0;
  for (let i = 0; i < map.total; i++) if (codes[map.status[i]]) n++;
  const out = new Uint32Array(n);
  let k = 0;
  for (let i = 0; i < map.total; i++) if (codes[map.status[i]]) out[k++] = i;
  return out;
}

/** [[south, west], [north, east]] of the points, or null when there are none. */
export function boundsOf(map: MapPlots, indexes: Uint32Array): [[number, number], [number, number]] | null {
  if (indexes.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const i of indexes) {
    const lat = map.lat[i];
    const lon = map.lon[i];
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return [
    [south, west],
    [north, east],
  ];
}

export interface PlotPopup {
  plot: string;
  status: MapStatus;
  /** Who holds it (coordinators; empty for nobody); null for a reviewer. */
  people: string[] | null;
  /** Its page (plot search's page). */
  path: string;
}

/** What a plot's popup says. */
export function plotPopup(map: MapPlots, index: number, projectId: string): PlotPopup {
  const plot = map.plots[index];
  const holder = map.holder[index];
  return {
    plot,
    status: MAP_STATUSES[map.status[index]] ?? "notStarted",
    people: map.holders === null ? null : holder >= 0 ? (map.holders[holder] ?? []) : [],
    path: pathFor({ name: "plot", projectId, plot }),
  };
}

/** Files with plots that have no latitude and longitude. */
export function filesOffMap(map: Pick<MapPlots, "files">): MapFile[] {
  return map.files.filter((f) => f.onMap < f.plots);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The tiles' attribution as Leaflet shows it (HTML): the text, linked when the source gives a link. */
export function attributionHtml(tiles: MapTiles): string {
  const text = escapeHtml(tiles.attribution);
  return tiles.attributionUrl ? `<a href="${escapeHtml(tiles.attributionUrl)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
}
