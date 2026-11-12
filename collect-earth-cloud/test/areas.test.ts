// Strata and areas (src/areas.ts, src/routes/areas.ts, docs/plans/2026-11-11-strata-areas.md step 2).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { areasFileText, parseAreaSettings, strataFactors, strataOfFile, totalFactors } from '../src/areas.js';
import { readCep, zipCep } from '../src/cep.js';
import { parseCsv } from '../src/ceo/answers.js';
import { firstAssessments } from '../src/routes/analysis.js';
import type { RecordRow } from '../src/types.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { demoCep, FIXTURE_DATE } from './fixtures/cep.js';

describe('strata and areas', () => {
  it('read an areas_per_attribute.csv: its columns, its lines, the weight left out', () => {
    const read = strataOfFile('class_forest;area;weight\nAgoua;68872,5;4\nBirni;3345;1\nbroken;x;1\n')!;
    expect(read.areas).toEqual({ columns: ['class_forest'], strata: [{ values: ['Agoua'], area: 68872.5 }, { values: ['Birni'], area: 3345 }] });
    expect(read.unreadable).toBe(1);
    expect(strataOfFile('area\n')).toBeNull();
    expect(areasFileText(read.areas)).toBe('class_forest,area\nAgoua,68872.5\nBirni,3345\n');
  });

  it('check a setting: columns, one value per column, areas, no stratum twice', () => {
    expect(parseAreaSettings({ mode: 'total', area: 1000 })).toEqual({ mode: 'total', area: 1000 });
    expect(parseAreaSettings({ mode: 'strata', columns: [' province '], strata: [{ values: ['North '], area: 10 }] })).toEqual({ mode: 'strata', columns: ['province'], strata: [{ values: ['North'], area: 10 }] });
    for (const bad of [
      null,
      { mode: 'total', area: 0 },
      { mode: 'other' },
      { mode: 'strata', columns: [], strata: [] },
      { mode: 'strata', columns: ['a', 'A'], strata: [] },
      { mode: 'strata', columns: ['a'], strata: [] },
      { mode: 'strata', columns: ['a'], strata: [{ values: ['x'], area: 0 }] },
      { mode: 'strata', columns: ['a'], strata: [{ values: ['x', 'y'], area: 1 }] },
      { mode: 'strata', columns: ['a'], strata: [{ values: ['x'], area: -1 }] },
      { mode: 'strata', columns: ['a'], strata: [{ values: ['1'], area: 1 }, { values: ['1.0'], area: 2 }] },
    ]) {
      expect(typeof parseAreaSettings(bad), JSON.stringify(bad)).toBe('string');
    }
  });

  it("divide each stratum's area among its plots, and a total area among all", () => {
    const plots = new Map<string, (string | undefined)[]>([['1', ['A']], ['2', ['A']], ['3', ['B']], ['4', [undefined]]]);
    const f = strataFactors({ columns: ['forest'], strata: [{ values: ['A'], area: 1000 }, { values: ['B'], area: 300 }, { values: ['C'], area: 5 }] }, plots, { source: 'strata', unknownColumns: [] });
    expect(Object.fromEntries([...f.byPlot].map(([p, v]) => [p, v.factor]))).toEqual({ 1: 500, 2: 500, 3: 300 });
    expect(f.byPlot.get('3')).toEqual({ factor: 300, weight: 1, stratum: 'B' });
    expect(f.unmatched).toBe(1);
    expect(f.noStratum).toEqual({ plots: 1, examples: [{ stratum: '', plots: 1 }] });
    expect([...totalFactors(900, ['1', '2', '3']).byPlot.values()].map((v) => v.factor)).toEqual([300, 300, 300]);
  });

  it("count a plot's first submitted assessment, whatever order the records come in", () => {
    const row = (operator: string, firstSubmittedOn: number | null, modifiedOn: number) =>
      ({ projectId: 'p', recordKey: '1', operator, modifiedOn, receivedAt: 0, activelySaved: true, step: 1, xml: null, summary: { forest: operator }, deleted: false, deletedOn: null, firstSubmittedOn }) as RecordRow;
    const resolve = (() => ({ unit: '1', round: { round: 1, assessment: 'main' } })) as unknown as Parameters<typeof firstAssessments>[1];
    const rows = [row('ana', 300, 900), row('ben', 100, 950), row('cy', 100, 960)];
    for (const order of [rows, [...rows].reverse()]) expect(firstAssessments(order, resolve).get('1')?.operator).toBe('ben');
    expect(firstAssessments([row('ana', null, 500), row('ben', null, 400)], resolve).get('1')?.operator).toBe('ben');
  });
});

describe('the areas routes', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  const people: Record<string, string> = {};
  const call = (method: 'GET' | 'PUT', path: string, token: string, payload?: unknown) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: bearer(token), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role, maxUses: 1 } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = res.json().token as string;
  };
  /** The demo survey; its plot file has a column of its own, `forest`, that is no question of the survey. */
  const upload = async (extra: Record<string, string> = {}) => {
    const entries = new Map(readCep(demoCep()).entries);
    for (const [k, v] of Object.entries(extra)) entries.set(k, new TextEncoder().encode(v));
    const res = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    expect(res.statusCode, res.body).toBe(200);
    const plots = 'id,round,lat,lon,forest\n1,1,-10,20,A\n2,1,-10,21,A\n3,1,-10,22,B\n4,1,-10,23,B\n5,1,-10,24,C\n';
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/plots.csv`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: plots });
  };
  const send = async (key: string, region = 'north') => {
    const summary = { collect_text_id: key.split(',')[0], collect_text_region: region, collect_code_land_use_category: 'F' };
    const res = await batchRequest(ctx.app, pid, people.ana, [envelope({ recordKey: key, operator: 'ana', modifiedOn: Date.UTC(2026, 10, 1), summary })]);
    expect(res.statusCode, res.body).toBe(200);
  };
  const areaColumn = async () => {
    const csv = (await call('GET', '/analysis', owner.token)).json().tables[0].csv as string;
    const [header, ...rows] = parseCsv(csv).filter((r) => r.length > 1);
    const at = header.indexOf('expansion_factor');
    return Object.fromEntries(rows.map((r) => [r[0], r[at]]));
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Areas')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    await join('ana', 'operator');
    await join('rev', 'reviewer');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("show the project file's areas file until the dashboard has its own", async () => {
    await upload({ 'areas_per_attribute.csv': 'forest,area\nA,1000\nB,300\n' });
    await send('1,1');
    const res = await call('GET', '/areas', people.rev);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ source: 'areas_per_attribute.csv', settings: { mode: 'strata', columns: ['forest'] }, assessed: 1, canEdit: false });
    expect(body.columns).toContain('forest');
    expect(body.strata).toEqual([
      { values: ['A'], area: 1000, plots: 2, assessed: 1, haPerPlot: 1000 },
      { values: ['B'], area: 300, plots: 2, assessed: 0, haPerPlot: null },
      { values: ['C'], area: null, plots: 1, assessed: 0, haPerPlot: null },
    ]);
    expect((await call('GET', '/areas', people.ana)).statusCode).toBe(403);
  });

  it("take strata from a plot file's column that is no question of the survey, for the analysis and the uncertainty", async () => {
    await upload();
    for (const key of ['1,1', '2,1', '3,1']) await send(key);
    expect((await call('PUT', '/areas', people.rev, { settings: { mode: 'total', area: 1 } })).statusCode).toBe(403);
    const saved = await call('PUT', '/areas', owner.token, { settings: { mode: 'strata', columns: ['forest'], strata: [{ values: ['A'], area: 1000 }, { values: ['B'], area: 300 }] } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await areaColumn()).toEqual({ '1,1': '500', '2,1': '500', '3,1': '300' });
    const body = (await call('GET', '/areas', owner.token)).json();
    expect(body).toMatchObject({ source: 'strata', withArea: 3, unknownColumns: [], noStratum: { plots: 0 }, canEdit: true });
    expect(body.strata.map((s: { values: string[]; plots: number; assessed: number; haPerPlot: number | null }) => [s.values[0], s.plots, s.assessed, s.haPerPlot])).toEqual([
      ['A', 2, 2, 500],
      ['B', 2, 1, 300],
      ['C', 1, 0, null],
    ]);
    // the uncertainty's strata are the same
    const setup = { initial: 'land_use_category', final: 'land_use_category', initialYear: '2000', finalYear: '2024', codes: { land_uses: { F: 'forest' } }, totalArea: null };
    expect((await call('PUT', '/uncertainty/settings', owner.token, setup)).statusCode).toBe(200);
    const u = (await call('GET', '/uncertainty', owner.token)).json();
    expect(u).toMatchObject({ areas: 'strata', estimator: 'stratified', totalArea: 1300 });
  });

  it('take an uploaded areas file, a total area, and go back to the project file', async () => {
    await upload({ 'areas_per_attribute.csv': 'forest,area\nA,10\n' });
    await send('1,1');
    expect((await call('PUT', '/areas', owner.token, { file: 'forest;area\nA;1.000,5\nB;300\n' })).json().settings).toEqual({ mode: 'strata', columns: ['forest'], strata: [{ values: ['A'], area: 1000.5 }, { values: ['B'], area: 300 }] });
    expect(await areaColumn()).toEqual({ '1,1': '1000.5' });
    const download = await call('GET', '/areas/file', people.rev);
    expect(download.headers['content-type']).toContain('text/csv');
    expect(download.body).toBe('forest,area\nA,1000.5\nB,300\n');

    expect((await call('PUT', '/areas', owner.token, { settings: { mode: 'total', area: 50 } })).statusCode).toBe(200);
    expect(await areaColumn()).toEqual({ '1,1': '50' });
    expect((await call('GET', '/areas/file', owner.token)).statusCode).toBe(404);

    expect((await call('PUT', '/areas', owner.token, { settings: null })).statusCode).toBe(200);
    expect(await areaColumn()).toEqual({ '1,1': '10' });
    for (const bad of [{ file: 'area\n' }, { file: 'forest,area\nA,x\n' }, { settings: { mode: 'strata', columns: ['forest'], strata: [{ values: ['A'] }] } }]) {
      expect((await call('PUT', '/areas', owner.token, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('show the strata other columns would make, nothing saved', async () => {
    await upload({ 'areas_per_attribute.csv': 'forest,area\nA,1000\n' });
    await send('1,1');
    // the same columns keep their areas
    expect((await call('GET', '/areas?columns=FOREST', owner.token)).json().strata[0]).toMatchObject({ values: ['A'], area: 1000, plots: 2, assessed: 1 });
    await call('PUT', '/areas', owner.token, { settings: { mode: 'strata', columns: ['nope'], strata: [{ values: ['A'], area: 5 }] } });
    const preview = (await call('GET', '/areas?columns=forest', owner.token)).json();
    expect(preview.strata.map((s: { values: string[]; area: number | null; plots: number }) => [s.values, s.area, s.plots])).toEqual([
      [['A'], null, 2],
      [['B'], null, 2],
      [['C'], null, 1],
    ]);
    expect(await ctx.store.getAreaSettings(pid)).toMatchObject({ columns: ['nope'] }); // the preview saved nothing
  });

  it('work before the project file: the strata are the plot files\' columns', async () => {
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/plots.csv`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: 'id,lat,lon,stratum\n1,-10,20,Reserve\n2,-10,21,Farm\n' });
    const empty = await call('GET', '/areas', owner.token);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toMatchObject({ source: null, settings: null, columns: ['stratum'] });
    await call('PUT', '/areas', owner.token, { settings: { mode: 'strata', columns: ['stratum'], strata: [{ values: ['Reserve'], area: 500 }] } });
    const body = (await call('GET', '/areas', owner.token)).json();
    expect(body.strata.map((s: { values: string[]; area: number | null; plots: number }) => [s.values[0], s.area, s.plots])).toEqual([['Reserve', 500, 1], ['Farm', null, 1]]);
  });

  it('say which columns match nothing', async () => {
    await upload();
    await send('1,1');
    await call('PUT', '/areas', owner.token, { settings: { mode: 'strata', columns: ['nope'], strata: [{ values: ['A'], area: 1 }] } });
    expect((await call('GET', '/areas', owner.token)).json()).toMatchObject({ unknownColumns: ['nope'], noStratum: { plots: 1 }, withArea: 0 });
  });
});
