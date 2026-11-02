import { visibleId } from './plotShape.js';
import { splitKey, type KeyShape } from './rounds.js';

/**
 * Plot search (Task 8): the plots of a project's plot files by the id the coordinator sees,
 * from the files' parsed ids (plotFileCache), never from the records. An index is built once
 * per version of the files and kept (routes/plotSearch.ts); a search is two binary searches
 * and one pass over the plots whose id starts with what was typed.
 */

/** Most plots one search gives. */
export const MAX_SEARCH_RESULTS = 20;

export interface PlotIndexFile {
  id: string;
  filename: string;
  /** Its plot units, as plotIdsOf reads them (file order, repeats possible). */
  units: readonly string[];
}

export interface PlotIndex {
  files: { id: string; filename: string }[];
  /** Every unit once, in the order first met (files in order, then rows). */
  units: string[];
  /** The id the collector sees for each unit (visibleId: the keys hidden from the record list left out). */
  names: string[];
  /** What is searched, lower case, sorted: each unit, and its visible id when that is another text. */
  keys: string[];
  /** keys[i] belongs to units[keyUnit[i]]. */
  keyUnit: Uint32Array;
  /** The first file (index in `files`) holding each unit... */
  firstFile: Uint32Array;
  /** ...and the other files of the units in several, by unit index. */
  moreFiles: Map<number, number[]>;
  /** An own round (units with their round part): each plot's units, its rounds, in the order met. Null otherwise. */
  byPlot: Map<string, string[]> | null;
  /** The key shape `byPlot` was built with. */
  ownRound: KeyShape | null;
}

/**
 * The index of some plot files' units, searched by unit and by the id the collector sees.
 * `ownRound`: the key shape when the units carry their own round (each plot's rounds are then
 * kept together, for its page).
 */
export function buildPlotIndex(files: readonly PlotIndexFile[], hidden: readonly boolean[] | null, ownRound: KeyShape | null = null): PlotIndex {
  const units: string[] = [];
  const names: string[] = [];
  const firstFile: number[] = [];
  const moreFiles = new Map<number, number[]>();
  const indexOf = new Map<string, number>();
  files.forEach((file, f) => {
    for (const unit of file.units) {
      const known = indexOf.get(unit);
      if (known === undefined) {
        indexOf.set(unit, units.length);
        units.push(unit);
        names.push(visibleId(unit, hidden));
        firstFile.push(f);
      } else if (firstFile[known] !== f) {
        const more = moreFiles.get(known);
        if (!more) moreFiles.set(known, [f]);
        else if (!more.includes(f)) more.push(f);
      }
    }
  });
  const rawKeys: string[] = [];
  const rawUnit: number[] = [];
  for (let u = 0; u < units.length; u++) {
    const own = units[u].toLowerCase();
    rawKeys.push(own);
    rawUnit.push(u);
    const name = names[u].toLowerCase();
    if (name !== own) {
      rawKeys.push(name);
      rawUnit.push(u);
    }
  }
  const order = rawKeys.map((_, i) => i).sort((a, b) => (rawKeys[a] < rawKeys[b] ? -1 : rawKeys[a] > rawKeys[b] ? 1 : rawUnit[a] - rawUnit[b]));
  let byPlot: Map<string, string[]> | null = null;
  if (ownRound !== null && ownRound.roundIndex !== null) {
    byPlot = new Map();
    for (const unit of units) {
      const plot = splitKey(unit, ownRound.count, ownRound.roundIndex).plot;
      const list = byPlot.get(plot);
      if (list) list.push(unit);
      else byPlot.set(plot, [unit]);
    }
  }
  return {
    byPlot,
    ownRound: byPlot === null ? null : ownRound,
    files: files.map((f) => ({ id: f.id, filename: f.filename })),
    units,
    names,
    keys: order.map((i) => rawKeys[i]),
    keyUnit: Uint32Array.from(order.map((i) => rawUnit[i])),
    firstFile: Uint32Array.from(firstFile),
    moreFiles,
  };
}

/** The first key not before `text`. */
function lowerBound(keys: readonly string[], text: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < text) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface PlotMatch {
  /** The plot unit, as the quality figures, the decisions and the review queue name it. */
  plot: string;
  /** The id the collector sees. */
  name: string;
  /** The plot files holding it, in the files' order. */
  files: { id: string; filename: string }[];
}

/** The files of a unit (by its index). */
export function filesOfUnit(index: PlotIndex, u: number): { id: string; filename: string }[] {
  return [index.firstFile[u], ...(index.moreFiles.get(u) ?? [])].sort((a, b) => a - b).map((f) => index.files[f]);
}

/** The units of a unit's plot: its other rounds too for an own round, else the unit alone. */
export function unitsOfPlot(index: PlotIndex, unit: string): string[] {
  if (index.byPlot === null || index.ownRound === null) return [unit];
  const list = index.byPlot.get(splitKey(unit, index.ownRound.count, index.ownRound.roundIndex).plot);
  return list && list.includes(unit) ? list : [unit];
}

/** The index of a unit (exactly as written), or -1. */
export function unitIndex(index: PlotIndex, plot: string): number {
  const key = plot.toLowerCase();
  for (let i = lowerBound(index.keys, key); i < index.keys.length && index.keys[i] === key; i++) {
    if (index.units[index.keyUnit[i]] === plot) return index.keyUnit[i];
  }
  return -1;
}

/**
 * The plots whose unit or visible id starts with `query` (case ignored, spaces around it
 * trimmed): the shortest ids first, then in text order ("1", "10" ... "19", "100"), each
 * plot once, at most `limit`. `more`: other plots match too (the person types more).
 */
export function searchPlots(index: PlotIndex, query: string, limit = MAX_SEARCH_RESULTS): { plots: PlotMatch[]; more: boolean } {
  const q = query.trim().toLowerCase();
  if (q === '') return { plots: [], more: false };
  const from = lowerBound(index.keys, q);
  // The best `limit` (key, unit) pairs, best first, each unit once.
  const best: { key: string; unit: number }[] = [];
  const better = (a: string, b: string) => a.length < b.length || (a.length === b.length && a < b);
  let matching = 0;
  for (let i = from; i < index.keys.length && index.keys[i].startsWith(q); i++) {
    const key = index.keys[i];
    const unit = index.keyUnit[i];
    // A plot matching by its unit and by its visible id is taken once, by the better of the two.
    const own = index.units[unit].toLowerCase();
    const name = index.names[unit].toLowerCase();
    const other = key === own ? name : own;
    if (other !== key && other.startsWith(q) && better(other, key)) continue;
    matching += 1;
    if (best.length === limit && !better(key, best[limit - 1].key)) continue;
    insert(best, { key, unit }, better, limit);
  }
  return {
    plots: best.map(({ unit }) => ({ plot: index.units[unit], name: index.names[unit], files: filesOfUnit(index, unit) })),
    more: matching > best.length,
  };
}

function insert(best: { key: string; unit: number }[], item: { key: string; unit: number }, better: (a: string, b: string) => boolean, limit: number): void {
  let at = best.length;
  while (at > 0 && better(item.key, best[at - 1].key)) at--;
  best.splice(at, 0, item);
  if (best.length > limit) best.pop();
}
