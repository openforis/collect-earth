import type { PlotUnits } from './progress.js';
import type { DecisionKind } from './types.js';

/**
 * The map of progress (Task 9, monitoring Phase 5), pure: every plot of the plot files with
 * its place (latitude and longitude, as Collect Earth reads them), its status and who holds
 * it, as compact arrays served in pages.
 *
 * Status codes (the index in GEO_STATUSES):
 * - 0 not started, 1 started (a first assessment saved, none submitted), 2 submitted: the
 *   Progress tab's count (plotUnits);
 * - for a submitted plot, 3 accepted (decided "first" or "check"), 4 needs another look
 *   (decided "both need another look"): the decisions the server keeps;
 * - 5 disagreement: its answers differ from a check and nobody decided it, from the quality
 *   figures at hand only (QualityService.peek); without them, no plot has this status;
 * - 6 submitted again: decided "both need another look" and submitted again since (the review
 *   queue's rule, resubmittedAfterRecheck), from the figures at hand only (else 4).
 * Codes 2 to 6 together are the plots the Progress tab counts as submitted.
 */
export const GEO_STATUSES = ['notStarted', 'started', 'submitted', 'accepted', 'recheck', 'differs', 'resubmitted'] as const;
export type GeoStatus = (typeof GEO_STATUSES)[number];

/** Plots in one page of GET /map/plots. */
export const GEO_PAGE_SIZE = 20_000;

const NOT_STARTED = 0;
const STARTED = 1;
const SUBMITTED = 2;
const ACCEPTED = 3;
const RECHECK = 4;
const DIFFERS = 5;
const RESUBMITTED = 6;

/** What the statuses are read from (ProjectStateCache's plotUnits). */
export type GeoProgress = Pick<PlotUnits, 'firstSubmitted' | 'started' | 'held' | 'byOperator'>;

export interface GeoFile {
  id: string;
  filename: string;
  /** Its plot units, in the file's order. */
  units: readonly string[];
  /** unit -> [lat, lon]; null when its places cannot be given (another coordinate system, or the file could not be read). */
  places: ReadonlyMap<string, readonly [number, number]> | null;
}

export interface GeoInput {
  files: readonly GeoFile[];
  /** False for units that are checks (an own round's re-assessment units). */
  isPlot: (unit: string) => boolean;
  progress: GeoProgress;
  /** plot -> its decision. */
  decisions: ReadonlyMap<string, DecisionKind>;
  /** Plots whose answers differ from a check (the figures' pairs); null without figures at hand. */
  differing: ReadonlySet<string> | null;
  /** Plots decided "both need another look" and submitted again since (resubmittedAfterRecheck); null without figures. */
  resubmitted?: ReadonlySet<string> | null;
  /** The id the collector sees (visibleId); absent when it is always the unit. */
  nameOf?: ((unit: string) => string) | null;
  /** Whether to say who holds each plot (coordinators only). */
  people: boolean;
  /** Only this plot file's plots, placed by it. */
  file?: string | null;
  /** Only the plots this person holds or made the first assessment of. */
  person?: string | null;
}

export interface GeoFileRow {
  id: string;
  filename: string;
  /** Its plots. */
  plots: number;
  /** Of those, the ones with a place. */
  onMap: number;
}

export interface GeoMap {
  /** The plots on the map (those with a place), in the files' order, each once. */
  plots: string[];
  lat: number[];
  lon: number[];
  status: number[];
  /** Index in `holders`; -1 when nobody holds it (always for a reviewer). */
  holder: number[];
  /** The id the collector sees of each plot; null when it is the plot id for every plot. */
  names: string[] | null;
  /** Everyone who holds a plot or made a first assessment (the person filter); null for a reviewer. */
  people: string[] | null;
  /** The different groups of people holding a plot, names sorted; null for a reviewer. */
  holders: string[][] | null;
  /** Plots per status (the filters' plots, those off the map included), by status code. */
  counts: number[];
  /** The filters' plots without a place. */
  notOnMap: number;
  files: GeoFileRow[];
}

/** One plot's status code (see GEO_STATUSES). */
export function geoStatus(
  unit: string,
  progress: Pick<GeoProgress, 'firstSubmitted' | 'started'>,
  decisions: ReadonlyMap<string, DecisionKind>,
  differing: ReadonlySet<string> | null,
  resubmitted: ReadonlySet<string> | null = null,
): number {
  if (!progress.firstSubmitted.has(unit)) {
    return progress.started.has(unit) ? STARTED : NOT_STARTED;
  }
  const decision = decisions.get(unit);
  if (decision === 'recheck') return resubmitted?.has(unit) ? RESUBMITTED : RECHECK;
  if (decision !== undefined) return ACCEPTED;
  return differing?.has(unit) ? DIFFERS : SUBMITTED;
}

/** Six decimals: about 0.1 m, and a shorter answer. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function plotsGeo(input: GeoInput): GeoMap {
  const { progress, isPlot } = input;
  // Who holds each plot, and everyone for the person filter.
  const holdersOf = new Map<string, string[]>();
  let people: string[] | null = null;
  if (input.people) {
    const names = new Set<string>();
    for (const [username, units] of progress.held) {
      if (units.length > 0) names.add(username);
      for (const unit of units) {
        const list = holdersOf.get(unit);
        if (!list) holdersOf.set(unit, [username]);
        else if (!list.includes(username)) list.push(username);
      }
    }
    for (const [operator, work] of progress.byOperator) {
      if (work.mainSubmitted.size > 0 || work.mainDrafts.size > 0) names.add(operator);
    }
    people = [...names].sort();
  }
  // The person filter: plots they hold, or of which they made the first assessment.
  let mine: ((unit: string) => boolean) | null = null;
  if (input.person != null) {
    const held = new Set(progress.held.get(input.person) ?? []);
    const work = progress.byOperator.get(input.person);
    mine = (unit) => held.has(unit) || (work?.mainSubmitted.has(unit) ?? false) || (work?.mainDrafts.has(unit) ?? false);
  }

  const map: GeoMap = {
    plots: [],
    lat: [],
    lon: [],
    status: [],
    holder: [],
    names: input.nameOf ? [] : null,
    people,
    holders: input.people ? [] : null,
    counts: GEO_STATUSES.map(() => 0),
    notOnMap: 0,
    files: [],
  };
  const groups = new Map<string, number>();
  const groupOf = (unit: string): number => {
    const names = holdersOf.get(unit);
    if (!names || names.length === 0 || !map.holders) return -1;
    const sorted = names.length > 1 ? [...names].sort() : names;
    const key = sorted.join('\n');
    let index = groups.get(key);
    if (index === undefined) {
      index = map.holders.length;
      map.holders.push(sorted);
      groups.set(key, index);
    }
    return index;
  };

  // Each plot once: its place from the first file listed that gives it one (as PlotPlaceReader),
  // or from the file asked for.
  const seen = new Set<string>();
  const placed = new Set<string>();
  const pending: string[] = [];
  for (const file of input.files) {
    let plots = 0;
    let onMap = 0;
    for (const unit of file.units) {
      if (!isPlot(unit)) continue;
      plots += 1;
      const at = file.places?.get(unit);
      if (at) onMap += 1;
      if (input.file != null && file.id !== input.file) continue;
      if (placed.has(unit) || (mine && !mine(unit))) continue;
      if (!seen.has(unit)) {
        seen.add(unit);
        map.counts[geoStatus(unit, progress, input.decisions, input.differing, input.resubmitted)] += 1;
      }
      if (!at) {
        pending.push(unit);
        continue;
      }
      placed.add(unit);
      map.plots.push(unit);
      map.lat.push(round6(at[0]));
      map.lon.push(round6(at[1]));
      map.status.push(geoStatus(unit, progress, input.decisions, input.differing, input.resubmitted));
      map.holder.push(groupOf(unit));
      map.names?.push(input.nameOf!(unit));
    }
    map.files.push({ id: file.id, filename: file.filename, plots, onMap });
  }
  // Plots no file listed gives a place.
  for (const unit of new Set(pending)) {
    if (!placed.has(unit)) map.notOnMap += 1;
  }
  // Names only when one differs from its plot id.
  if (map.names && map.names.every((name, i) => name === map.plots[i])) map.names = null;
  return map;
}

export interface GeoPage {
  /** [lat, lon, status, holder] per plot. */
  points: [number, number, number, number][];
  /** The plot (unit) of each point, for its page (GET /plots/:plot). */
  plots: string[];
  /** The id the collector sees of each point; null when it is the plot id. */
  names: string[] | null;
  /** The offset of the next page; null on the last. */
  next: number | null;
}

/** The plots from `offset` on, at most `size`. */
export function geoPage(map: GeoMap, offset: number, size = GEO_PAGE_SIZE): GeoPage {
  const end = Math.min(map.plots.length, offset + size);
  const points: [number, number, number, number][] = [];
  for (let i = offset; i < end; i++) points.push([map.lat[i], map.lon[i], map.status[i], map.holder[i]]);
  return { points, plots: map.plots.slice(offset, end), names: map.names?.slice(offset, end) ?? null, next: end < map.plots.length ? end : null };
}
