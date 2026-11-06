import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analysisModel, analysisTables, expansionFactors, parseCsv, type AnalysisRecord } from '../src/analysis.js';
import { STANDALONE_DATA, STANDALONE_FILE } from '../src/routes/analysis.js';
import { readCep, zipCep } from '../src/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { demoCep, FIXTURE_DATE, realDemoCep } from './fixtures/cep.js';

const surveyOf = (cep: Buffer) => {
  const f = readCep(cep);
  return new TextDecoder().decode(f.entries.get(f.surveyPath)!);
};

/** A table's CSV as objects (the test's own reading, not the server's). */
const rowsOf = (csv: string) => {
  const [header, ...lines] = parseCsv(csv);
  return lines.map((l) => Object.fromEntries(header.map((h, i) => [h, l[i] ?? ''])));
};

const record = (over: Partial<AnalysisRecord> & { summary: Record<string, string> }): AnalysisRecord => ({
  recordKey: '1,1', operator: 'ana', plot: '1', round: '1', assessment: 'main', submitted: true, modifiedOn: Date.UTC(2026, 10, 5), ...over,
});

describe('the analysis model, generated from the survey', () => {
  const model = analysisModel(surveyOf(realDemoCep()));

  it('has the plot and a table per multiple entity, keyed by the entity key', () => {
    expect(model.languages).toEqual(['en', 'fr', 'pt', 'es']);
    expect(model.tables.map((t) => [t.name, t.keyColumn])).toEqual([['plot', null], ['land_cover', 'element'], ['land_use', 'lu']]);
    const lu = model.tables[0].columns.find((c) => c.name === 'land_use_category')!;
    expect(lu).toMatchObject({ key: 'collect_code_land_use_category', type: 'code', list: 'land_uses', calculated: true });
    expect(lu.labels).toMatchObject({ en: 'Land Use 2025', es: 'Uso de la tierra 2025' });
    expect(model.tables[1].columns.map((c) => c.key)).toEqual(['code_element', 'code_coverage', 'integer_percentage']);
  });

  it('leaves out what the survey keeps out of exports, as the Saiku cube does', () => {
    const names = new Set(model.tables[0].columns.map((c) => c.name));
    expect(names.has('land_use_category_alias')).toBe(false); // collect:includeInDataExport="false"
    expect(names.has('ipcc_current_category')).toBe(false);
    expect(names.has('province')).toBe(true); // from the plot file
    expect(model.tables[0].columns.find((c) => c.name === 'province')!.fromPlotFile).toBe(true);
  });

  it('says which attributes are keys, which code depends on which, and which question is asked after a yes', () => {
    const survey = `<?xml version="1.0" encoding="UTF-8"?>
<survey xmlns="http://www.openforis.org/idml/3.0" xmlns:collect="http://www.openforis.org/collect/3.0/collect">
  <language>en</language>
  <codeLists><list name="land_uses"><items><item><code>F</code><label>Forest</label></item></items></list><list name="years"><items><item><code>2020</code></item></items></list></codeLists>
  <schema>
    <entity name="plot">
      <code name="round" key="true" list="land_uses"/>
      <code name="lu" list="land_uses"/>
      <code name="sub" list="land_uses" parent="lu"/>
      <boolean name="change"/>
      <code name="change_yr" list="years" relevant="change"/>
      <code name="from_lu" list="land_uses" relevant="change and lu = 'F'"/>
      <code name="odd" list="years" relevant="lu = 'F'"/>
      <code name="orphan" list="land_uses" parent="nowhere" relevant="lu"/>
    </entity>
  </schema>
</survey>`;
    const cols = Object.fromEntries(analysisModel(survey).tables[0].columns.map((c) => [c.name, c]));
    expect(cols.round).toMatchObject({ keyAttr: true, parent: null, relevantIf: null });
    expect(cols.lu).toMatchObject({ keyAttr: false, parent: null });
    expect(cols.sub.parent).toBe('lu');
    expect(cols.change_yr.relevantIf).toBe('change');
    expect(cols.from_lu.relevantIf).toBe('change');
    expect(cols.odd.relevantIf).toBeNull();
    // a parent that is no column, and a relevant on what is not a yes/no question, are no links
    expect(cols.orphan).toMatchObject({ parent: null, relevantIf: null });
  });

  it('keeps every level of a hierarchical list, with each item\'s parent and labels', () => {
    const forest = model.lists.land_uses.find((i) => i.code === 'F')!;
    expect(forest).toMatchObject({ parent: null, level: 0, labels: { en: 'Forest', fr: 'Forêt' } });
    const sub = model.lists.land_uses.find((i) => i.code === 'broadleaf_dec')!;
    expect(sub).toMatchObject({ parent: 'F', level: 1 });
  });
});

describe('the tables, from the records\' summaries', () => {
  const model = analysisModel(surveyOf(realDemoCep()));

  it('writes one plot row per record with typed cells, and one row per nested entity answered', () => {
    const tables = analysisTables(
      model,
      [
        record({
          summary: {
            collect_text_id: '1',
            collect_code_land_use_category: 'F',
            collect_integer_forest_percentage: '45',
            collect_boolean_land_use_assessment_confidence: 'true',
            collect_code_land_use_subdivision: 'broadleaf_dec::with a qualifier',
            collect_text_province: 'Sofala, "north"',
            'collect_entity_land_cover[trees].code_coverage': '13',
            'collect_entity_land_cover[trees].integer_percentage': '24',
            'collect_entity_land_cover[grass].code_coverage': '',
            'collect_entity_land_cover[water_body].integer_percentage': '4',
          },
        }),
        record({ recordKey: '2,1', plot: '2', operator: 'bo', submitted: false, summary: { collect_integer_forest_percentage: 'n/a', collect_boolean_land_use_assessment_confidence: 'maybe' } }),
      ],
      null,
    );
    expect(tables.map((t) => [t.name, t.rows])).toEqual([['plot', 2], ['land_cover', 2], ['land_use', 0], ['_lists', expect.any(Number)]]);
    const plots = rowsOf(tables[0].csv);
    expect(plots[0]).toMatchObject({ _record: '1,1', _plot: '1', _round: '1', _assessment: 'main', _operator: 'ana', _submitted: 'true', _saved_on: '2026-11-05', land_use_category: 'F', forest_percentage: '45', land_use_assessment_confidence: 'true', land_use_subdivision: 'broadleaf_dec', province: 'Sofala, "north"' });
    // a number that is no number, a boolean that is no boolean: empty, never a wrong value
    expect(plots[1]).toMatchObject({ _submitted: 'false', forest_percentage: '', land_use_assessment_confidence: '' });
    // the declared types, which the browser reads the CSV with
    expect(Object.fromEntries(tables[0].columns)).toMatchObject({ _saved_on: 'DATE', forest_percentage: 'BIGINT', land_use_assessment_confidence: 'BOOLEAN', land_use_category: 'VARCHAR' });
    // the entity with only a blank answer is left out
    expect(rowsOf(tables[1].csv).map((r) => [r._record, r.element, r.coverage, r.percentage])).toEqual([['1,1', 'trees', '13', '24'], ['1,1', 'water_body', '', '4']]);
    const lists = rowsOf(tables[3].csv);
    expect(lists.find((r) => r.list === 'land_uses' && r.code === 'F')).toMatchObject({ parent: '', level: '0', label_en: 'Forest', label_es: 'Bosque' });
  });

  it('hides the round and the assessment from a collector', () => {
    const [plot] = analysisTables(model, [record({ round: '2', assessment: 'check', summary: {} })], null, { hideRounds: true });
    expect(rowsOf(plot.csv)[0]).toMatchObject({ _round: '', _assessment: '' });
  });
});

describe('expansion factors, as RegionCalculationUtils works them out', () => {
  const model = analysisModel(surveyOf(realDemoCep()));
  const plots = new Map<string, Record<string, string>>([
    ['1', { collect_text_region: 'north', collect_text_plot_file: 'a.csv', collect_code_land_use_category: 'F' }],
    ['2', { collect_text_region: 'north', collect_text_plot_file: 'a.csv', collect_code_land_use_category: 'C' }],
    ['3', { collect_text_region: 'south', collect_text_plot_file: 'b.csv', collect_code_land_use_category: 'G' }],
    ['4', { collect_text_region: 'south', collect_text_plot_file: 'b.csv', collect_code_land_use_category: 'noData' }],
  ]);

  it('divides a region\'s area among its plots, noData plots standing for none', () => {
    const f = expansionFactors({ regionAreas: 'region,plot_file,area\nnorth,a.csv,1000\nsouth,b.csv,300\nnowhere,c.csv,5\n' }, plots, model)!;
    expect(f.source).toBe('region_areas.csv');
    expect(Object.fromEntries([...f.byPlot].map(([p, v]) => [p, v.factor]))).toEqual({ 1: 500, 2: 500, 3: 300, 4: 0 });
    expect(f.byPlot.get('3')!.weight).toBe(1);
    expect(f.byPlot.get('1')!.weight).toBeCloseTo(500 / 300);
    expect(f.unmatched).toBe(2); // the header and the region with no plot
  });

  it('or divides the area of each combination of answers among the plots that have it', () => {
    const f = expansionFactors({ attributeAreas: 'land_use_category;area\nF;800\nC;100\nG;100\n' }, plots, model)!;
    expect(f.source).toBe('areas_per_attribute.csv');
    expect(f.byPlot.get('1')).toEqual({ factor: 800, weight: 8 });
    expect(f.byPlot.get('2')!.factor).toBe(100);
    expect(f.byPlot.has('4')).toBe(false);
  });

  it('gives nothing without an areas file', () => {
    expect(expansionFactors({}, plots, model)).toBeNull();
  });
});

describe('GET /analysis', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  const people: Record<string, string> = {};
  const call = (path: string, token: string, headers: Record<string, string> = {}) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers } });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role, maxUses: 1 } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = res.json().token as string;
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Analysis')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    await join('ana', 'operator');
    await join('bo', 'operator');
    await join('rev', 'reviewer');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  const upload = async (extra: Record<string, string> = {}) => {
    const entries = new Map(readCep(demoCep()).entries);
    for (const [k, v] of Object.entries(extra)) entries.set(k, new TextEncoder().encode(v));
    const res = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    expect(res.statusCode, res.body).toBe(200);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/plots.csv`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: 'id,round,lat,lon\n1,1,-10,20\n2,1,-10,21\n3,1,-10,22\n' });
  };
  const send = async (who: string, key: string, summary: Record<string, string>) => {
    const res = await batchRequest(ctx.app, pid, people[who], [envelope({ recordKey: key, operator: who, modifiedOn: Date.UTC(2026, 10, 1), summary })]);
    expect(res.statusCode, res.body).toBe(200);
  };

  it('asks for the project file first', async () => {
    const res = await call('/analysis', owner.token);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no_project_file');
  });

  it('gives coordinators and reviewers every record, collectors their own without the round; gzipped when asked', async () => {
    await upload({ 'region_areas.csv': 'north,plots.csv,900\n' });
    await send('ana', '1,1', { collect_text_id: '1', collect_text_region: 'north', collect_code_land_use_category: 'F' });
    await send('ana', '2,1', { collect_text_id: '2', collect_text_region: 'north', collect_code_land_use_category: 'C' });
    await send('bo', '3,1', { collect_text_id: '3', collect_text_region: 'north', collect_code_land_use_category: 'G' });

    const coordinator = await call('/analysis', owner.token, { 'accept-encoding': 'gzip' });
    expect(coordinator.statusCode).toBe(200);
    expect(coordinator.headers['content-encoding']).toBe('gzip');
    const body = JSON.parse(gunzipSync(coordinator.rawPayload).toString('utf8'));
    expect(body.scope).toBe('project');
    expect(body.model.tables.map((t: { name: string }) => t.name)).toEqual(['plot', 'land_cover', 'land_use']);
    const plot = body.tables.find((t: { name: string }) => t.name === 'plot');
    expect(plot.rows).toBe(3);
    const rows = rowsOf(plot.csv);
    expect(rows.map((r) => [r._operator, r._round, r.land_use_category, Number(r.expansion_factor)])).toEqual([
      ['ana', '1', 'F', 300],
      ['ana', '1', 'C', 300],
      ['bo', '1', 'G', 300],
    ]);
    expect(body.areas).toEqual({ source: 'region_areas.csv', plots: 3, unmatched: 0 });

    const reviewer = (await call('/analysis', people.rev)).json();
    expect(reviewer.tables[0].rows).toBe(3);

    const ana = (await call('/analysis', people.ana)).json();
    expect(ana.scope).toBe('own');
    const own = rowsOf(ana.tables[0].csv);
    expect(own.map((r) => [r._operator, r._round, r._assessment])).toEqual([['ana', '', ''], ['ana', '', '']]);
    // the areas are the plots', worked out over the whole project
    expect(own.map((r) => Number(r.expansion_factor))).toEqual([300, 300]);
  });

  it('is refused to people outside the project', async () => {
    const other = (await createProject(ctx.app, 'Other')).projectId;
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other}/analysis`, headers: bearer(people.ana) });
    expect([403, 404]).toContain(res.statusCode);
  });
});

describe('GET /analysis/standalone', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let ana: string;
  let webDir: string;
  const TEMPLATE = `<html><head>${STANDALONE_DATA}\n</head><body><script>/* the page; "$&" and "$\`" stay as they are */</script></body></html>`;
  const call = (token: string) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/analysis/standalone`, headers: bearer(token) });
  /** The data the server put in the file. */
  const dataOf = (html: string) => {
    const match = /<script>window\.__CE_ANALYSIS=("[^"]+")<\/script>/.exec(html);
    expect(match, 'the data in the page').not.toBeNull();
    return JSON.parse(gunzipSync(Buffer.from(JSON.parse(match![1]) as string, 'base64')).toString('utf8'));
  };

  beforeEach(async () => {
    webDir = mkdtempSync(join(tmpdir(), 'ce-web-'));
    writeFileSync(join(webDir, STANDALONE_FILE), TEMPLATE);
    ctx = await makeContext({}, { webDir });
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Río Analysis')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } });
    ana = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: invite.json().inviteToken } })).json().token;
    const res = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: demoCep() });
    expect(res.statusCode, res.body).toBe(200);
  });
  afterEach(async () => {
    await ctx.app.close();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('is the built page with the data of whoever asks inside it, as a file to save', async () => {
    const sent = await batchRequest(ctx.app, pid, ana, [envelope({ recordKey: '1,1', operator: 'ana', modifiedOn: Date.UTC(2026, 10, 1), summary: { collect_text_id: '1', collect_code_land_use_category: 'F' } })]);
    expect(sent.statusCode, sent.body).toBe(200);

    const res = await call(owner.token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="R_o_Analysis_-_analysis_\d{4}-\d{2}-\d{2}\.html"; filename\*=UTF-8''R%C3%ADo%20Analysis/);
    // The page as built, the data where it goes, the page's own "$&" untouched
    expect(res.body).not.toContain(STANDALONE_DATA);
    expect(res.body).toContain('"$&" and "$`" stay as they are');
    const data = dataOf(res.body);
    expect(data.project).toEqual({ id: pid, name: 'Río Analysis' });
    expect(Date.parse(data.made)).not.toBeNaN();
    expect(data.scope).toBe('project');
    expect(data.tables.find((t: { name: string }) => t.name === 'plot').rows).toBe(1);

    // A collector's file: their own records, as their page has them
    const own = dataOf((await call(ana)).body);
    expect(own.scope).toBe('own');
  });

  it('is not found when the dashboard was built without it, and refused outside the project', async () => {
    rmSync(join(webDir, STANDALONE_FILE));
    const missing = await call(owner.token);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('no_standalone');

    const other = (await createProject(ctx.app, 'Other')).projectId;
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other}/analysis/standalone`, headers: bearer(ana) });
    expect([403, 404]).toContain(res.statusCode);
  });
});

describe('the views shared with the team', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let ana: string;
  const call = (method: 'GET' | 'PUT' | 'DELETE', path: string, token: string, payload?: unknown) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}/analysis/views${path}`, headers: bearer(token), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Views')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } });
    ana = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: invite.json().inviteToken } })).json().token;
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  const view = (name: string, over: Record<string, unknown> = {}) => ({ name, table: 'plot', language: 'en', config: { plugin: 'Y Bar', group_by: ['Land use'] }, ...over });

  it('are saved by coordinators, replaced by name and table, seen by everyone, deleted', async () => {
    expect((await call('GET', '', ana)).json()).toEqual({ views: [] });
    expect((await call('PUT', '', owner.token, view('Land use'))).statusCode).toBe(200);
    expect((await call('PUT', '', owner.token, view('Area by region'))).statusCode).toBe(200);
    await call('PUT', '', owner.token, view('Land use', { config: { plugin: 'Datagrid' } }));
    await call('PUT', '', owner.token, view('Land use', { table: 'land_cover' }));
    const seen = (await call('GET', '', ana)).json().views;
    expect(seen.map((v: { name: string; table: string }) => [v.name, v.table])).toEqual([['Area by region', 'plot'], ['Land use', 'land_cover'], ['Land use', 'plot']]);
    expect(seen[2]).toMatchObject({ config: { plugin: 'Datagrid' }, savedBy: 'owner', language: 'en' });
    expect(typeof seen[2].savedAt).toBe('number');
    expect((await call('DELETE', '?name=Land%20use&table=plot', owner.token)).json().views).toHaveLength(2);
    expect((await call('DELETE', '?name=Land%20use&table=plot', owner.token)).statusCode).toBe(404);
  });

  it('are refused to collectors, and when they are not views', async () => {
    expect((await call('PUT', '', ana, view('Mine'))).statusCode).toBe(403);
    expect((await call('DELETE', '?name=x&table=plot', ana)).statusCode).toBe(403);
    for (const bad of [view(''), view('x'.repeat(81)), view('x', { config: [] }), view('x', { table: '' }), { name: 'x' }]) {
      expect((await call('PUT', '', owner.token, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('PUT', '', owner.token, view('big', { config: { x: 'y'.repeat(70_000) } }))).statusCode).toBe(413);
  });
});
