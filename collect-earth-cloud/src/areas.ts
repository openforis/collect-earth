// Strata and areas (docs/plans/2026-11-11-strata-areas.md, step 2): the area each plot stands for, set on the dashboard.
// A project's setting is either strata (the plot-file columns whose values make a stratum, each stratum's area in
// hectares) or one total area. Without one, the project file's areas file is read as before (analysis.ts), then the
// Uncertainty page's total area. The expansion factor of a plot is its stratum's area divided by the stratum's plots
// with a submitted first assessment, as Collect Earth's RegionCalculationUtils works it out.
import { areaOf, csvSeparatorOf, parseCsv, type Factors } from './analysis.js';

export interface StrataAreas {
  /** The columns whose values make a stratum: questions of the survey or columns of the plot files. */
  columns: string[];
  strata: { values: string[]; area: number }[];
}

export type AreaSettings = ({ mode: 'strata' } & StrataAreas) | { mode: 'total'; area: number };

/** What a setting may hold. */
export const AREA_LIMITS = { columns: 5, strata: 20_000, valueChars: 500, area: 1e12 };

/** A value as an areas file compares it: trimmed; numbers and booleans as Collect's database compares them. */
export function comparable(v: string | undefined): string {
  if (v === undefined) return '';
  const t = v.trim();
  if (t === 'true' || t === 'false') return t;
  if (t !== '' && Number.isFinite(Number(t))) return String(Number(t));
  return t;
}

/**
 * An areas_per_attribute.csv read: the columns (a last `weight` column left out, as Collect Earth does) and the lines;
 * `unreadable`: the lines whose area is not a number. Null when it has no column and area.
 */
export function strataOfFile(text: string): { areas: StrataAreas; unreadable: number } | null {
  const separator = csvSeparatorOf(text);
  const [header, ...lines] = parseCsv(text);
  if (!header || header.length < 2) return null;
  const hasWeight = header.length > 2 && header[header.length - 1].toLowerCase() === 'weight';
  const columns = header.slice(0, hasWeight ? -2 : -1);
  const strata: StrataAreas['strata'] = [];
  let unreadable = 0;
  for (const line of lines) {
    const area = areaOf(line[columns.length], separator);
    if (!Number.isFinite(area) || area < 0) unreadable++;
    else strata.push({ values: columns.map((_, i) => line[i] ?? ''), area });
  }
  return { areas: { columns, strata }, unreadable };
}

/** The strata as Collect Earth's areas_per_attribute.csv: the columns, then `area`. */
export function areasFileText(areas: StrataAreas): string {
  const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [[...areas.columns, 'area'], ...areas.strata.map((s) => [...s.values, String(s.area)])].map((l) => l.map(field).join(',')).join('\n') + '\n';
}

/** The setting a coordinator sends, checked, or what is wrong with it in words. */
export function parseAreaSettings(raw: unknown): AreaSettings | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'The areas must be an object.';
  const b = raw as Record<string, unknown>;
  const isArea = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= AREA_LIMITS.area;
  if (b.mode === 'total') return isArea(b.area) && b.area > 0 ? { mode: 'total', area: b.area } : 'The total area is a number of hectares above 0.';
  if (b.mode !== 'strata') return "mode is 'strata' or 'total'.";
  const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length <= max;
  if (!Array.isArray(b.columns) || b.columns.length === 0 || b.columns.length > AREA_LIMITS.columns || !b.columns.every((c) => text(c, 200) && (c as string).trim() !== '')) {
    return `Choose 1 to ${AREA_LIMITS.columns} columns that make the strata.`;
  }
  const columns = (b.columns as string[]).map((c) => c.trim());
  if (new Set(columns.map((c) => c.toLowerCase())).size !== columns.length) return 'A column is chosen twice.';
  if (!Array.isArray(b.strata) || b.strata.length > AREA_LIMITS.strata) return `The strata are a list of at most ${AREA_LIMITS.strata.toLocaleString('en')}.`;
  const strata: StrataAreas['strata'] = [];
  const seen = new Set<string>();
  for (const s of b.strata as unknown[]) {
    const line = (s ?? {}) as Record<string, unknown>;
    if (!Array.isArray(line.values) || line.values.length !== columns.length || !line.values.every((v) => text(v, AREA_LIMITS.valueChars))) {
      return `Each stratum has one value per column (${columns.join(', ')}).`;
    }
    if (!isArea(line.area)) return 'Each stratum has an area: a number of hectares, 0 or more.';
    const values = (line.values as string[]).map((v) => v.trim());
    const key = values.map(comparable).join('\u0000');
    if (seen.has(key)) return `The stratum ${values.join(' / ')} is there twice.`;
    seen.add(key);
    strata.push({ values, area: line.area });
  }
  return { mode: 'strata', columns, strata };
}

/**
 * The factors of the plots over strata. `plots`: each plot's values of the strata's columns (undefined: it has none),
 * by plot. A stratum's area is divided among its plots; a plot of no stratum stands for no area.
 */
export function strataFactors(
  areas: StrataAreas,
  plots: ReadonlyMap<string, readonly (string | undefined)[]>,
  report: { source: Factors['source']; unknownColumns: string[]; unmatched?: number },
): Factors {
  const byStratum = new Map<string, string[]>();
  for (const [plot, values] of plots) {
    const key = values.map(comparable).join('\u0000');
    const list = byStratum.get(key);
    if (list) list.push(plot);
    else byStratum.set(key, [plot]);
  }
  const byPlot: Factors['byPlot'] = new Map();
  let unmatched = report.unmatched ?? 0;
  for (const s of areas.strata) {
    const matching = byStratum.get(s.values.map(comparable).join('\u0000')) ?? [];
    if (matching.length === 0) { unmatched++; continue; }
    const stratum = s.values.join(' / ');
    for (const p of matching) byPlot.set(p, { factor: s.area / matching.length, weight: 1, stratum });
  }
  withWeights(byPlot);
  const outside = new Map<string, number>();
  for (const [p, values] of plots) {
    if (byPlot.has(p)) continue;
    const label = values.map((v) => v ?? '').join(' / ');
    outside.set(label, (outside.get(label) ?? 0) + 1);
  }
  const examples = [...outside].map(([stratum, n]) => ({ stratum, plots: n })).sort((a, b) => b.plots - a.plots || a.stratum.localeCompare(b.stratum)).slice(0, 5);
  return { source: report.source, byPlot, unmatched, unknownColumns: report.unknownColumns, noStratum: { plots: plots.size - byPlot.size, examples } };
}

/** One total area: every plot with a first assessment stands for the same share of it. */
export function totalFactors(area: number, plots: Iterable<string>): Factors {
  const units = [...plots];
  const byPlot: Factors['byPlot'] = new Map(units.map((p) => [p, { factor: area / units.length, weight: 1, stratum: '' }]));
  withWeights(byPlot);
  return { source: 'total', byPlot, unmatched: 0, unknownColumns: [], noStratum: { plots: 0, examples: [] } };
}

/** The weight: the factor divided by the smallest one above 0 (RegionCalculationUtils.recalculatePlotWeights). */
export function withWeights(byPlot: Factors['byPlot']): void {
  const positive = [...byPlot.values()].map((f) => f.factor).filter((f) => f > 0);
  const min = positive.length > 0 ? Math.min(...positive) : 0;
  for (const f of byPlot.values()) f.weight = min > 0 ? f.factor / min : 0;
}
