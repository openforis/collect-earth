// The map of progress.

import type { MapFile, MapPage, MapStatus } from "../../../src/wire/map";
import { ApiError, p, request } from "./transport";

// --- map of progress (Task 9) -------------------------------------------------------

export type { MapFile, MapPage, MapStatus } from "../../../src/wire/map";
/** A plot's status on the map, in the server's order of status codes (its GEO_STATUSES). */
export const MAP_STATUSES = ["notStarted", "started", "submitted", "accepted", "recheck", "differs", "resubmitted"] as const satisfies readonly MapStatus[];

/** Every plot on the map, in typed arrays (a large project has 100,000 or more). */
export interface MapPlots {
  version: string;
  /** Plots on the map. */
  total: number;
  lat: Float64Array;
  lon: Float64Array;
  /** Index in MAP_STATUSES. */
  status: Uint8Array;
  /** Index in `holders`; -1 for nobody (always for a reviewer). */
  holder: Int32Array;
  plots: string[];
  /** The id the collector sees of each plot (as plot search lists it); null when it is the plot id. */
  names: string[] | null;
  /** Coordinators: each plot's plot file, an index in `files` (-1 when several list it); null for a reviewer. */
  file: Int32Array | null;
  /** Coordinators: 1 for a reference plot (it never moves); null for a reviewer. */
  reference: Uint8Array | null;
  /** Plots per status, those off the map included. */
  counts: Record<MapStatus, number>;
  notOnMap: number;
  files: MapFile[];
  /** Coordinators: everyone holding a plot or who made a first assessment; null for a reviewer. */
  people: string[] | null;
  holders: string[][] | null;
  /** The quality figures the disagreements come from; null when none are at hand. */
  figures: MapPage["figures"];
  /** Set when the plots' state is older than the records (newer figures are being worked out). */
  asOf: number | null;
  /** The survey's coordinate system when it is not latitude and longitude: no plot is on the map. */
  unsupportedSrs?: string;
}

export interface MapFilters {
  file?: string | null;
  person?: string | null;
}

/** Times a map is read again from the start when the server no longer has it between its pages. */
const MAP_RESTARTS = 3;

/** One page of GET /map/plots, added to the map being read (made on the first page). */
export function addMapPage(map: MapPlots | null, page: MapPage): MapPlots {
  // A point's status is an index in the page's `statuses`: read by its name.
  const codeOf = page.statuses.map((name) => MAP_STATUSES.indexOf(name));
  if (map === null) {
    const total = page.total;
    const counts = Object.fromEntries(MAP_STATUSES.map((s) => [s, 0])) as Record<MapStatus, number>;
    page.counts.forEach((n, i) => {
      counts[page.statuses[i]] += n;
    });
    const coordinator = page.file !== undefined;
    map = {
      version: page.version,
      total,
      lat: new Float64Array(total),
      lon: new Float64Array(total),
      status: new Uint8Array(total),
      holder: new Int32Array(total).fill(-1),
      plots: new Array<string>(total).fill(""),
      names: page.names ? new Array<string>(total).fill("") : null,
      file: coordinator ? new Int32Array(total).fill(-1) : null,
      reference: coordinator ? new Uint8Array(total) : null,
      counts,
      notOnMap: page.notOnMap,
      files: page.files,
      people: page.people,
      holders: page.holders,
      figures: page.figures,
      asOf: page.asOf,
      ...(page.unsupportedSrs !== undefined ? { unsupportedSrs: page.unsupportedSrs } : {}),
    };
  }
  const { offset, points } = page;
  for (let i = 0; i < points.length && offset + i < map.total; i++) {
    const [lat, lon, status, holder] = points[i];
    const at = offset + i;
    map.lat[at] = lat;
    map.lon[at] = lon;
    map.status[at] = codeOf[status];
    map.holder[at] = holder;
    map.plots[at] = page.plots[i];
    if (map.names) map.names[at] = page.names?.[i] ?? map.plots[at];
    if (map.file && page.file) map.file[at] = page.file[i];
  }
  // The reference plots of this page, by their index in the whole map.
  if (map.reference) for (const at of page.reference ?? []) map.reference[at] = 1;
  return map;
}

/**
 * Every plot on the map (coordinators and reviewers), read page by page (20,000 a page);
 * `onProgress` says how many are read. The server builds a map on its first page and serves
 * the next ones from that build (`version`), so the pages agree; when it no longer has it
 * (409 map_changed), the map is read again from the start, at most MAP_RESTARTS times, then
 * that error is thrown: a map is never returned in part. `stopped()` true stops reading (the
 * page was left; what was read is returned and must not be shown).
 */
export async function getMapPlots(
  projectId: string,
  filters: MapFilters,
  onProgress?: (loaded: number, total: number) => void,
  stopped: () => boolean = () => false,
): Promise<MapPlots> {
  for (let attempt = 0; ; attempt++) {
    let map: MapPlots | null = null;
    let offset: number | null = 0;
    let changed = false;
    while (offset !== null) {
      const query = new URLSearchParams({ offset: String(offset) });
      if (filters.file) query.set("file", filters.file);
      if (filters.person) query.set("person", filters.person);
      if (map !== null) query.set("version", map.version);
      let page: MapPage;
      try {
        page = await request<MapPage>("GET", `${p(projectId)}/map/plots?${query.toString()}`);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "map_changed") || attempt >= MAP_RESTARTS) throw error;
        changed = true;
        break;
      }
      map = addMapPage(map, page);
      offset = page.next;
      onProgress?.(offset ?? map.total, map.total);
      if (stopped()) return map;
    }
    if (!changed) return map!;
  }
}
