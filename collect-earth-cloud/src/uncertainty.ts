// The uncertainty of the land areas, as the IPCC asks (2006 IPCC Guidelines, Vol. 4, Ch. 3, eq. 3.33, pp. 3.33–3.34):
// what replaces the coordinator's spreadsheet of plot counts, change matrices and standard errors. Pure: the route
// (src/routes/uncertainty.ts) gives each plot's two answers and the stratum it stands in, this works out the tables.
//
// The estimator is the stratified one: per stratum h of area A_h with n_h plots, a share p_hi of them in class i,
//   A_i = Σ_h A_h·p_hi,   Var(A_i) = Σ_h A_h²·p_hi(1−p_hi)/(n_h−1),   SE = √Var,   CI = 1.96·SE (95%).
// With one stratum (every plot standing for the same area) it is the spreadsheet's: A_i = p_i·A, SE = A·√(p_i(1−p_i)/(n−1)).
// A plot whose code is left out (no data: clouds, no imagery) stays in its stratum's n_h and stands for its share as "no
// data", in no category: each year's categories and no data add up to the total (docs/plans/2026-11-11-strata-areas.md).

import type { Estimate, ForestRow, IpccCategory, UncertaintyResult, UncertaintySettings } from './wire/analysis.js';

export type { Estimate, ForestRow, IpccCategory, UncertaintyResult, UncertaintySettings } from './wire/analysis.js';

export const IPCC_CATEGORIES = ['forest', 'cropland', 'grassland', 'wetland', 'settlement', 'other'] as const satisfies readonly IpccCategory[];
const Z95 = 1.96;

/** A plot's two categories; null: its code is left out (no data). */
type Pair = { from: IpccCategory | null; to: IpccCategory | null };

export interface UncertaintyPlot {
  /** The codes answered ("" when not answered). */
  initial: string;
  final: string;
  /** The stratum it stands in, or null when it stands for no area (no data, or in no line of the areas file). */
  stratum: string | null;
}

export const FOREST_ROWS: ForestRow[] = ['forestStable', 'nonForestToForest', 'forestToNonForest', 'nonForestStable', 'initiallyForest', 'initiallyNonForest', 'currentlyForest', 'currentlyNonForest'];

/** The tables of the uncertainty analysis. `strata`: the area in hectares of each stratum. */
export function uncertainty(plots: readonly UncertaintyPlot[], strata: ReadonlyMap<string, number>, settings: Pick<UncertaintySettings, 'codes'> & { initialList: string; finalList: string }): UncertaintyResult {
  const initialMap = settings.codes[settings.initialList] ?? {};
  const finalMap = settings.codes[settings.finalList] ?? {};
  const skipped = { missing: 0, unmapped: 0, noArea: 0 };
  const unmappedCount = new Map<string, { which: 'initial' | 'final'; code: string; plots: number }>();
  const noteUnmapped = (which: 'initial' | 'final', code: string) => {
    const k = `${which}\u0000${code}`;
    const u = unmappedCount.get(k) ?? { which, code, plots: 0 };
    u.plots++;
    unmappedCount.set(k, u);
  };
  // The plots used, by stratum: their two categories (null: left out, no data)
  const used = new Map<string, Pair[]>();
  for (const p of plots) {
    if (p.initial === '' || p.final === '') { skipped.missing++; continue; }
    const from = initialMap[p.initial];
    const to = finalMap[p.final];
    if (from === undefined || to === undefined) {
      if (from === undefined) noteUnmapped('initial', p.initial);
      if (to === undefined) noteUnmapped('final', p.final);
      skipped.unmapped++;
      continue;
    }
    if (p.stratum === null || !((strata.get(p.stratum) ?? 0) > 0)) { skipped.noArea++; continue; }
    let list = used.get(p.stratum);
    if (!list) used.set(p.stratum, (list = []));
    list.push({ from, to });
  }

  const strataOut = [...strata].filter(([, area]) => area > 0).map(([key, area]) => ({ key, area, plots: used.get(key)?.length ?? 0 }));
  const counted = strataOut.filter((s) => s.plots > 0);
  const totalArea = counted.reduce((sum, s) => sum + s.area, 0);
  const n = counted.reduce((sum, s) => sum + s.plots, 0);

  const estimate = (pred: (t: Pair) => boolean): Estimate => {
    let plotsIn = 0;
    let area = 0;
    let variance = 0;
    for (const s of counted) {
      const nh = s.plots;
      const nhi = used.get(s.key)!.filter(pred).length;
      const p = nhi / nh;
      plotsIn += nhi;
      area += s.area * p;
      if (nh > 1) variance += (s.area * s.area * p * (1 - p)) / (nh - 1);
    }
    const se = Math.sqrt(variance);
    const ci = Z95 * se;
    return { plots: plotsIn, proportion: totalArea > 0 ? area / totalArea : 0, area, se, ci, uncertainty: area > 0 ? (ci / area) * 100 : null };
  };

  // A year left out (no data) is neither forest nor non-forest
  const forest = (c: IpccCategory | null) => c === 'forest';
  const nonForest = (c: IpccCategory | null) => c !== null && c !== 'forest';
  const forestPred: Record<ForestRow, (t: Pair) => boolean> = {
    forestStable: (t) => forest(t.from) && forest(t.to),
    nonForestToForest: (t) => nonForest(t.from) && forest(t.to),
    forestToNonForest: (t) => forest(t.from) && nonForest(t.to),
    nonForestStable: (t) => nonForest(t.from) && nonForest(t.to),
    initiallyForest: (t) => forest(t.from),
    initiallyNonForest: (t) => nonForest(t.from),
    currentlyForest: (t) => forest(t.to),
    currentlyNonForest: (t) => nonForest(t.to),
  };
  const transitions = IPCC_CATEGORIES.flatMap((from) => IPCC_CATEGORIES.map((to) => ({ from, to, estimate: estimate((t) => t.from === from && t.to === to) })));
  const cells = IPCC_CATEGORIES.map((_, i) => IPCC_CATEGORIES.map((_, j) => transitions[i * IPCC_CATEGORIES.length + j].estimate.area));
  const rowTotals = cells.map((row) => row.reduce((a, b) => a + b, 0));
  const columnTotals = IPCC_CATEGORIES.map((_, j) => cells.reduce((sum, row) => sum + row[j], 0));
  return {
    estimator: counted.length > 1 ? 'stratified' : 'simple',
    totalArea,
    plots: n,
    strata: strataOut,
    notEstimable: strataOut.filter((s) => s.plots < 2),
    skipped,
    noData: { initial: estimate((t) => t.from === null), final: estimate((t) => t.to === null) },
    unmapped: [...unmappedCount.values()].sort((a, b) => a.which.localeCompare(b.which) || b.plots - a.plots || a.code.localeCompare(b.code)),
    categories: IPCC_CATEGORIES.map((category) => ({ category, initial: estimate((t) => t.from === category), final: estimate((t) => t.to === category) })),
    total: estimate(() => true),
    forest: FOREST_ROWS.map((row) => ({ row, estimate: estimate(forestPred[row]) })),
    transitions,
    matrix: { cells, rowTotals, columnTotals, total: rowTotals.reduce((a, b) => a + b, 0), rowPercent: cells.map((row, i) => row.map((v) => (rowTotals[i] > 0 ? (v / rowTotals[i]) * 100 : null))) },
  };
}

/**
 * The stratified estimate of the total of a plot variable y over the area (each stratum h of area A_h, its n_h plots'
 * values y): T = Σ_h A_h·ȳ_h, Var(T) = Σ_h A_h²·s_h²/n_h, s_h² = Σ(y − ȳ_h)²/(n_h − 1). For y in {0, 1} (a plot in
 * a class or not) it is the estimate of uncertainty() above: A_h²·p(1 − p)/(n_h − 1). A stratum of fewer than 2 plots
 * adds its area but no variance; one of none adds nothing. y can be negative (a net change: +1 gained, −1 lost).
 */
export function stratifiedTotal(strata: readonly { area: number; values: readonly number[] }[]): { total: number; se: number; ci: number } {
  let total = 0;
  let variance = 0;
  for (const { area, values } of strata) {
    const n = values.length;
    if (n === 0) continue;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    total += area * mean;
    if (n > 1) variance += (area * area * (values.reduce((sum, y) => sum + (y - mean) * (y - mean), 0) / (n - 1))) / n;
  }
  const se = Math.sqrt(variance);
  return { total, se, ci: Z95 * se };
}

/** The settings sent by a coordinator, checked, or a message saying what is wrong. `codeColumns`: the plot table's code columns and their lists. */
export function parseSettings(body: unknown, codeColumns: ReadonlyMap<string, string>, lists: Readonly<Record<string, readonly { code: string }[]>>): UncertaintySettings | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'The settings must be an object.';
  const b = body as Record<string, unknown>;
  const initial = typeof b.initial === 'string' ? b.initial : '';
  const final = typeof b.final === 'string' ? b.final : '';
  if (!codeColumns.has(initial) || !codeColumns.has(final)) return 'Choose two questions of the survey answered with a code list.';
  const year = (v: unknown) => (typeof v === 'string' && v.trim().length <= 20 ? v.trim() : null);
  const initialYear = year(b.initialYear);
  const finalYear = year(b.finalYear);
  if (initialYear === null || finalYear === null) return 'The years are labels of at most 20 characters.';
  let totalArea: number | null = null;
  if (b.totalArea !== null && b.totalArea !== undefined) {
    if (typeof b.totalArea !== 'number' || !Number.isFinite(b.totalArea) || b.totalArea <= 0 || b.totalArea > 1e12) return 'The total area is a number of hectares above 0.';
    totalArea = b.totalArea;
  }
  const rawCodes = b.codes;
  if (!rawCodes || typeof rawCodes !== 'object' || Array.isArray(rawCodes)) return 'Map the codes to IPCC categories.';
  const wanted = new Set([codeColumns.get(initial)!, codeColumns.get(final)!]);
  const codes: UncertaintySettings['codes'] = {};
  for (const list of wanted) {
    const given = (rawCodes as Record<string, unknown>)[list];
    if (given === undefined) continue;
    if (!given || typeof given !== 'object' || Array.isArray(given)) return `The codes of ${list} must be an object.`;
    const known = new Set((lists[list] ?? []).map((i) => i.code));
    const out: Record<string, IpccCategory | null> = {};
    for (const [code, cat] of Object.entries(given as Record<string, unknown>)) {
      if (!known.has(code)) return `${code} is not a code of ${list}.`;
      if (cat !== null && !IPCC_CATEGORIES.includes(cat as IpccCategory)) return `${code}: an IPCC category (${IPCC_CATEGORIES.join(', ')}) or null to leave it out.`;
      out[code] = cat as IpccCategory | null;
    }
    codes[list] = out;
  }
  return { initial, final, initialYear, finalYear, codes, totalArea };
}
