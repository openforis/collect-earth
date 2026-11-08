// Trial S8: the data the views are run on. The demo survey's model (src/analysis.ts) and records with answers that
// hang together as a real project's do (a subdivision under its category, a year of change only when there was a
// change, degradation years only for degraded plots…), so that a view with a missing or wrong filter gives other figures
// than the right one. Loaded into DuckDB as the dashboard loads it: the server's own CSV and column types.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { analysisModel, analysisTables, type AnalysisModel, type AnalysisRecord } from '../../src/analysis.ts';
import { readCep } from '../../src/cep.ts';
import { realDemoCep } from '../../test/fixtures/cep.ts';

/** A seeded random number generator: the same data at every run. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export const PROVINCES = ['Niassa', 'Cabo Delgado', 'Nampula', 'Zambezia', 'Tete'];
export const COLLECTORS = ['ana', 'bruno', 'chloe', 'dawit'];
const AREA_PER_PROVINCE: Record<string, number> = { Niassa: 129000, 'Cabo Delgado': 82000, Nampula: 81000, Zambezia: 105000, Tete: 100000 };

export function demoModel(): AnalysisModel {
  const f = readCep(realDemoCep());
  return analysisModel(new TextDecoder().decode(f.entries.get(f.surveyPath)!));
}

export interface TrialData {
  model: AnalysisModel;
  records: AnalysisRecord[];
  factors: Map<string, { factor: number; weight: number }>;
}

/** `n` plots, first assessments, plus a check of every tenth by another collector. */
export function trialData(n = 800, seed = 8): TrialData {
  const model = demoModel();
  const rnd = random(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const chance = (p: number) => rnd() < p;
  const plot = model.tables.find((t) => t.name === 'plot')!;
  const key = (name: string) => plot.columns.find((c) => c.name === name)!.key;
  const lu = model.lists.land_uses;
  const top = lu.filter((i) => i.level === 0).map((i) => i.code);
  const children = (code: string) => lu.filter((i) => i.parent === code).map((i) => i.code);
  const codes = (list: string) => (model.lists[list] ?? []).filter((i) => i.level === 0).map((i) => i.code);
  const years = codes('years');
  // A plausible mix of land uses: forest and cropland most, wetland and other land least
  const weights: Record<string, number> = { F: 0.34, C: 0.24, G: 0.2, S: 0.08, W: 0.06, O: 0.08 };
  const landUse = () => {
    let r = rnd();
    for (const c of top) {
      r -= weights[c] ?? 0.05;
      if (r <= 0) return c;
    }
    return top[0];
  };

  const records: AnalysisRecord[] = [];
  const factors = new Map<string, { factor: number; weight: number }>();
  const byProvince = new Map<string, string[]>();
  const start = Date.UTC(2026, 7, 3); // a Monday: the weeks start clean
  for (let i = 1; i <= n; i++) {
    const id = String(i);
    const province = pick(PROVINCES);
    byProvince.set(province, [...(byProvince.get(province) ?? []), id]);
    const cat = landUse();
    const sub = children(cat).length && chance(0.8) ? pick(children(cat)) : cat;
    const changed = chance(0.25);
    const previous = changed ? pick(top.filter((c) => c !== cat)) : cat;
    // elevation: never exactly 1,000 m, so "above 1,000" and "1,000 or more" agree
    let elevation = Math.round(50 + rnd() * 1900);
    if (elevation === 1000) elevation = 1001;
    const dynamics = cat === 'F' ? (chance(0.6) ? 'none' : chance(0.6) ? 'degradation' : 'reforestation') : '';
    const summary: Record<string, string> = {
      [key('id')]: id,
      [key('province')]: province,
      [key('elevation')]: String(elevation),
      [key('climate')]: pick(codes('climate_zones').slice(0, 6)),
      [key('land_use_category')]: cat,
      [key('land_use_subdivision')]: sub,
      [key('land_use_category_has_changed')]: String(changed),
      [key('land_use_initial_subdivision')]: previous,
      [key('land_use_assessment_confidence')]: String(chance(0.85)),
      [key('calculated_slope')]: pick(codes('slope_classes').slice(0, 4)),
      [key('calculated_elevation_range')]: String(Math.min(Math.floor((elevation - 1) / 100) + 1, 30)),
      [key('second_lu_change')]: String(changed && chance(0.3)),
      [key('forest_percentage')]: String(cat === 'F' ? 40 + Math.floor(rnd() * 60) : Math.floor(rnd() * 30)),
    };
    if (changed) summary[key('land_use_subcategory_year_of_change')] = pick(years);
    if (dynamics) summary[key('forest_dynamics')] = dynamics;
    if (dynamics === 'degradation') summary[key('degradation_year')] = pick(years);
    if (cat === 'F' && dynamics === 'degradation' && chance(0.7)) summary[key('deforestation_driver')] = pick(codes('drivers'));
    else if (changed && previous === 'F') summary[key('deforestation_driver')] = pick(codes('drivers'));
    const operator = pick(COLLECTORS);
    const day = start + Math.floor(rnd() * 120) * 86_400_000;
    records.push({ recordKey: `${id},1`, operator, plot: id, round: '1', assessment: 'main', submitted: chance(0.92), modifiedOn: day, summary });
    if (i % 10 === 0) {
      // A check by another collector: another record of the same plot, round 2
      const checker = pick(COLLECTORS.filter((c) => c !== operator));
      records.push({ recordKey: `${id},2`, operator: checker, plot: id, round: '2', assessment: 'check', submitted: true, modifiedOn: day + 3 * 86_400_000, summary: { ...summary } });
    }
  }
  // The area each plot stands for: the province's area shared among its plots (region_areas.csv's rule)
  const smallest = Math.min(...[...byProvince].map(([p, ids]) => AREA_PER_PROVINCE[p] / ids.length));
  for (const [p, ids] of byProvince) for (const id of ids) factors.set(id, { factor: AREA_PER_PROVINCE[p] / ids.length, weight: AREA_PER_PROVINCE[p] / ids.length / smallest });
  return { model, records, factors };
}

/** DuckDB with the trial's tables, as the dashboard has them (the plot table is `plot`, columns by their names). */
export async function trialDatabase(data: TrialData): Promise<DuckDBConnection> {
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  for (const t of analysisTables(data.model, data.records, data.factors)) {
    if (t.name.startsWith('_')) continue;
    const types = t.columns.map(([n, ty]) => `'${n.replace(/'/g, "''")}': '${ty}'`).join(', ');
    const file = join(tmpdir(), `s8-${process.pid}-${t.name}.csv`);
    await writeFile(file, t.csv);
    await conn.run(`CREATE TABLE "${t.name}" AS SELECT * FROM read_csv('${file}', header = true, auto_detect = false, delim = ',', quote = '"', escape = '"', columns = {${types}})`);
    await rm(file);
  }
  return conn;
}
