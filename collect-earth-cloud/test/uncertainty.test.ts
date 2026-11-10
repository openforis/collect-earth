import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCep, zipCep } from '../src/cep.js';
import { IPCC_CATEGORIES, uncertainty, type IpccCategory, type UncertaintyPlot } from '../src/uncertainty.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { demoCep, FIXTURE_DATE } from './fixtures/cep.js';

const MAP: Record<string, IpccCategory | null> = { F: 'forest', C: 'cropland', G: 'grassland', W: 'wetland', S: 'settlement', O: 'other', X: null };
const settings = { codes: { lu: MAP }, initialList: 'lu', finalList: 'lu' };
const plotsOf = (spec: string, stratum: string | null = '') =>
  spec.split(' ').map((pair): UncertaintyPlot => ({ initial: pair[0] === '_' ? '' : pair[0], final: pair[1] === '_' ? '' : pair[1], stratum }));
const by = (r: ReturnType<typeof uncertainty>, c: IpccCategory) => r.categories.find((x) => x.category === c)!;
const transition = (r: ReturnType<typeof uncertainty>, from: IpccCategory, to: IpccCategory) => r.transitions.find((t) => t.from === from && t.to === to)!.estimate;
const forest = (r: ReturnType<typeof uncertainty>, row: string) => r.forest.find((f) => f.row === row)!.estimate;

describe('the uncertainty, every plot standing for the same area (the spreadsheet\'s formula)', () => {
  // 10 plots of 1000 ha: initially 6 F, 2 C, 2 G; finally 5 F, 3 C, 2 G (one forest became cropland)
  const r = uncertainty(plotsOf('FF FF FF FF FF FC CC CC GG GG'), new Map([['', 1000]]), settings);

  it('is the simple estimator over the plots', () => {
    expect(r.estimator).toBe('simple');
    expect(r.plots).toBe(10);
    expect(r.totalArea).toBe(1000);
  });

  it('gives A_i = p_i·A, SE = A·√(p_i(1−p_i)/(n−1)), CI = 1.96·SE, uncertainty = CI/A_i', () => {
    // Forest, initial: p = 0.6, A = 600, SE = 1000·√(0.24/9) = 163.299, CI = 320.067, 53.344 %
    expect(by(r, 'forest').initial).toMatchObject({ plots: 6, proportion: 0.6 });
    expect(by(r, 'forest').initial.area).toBeCloseTo(600, 9);
    expect(by(r, 'forest').initial.se).toBeCloseTo(163.2993, 3);
    expect(by(r, 'forest').initial.ci).toBeCloseTo(320.0667, 3);
    expect(by(r, 'forest').initial.uncertainty).toBeCloseTo(53.3444, 3);
    // Cropland, initial: p = 0.2, A = 200, SE = 133.333, CI = 261.333, 130.667 %
    expect(by(r, 'cropland').initial.se).toBeCloseTo(133.3333, 3);
    expect(by(r, 'cropland').initial.uncertainty).toBeCloseTo(130.6667, 3);
    // Forest, final: p = 0.5, A = 500, SE = 166.667, CI = 326.667, 65.333 %
    expect(by(r, 'forest').final.area).toBeCloseTo(500, 9);
    expect(by(r, 'forest').final.se).toBeCloseTo(166.6667, 3);
    expect(by(r, 'forest').final.uncertainty).toBeCloseTo(65.3333, 3);
    // Forest → cropland: p = 0.1, A = 100, SE = 100, CI = 196, 196 %
    expect(transition(r, 'forest', 'cropland')).toMatchObject({ plots: 1 });
    expect(transition(r, 'forest', 'cropland').se).toBeCloseTo(100, 9);
    expect(transition(r, 'forest', 'cropland').uncertainty).toBeCloseTo(196, 9);
    // the same formula for every row, as the spreadsheet's columns W–AB
    for (const c of r.categories) for (const e of [c.initial, c.final]) {
      const p = e.plots / 10;
      expect(e.se).toBeCloseTo(1000 * Math.sqrt((p * (1 - p)) / 9), 9);
      expect(e.ci).toBeCloseTo(1.96 * e.se, 9);
    }
  });

  it('shows a category with no plots as 0, with no uncertainty (no #DIV/0!)', () => {
    expect(by(r, 'wetland').initial).toEqual({ plots: 0, proportion: 0, area: 0, se: 0, ci: 0, uncertainty: null });
  });

  it('adds up: the forest / non-forest rows, the matrix\'s totals and its row percentages', () => {
    const area = (row: string) => forest(r, row).area;
    expect(area('forestStable')).toBeCloseTo(500, 9);
    expect(area('forestToNonForest')).toBeCloseTo(100, 9);
    expect(area('nonForestToForest')).toBe(0);
    expect(area('nonForestStable')).toBeCloseTo(400, 9);
    expect(area('forestStable') + area('forestToNonForest')).toBeCloseTo(area('initiallyForest'), 9);
    expect(area('forestStable') + area('nonForestToForest')).toBeCloseTo(area('currentlyForest'), 9);
    expect(area('nonForestStable') + area('nonForestToForest')).toBeCloseTo(area('initiallyNonForest'), 9);
    expect(area('initiallyForest') + area('initiallyNonForest')).toBeCloseTo(1000, 9);
    expect(r.forest.slice(0, 4).reduce((s, f) => s + f.estimate.plots, 0)).toBe(10);
    expect(r.transitions).toHaveLength(36);
    const m = r.matrix;
    expect(m.total).toBe(1000);
    IPCC_CATEGORIES.forEach((c, i) => {
      expect(m.rowTotals[i]).toBeCloseTo(by(r, c).initial.area, 9);
      expect(m.columnTotals[i]).toBeCloseTo(by(r, c).final.area, 9);
      const percent = m.rowPercent[i];
      if (m.rowTotals[i] > 0) expect(percent.reduce((s, v) => s! + v!, 0)).toBeCloseTo(100, 9);
      else expect(percent.every((v) => v === null)).toBe(true);
    });
    expect(m.rowPercent[0][1]).toBeCloseTo(100 / 6, 9); // forest → cropland, of the initial forest
  });
});

describe('the uncertainty over strata (the areas file)', () => {
  // North, 1000 ha: F F F C; south, 300 ha: F G G (no change)
  const r = uncertainty([...plotsOf('FF FF FF CC', 'north'), ...plotsOf('FF GG GG', 'south')], new Map([['north', 1000], ['south', 300]]), settings);

  it('weighs each stratum by its area: A_i = Σ A_h·p_hi, Var = Σ A_h²·p_hi(1−p_hi)/(n_h−1)', () => {
    expect(r.estimator).toBe('stratified');
    expect(r.totalArea).toBe(1300);
    const f = by(r, 'forest').initial;
    // 1000·3/4 + 300·1/3 = 850; Var = 1000²·(3/16)/3 + 300²·(2/9)/2 = 62 500 + 10 000 = 72 500
    expect(f.area).toBeCloseTo(850, 9);
    expect(f.proportion).toBeCloseTo(850 / 1300, 9);
    expect(f.se).toBeCloseTo(Math.sqrt(72_500), 9); // 269.258
    expect(f.ci).toBeCloseTo(527.7462, 3);
    expect(f.uncertainty).toBeCloseTo(62.0878, 3);
    // grassland: south only, 300·2/3 = 200, Var = 300²·(2/9)/2 = 10 000, SE = 100, 98 %
    expect(by(r, 'grassland').final.area).toBeCloseTo(200, 9);
    expect(by(r, 'grassland').final.se).toBeCloseTo(100, 9);
    expect(by(r, 'grassland').final.uncertainty).toBeCloseTo(98, 9);
    // cropland: north only, 250, SE = 1000·√(3/16/3) = 250, 196 %
    expect(by(r, 'cropland').initial.se).toBeCloseTo(250, 9);
    expect(r.strata).toEqual([{ key: 'north', area: 1000, plots: 4 }, { key: 'south', area: 300, plots: 3 }]);
    expect(r.notEstimable).toEqual([]);
  });
});

describe('the uncertainty, with what cannot be used', () => {
  const plots = [
    ...plotsOf('FF FC CC', 'a'),
    ...plotsOf('FF', 'one'), // a stratum of one plot: its area counts, its variance cannot be worked out
    ...plotsOf('F_', 'empty'), // no final answer: the stratum has no plot used
    ...plotsOf('ZF FZ', 'a'), // Z: a code not mapped
    ...plotsOf('XF', 'a'), // X: left out on purpose
    ...plotsOf('GG', null), // no area (no data, or in no line of the areas file)
  ];
  const r = uncertainty(plots, new Map([['a', 900], ['one', 50], ['empty', 70]]), settings);

  it('counts the plots left out by why, and lists the unmapped codes', () => {
    expect(r.plots).toBe(4);
    expect(r.skipped).toEqual({ missing: 1, unmapped: 2, leftOut: 1, noArea: 1 });
    expect(r.unmapped).toEqual([{ which: 'final', code: 'Z', plots: 1 }, { which: 'initial', code: 'Z', plots: 1 }]);
  });

  it('lists the strata with fewer than two plots and does not crash on them', () => {
    expect(r.notEstimable).toEqual([{ key: 'one', area: 50, plots: 1 }, { key: 'empty', area: 70, plots: 0 }]);
    expect(r.totalArea).toBe(950); // the empty stratum's area cannot be divided among its plots
    const f = by(r, 'forest').initial;
    expect(f.area).toBeCloseTo(900 * (2 / 3) + 50, 9);
    // the variance is stratum a's alone: 900²·(2/9)/2
    expect(f.se).toBeCloseTo(Math.sqrt((900 * 900 * (2 / 9)) / 2), 9);
    expect(Number.isFinite(by(r, 'cropland').final.uncertainty!)).toBe(true);
  });

  it('gives zeros, not NaN, with no plot at all', () => {
    const none = uncertainty([], new Map([['', 1000]]), settings);
    expect(none.total).toEqual({ plots: 0, proportion: 0, area: 0, se: 0, ci: 0, uncertainty: null });
    expect(none.matrix.rowPercent.flat().every((v) => v === null)).toBe(true);
  });
});

describe('the uncertainty routes', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  const people: Record<string, string> = {};
  const call = (method: 'GET' | 'PUT', path: string, token: string, payload?: unknown) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}/uncertainty${path}`, headers: bearer(token), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role, maxUses: 1 } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = res.json().token as string;
  };
  const upload = async (extra: Record<string, string> = {}) => {
    const entries = new Map(readCep(demoCep()).entries);
    for (const [k, v] of Object.entries(extra)) entries.set(k, new TextEncoder().encode(v));
    const res = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    expect(res.statusCode, res.body).toBe(200);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/plots.csv`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: 'id,round,lat,lon\n1,1,-10,20\n2,1,-10,21\n3,1,-10,22\n4,1,-10,23\n' });
  };
  const send = async (key: string, before: string, now: string, region = 'north') => {
    const summary = { collect_text_id: key.split(',')[0], collect_text_region: region, collect_code_ipcc_2000_category: before, collect_code_land_use_category: now };
    const res = await batchRequest(ctx.app, pid, people.ana, [envelope({ recordKey: key, operator: 'ana', modifiedOn: Date.UTC(2026, 10, 1), summary })]);
    expect(res.statusCode, res.body).toBe(200);
  };
  const setup = { initial: 'ipcc_2000_category', final: 'land_use_category', initialYear: '2000', finalYear: '2024', codes: { land_uses: { F: 'forest', C: 'cropland', G: 'grassland' } }, totalArea: null as number | null };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Uncertainty')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    await join('ana', 'operator');
    await join('rev', 'reviewer');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('are for coordinators and reviewers; only coordinators save the setup', async () => {
    await upload();
    expect((await call('GET', '/settings', people.ana)).statusCode).toBe(403);
    expect((await call('GET', '', people.ana)).statusCode).toBe(403);
    const seen = await call('GET', '/settings', people.rev);
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ settings: null, areas: null, canEdit: false });
    expect(seen.json().questions.map((q: { name: string }) => q.name)).toContain('ipcc_2000_category');
    expect(seen.json().lists.land_uses.map((i: { code: string }) => i.code)).toContain('F');
    expect((await call('PUT', '/settings', people.rev, setup)).statusCode).toBe(403);
    expect((await call('GET', '', people.rev)).json().error).toBe('not_set_up');
    expect((await call('PUT', '/settings', owner.token, setup)).statusCode).toBe(200);
    expect((await call('GET', '/settings', people.rev)).json().settings).toEqual(setup);
  });

  it('refuse a setup that is not one', async () => {
    await upload();
    for (const bad of [
      [],
      { ...setup, initial: 'nope' },
      { ...setup, final: 'elevation' },
      { ...setup, initialYear: 'x'.repeat(21) },
      { ...setup, totalArea: -5 },
      { ...setup, totalArea: '100' },
      { ...setup, codes: { land_uses: { F: 'jungle' } } },
      { ...setup, codes: { land_uses: { NOT_A_CODE: 'forest' } } },
      { ...setup, codes: [] },
    ]) {
      expect((await call('PUT', '/settings', owner.token, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('ask for the total area without an areas file, then work it out from the first assessments', async () => {
    await upload();
    await send('1,1', 'F', 'F');
    await send('2,1', 'F', 'C');
    await send('3,1', 'G', 'G');
    await send('4,1', 'W', 'G'); // W: not mapped
    await call('PUT', '/settings', owner.token, setup);
    const asked = await call('GET', '', owner.token);
    expect(asked.statusCode).toBe(409);
    expect(asked.json().error).toBe('needs_total_area');

    await call('PUT', '/settings', owner.token, { ...setup, totalArea: 900 });
    const res = await call('GET', '', people.rev);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ estimator: 'simple', areas: null, plots: 3, totalArea: 900, skipped: { unmapped: 1 } });
    expect(body.unmapped).toEqual([{ which: 'initial', code: 'W', plots: 1 }]);
    const forest = body.categories.find((c: { category: string }) => c.category === 'forest');
    // 2 of 3 plots: 600 ha, SE = 900·√((2/9)/2) = 300
    expect(forest.initial.area).toBeCloseTo(600, 9);
    expect(forest.initial.se).toBeCloseTo(300, 9);
  });

  it('use the areas file\'s strata when there is one', async () => {
    await upload({ 'region_areas.csv': 'north,x.csv,1000\nsouth,y.csv,300\n' });
    await send('1,1', 'F', 'F');
    await send('2,1', 'C', 'C');
    await send('3,1', 'F', 'F', 'south');
    await send('4,1', 'G', 'G', 'south');
    await call('PUT', '/settings', owner.token, setup);
    const body = (await call('GET', '', owner.token)).json();
    expect(body.estimator).toBe('stratified');
    expect(body.areas).toBe('region_areas.csv');
    expect(body.strata).toEqual([{ key: 'north / x.csv', area: 1000, plots: 2 }, { key: 'south / y.csv', area: 300, plots: 2 }]);
    const forest = body.categories.find((c: { category: string }) => c.category === 'forest');
    expect(forest.initial.area).toBeCloseTo(650, 9); // 1000·½ + 300·½
  });
});
