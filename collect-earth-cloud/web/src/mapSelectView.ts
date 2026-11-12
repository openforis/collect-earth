import { MAP_STATUSES, type MapPlots } from "./api";

// A selection of plots on the map (coordinators): the plots inside rectangles drawn on the map, what
// of them can be given to someone else (per plot file and person holding them) and what cannot, and
// the moves that give them. Kept apart from the React code so it can be tested.

/** A rectangle drawn on the map, in degrees; west and east may go past ±180 on a map scrolled sideways. */
export interface Area {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Selected plots marked one by one on the map up to this many (as the map groups plots from CLUSTER_FROM). */
export const MARK_AT_MOST = 5000;

/** The most plots one call moves (the server's MAX_MOVE): a larger group is sent in parts. */
export const MOVE_AT_MOST = 20_000;

const SUBMITTED = MAP_STATUSES.indexOf("submitted");

/** Whether a longitude is between west and east, the rectangle possibly drawn on another copy of the world. */
function inLongitudes(lon: number, west: number, east: number): boolean {
  if (east - west >= 360) return true;
  for (const shift of [0, 360, -360, 720, -720]) {
    const l = lon + shift;
    if (l >= west && l <= east) return true;
  }
  return false;
}

/** Whether a plot is in one of the areas. */
export function inAreas(lat: number, lon: number, areas: readonly Area[]): boolean {
  return areas.some((a) => lat >= a.south && lat <= a.north && inLongitudes(lon, a.west, a.east));
}

/** The plots (indexes in the map) among `indexes` (those shown) inside the areas. */
export function selectInAreas(map: MapPlots, indexes: Uint32Array, areas: readonly Area[]): Uint32Array {
  if (areas.length === 0) return new Uint32Array(0);
  const out: number[] = [];
  for (const i of indexes) if (inAreas(map.lat[i], map.lon[i], areas)) out.push(i);
  return Uint32Array.from(out);
}

/** The plots of one plot file one person holds that are still to assess and can be given from the map. */
export interface SelectionGroup {
  fileId: string;
  filename: string;
  /** The person holding them (username). */
  holder: string;
  plots: string[];
}

/** Selected plots that cannot be given from the map, by why (each plot counted once, for the first reason). */
export interface KeptCounts {
  /** Submitted: submitted work never moves. */
  submitted: number;
  /** Reference plots: they never move. */
  reference: number;
  /** Listed in more than one plot file: who holds them depends on the file. */
  severalFiles: number;
  /** In a plot file given whole (not divided between people). */
  wholeFile: number;
  /** Still to assess, but held by nobody. */
  nobody: number;
}

export interface SelectionSummary {
  /** Plots selected. */
  total: number;
  /** Of them, not submitted. */
  toAssess: number;
  /** Of those, the ones that can be given from here. */
  movable: number;
  /** Per plot file and person; a plot two people hold is in both their groups. Sorted by person, then file. */
  groups: SelectionGroup[];
  /** Plots that can be given, per person holding them (a plot two people hold counts for both). */
  byHolder: { holder: string; plots: number }[];
  /** Plots that can be given, per plot file. */
  byFile: { fileId: string; filename: string; plots: number }[];
  kept: KeptCounts;
  /** Kept plots in all. */
  keptTotal: number;
}

const compare = (a: string, b: string) => a.localeCompare(b);

/**
 * What a selection holds. Submitted plots, reference plots, plots of several plot files, of a file
 * given whole and held by nobody cannot be given from the map; the others are grouped by plot file
 * and person, one call each (moveUnfinished with `plots`).
 */
export function summarizeSelection(map: MapPlots, selected: Uint32Array): SelectionSummary {
  const kept: KeptCounts = { submitted: 0, reference: 0, severalFiles: 0, wholeFile: 0, nobody: 0 };
  const groups = new Map<string, SelectionGroup>();
  const byFile = new Map<number, number>();
  const byHolder = new Map<string, number>();
  let toAssess = 0;
  let movable = 0;
  for (const i of selected) {
    if (map.status[i] >= SUBMITTED) {
      kept.submitted += 1;
      continue;
    }
    toAssess += 1;
    if (map.reference?.[i]) {
      kept.reference += 1;
      continue;
    }
    const f = map.file ? map.file[i] : -1;
    const file = f >= 0 ? map.files[f] : undefined;
    if (!file) {
      kept.severalFiles += 1;
      continue;
    }
    if (!file.divided) {
      kept.wholeFile += 1;
      continue;
    }
    const holders = map.holders?.[map.holder[i]] ?? [];
    if (map.holder[i] < 0 || holders.length === 0) {
      kept.nobody += 1;
      continue;
    }
    movable += 1;
    byFile.set(f, (byFile.get(f) ?? 0) + 1);
    for (const holder of holders) {
      byHolder.set(holder, (byHolder.get(holder) ?? 0) + 1);
      const key = `${file.id}\n${holder}`;
      let group = groups.get(key);
      if (!group) {
        group = { fileId: file.id, filename: file.filename, holder, plots: [] };
        groups.set(key, group);
      }
      group.plots.push(map.plots[i]);
    }
  }
  return {
    total: selected.length,
    toAssess,
    movable,
    groups: [...groups.values()].sort((a, b) => compare(a.holder, b.holder) || compare(a.filename, b.filename) || compare(a.fileId, b.fileId)),
    byHolder: [...byHolder].map(([holder, plots]) => ({ holder, plots })).sort((a, b) => b.plots - a.plots || compare(a.holder, b.holder)),
    byFile: [...byFile]
      .map(([f, plots]) => ({ fileId: map.files[f].id, filename: map.files[f].filename, plots }))
      .sort((a, b) => b.plots - a.plots || compare(a.filename, b.filename)),
    kept,
    keptTotal: kept.submitted + kept.reference + kept.severalFiles + kept.wholeFile + kept.nobody,
  };
}

/** One call of a giving: these plots of this file, from this person. */
export interface Move {
  fileId: string;
  filename: string;
  from: string;
  fromUserId: string;
  plots: string[];
}

export interface GivePlan {
  moves: Move[];
  /** Plots that go to the person (each once). */
  plots: number;
  /** Plots already theirs alone: nothing to do. */
  theirs: number;
  /** Plots whose holder is no longer in the project (they cannot be given from here). */
  unknown: number;
  /** The people the plots come from. */
  from: string[];
}

/**
 * The calls that give the selection's plots to `to` (a username): one per plot file and person
 * holding them (in parts of MOVE_AT_MOST), except their own. A plot `to` holds with someone else
 * comes from that someone (it then stays with `to` alone).
 */
export function givePlan(summary: SelectionSummary, to: string, userIdOf: ReadonlyMap<string, string>): GivePlan {
  const moves: Move[] = [];
  // Per plot: whether it moves, and whether one of its holders is unknown.
  const moving = new Set<string>();
  const stuck = new Set<string>();
  const all = new Set<string>();
  for (const group of summary.groups) {
    for (const plot of group.plots) all.add(`${group.fileId}\n${plot}`);
    if (group.holder === to) continue;
    const fromUserId = userIdOf.get(group.holder);
    if (!fromUserId) {
      for (const plot of group.plots) stuck.add(`${group.fileId}\n${plot}`);
      continue;
    }
    for (let k = 0; k < group.plots.length; k += MOVE_AT_MOST) {
      moves.push({ fileId: group.fileId, filename: group.filename, from: group.holder, fromUserId, plots: group.plots.slice(k, k + MOVE_AT_MOST) });
    }
    for (const plot of group.plots) moving.add(`${group.fileId}\n${plot}`);
  }
  let unknown = 0;
  for (const key of stuck) if (!moving.has(key)) unknown += 1;
  return {
    moves,
    plots: moving.size,
    theirs: all.size - moving.size - unknown,
    unknown,
    from: [...new Set(moves.map((m) => m.from))].sort(compare),
  };
}

/** What the calls of a giving did, added up. */
export interface GiveResult {
  moved: number;
  notMoved: number;
  droppedChecks: number;
  /** Calls done (of the plan's moves). */
  done: number;
}

export function addResult(sum: GiveResult, one: { moved: number; notMoved: number; droppedChecks: number }): GiveResult {
  return { moved: sum.moved + one.moved, notMoved: sum.notMoved + one.notMoved, droppedChecks: sum.droppedChecks + one.droppedChecks, done: sum.done + 1 };
}

/** The area of a drawn rectangle from two corners, as Leaflet gives them (any order). */
export function areaOf(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Area {
  return { south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat), west: Math.min(a.lng, b.lng), east: Math.max(a.lng, b.lng) };
}
