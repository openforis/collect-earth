import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analysisModel } from '../src/analysis.js';
import { readCep, readZip, zipCep } from '../src/cep.js';
import { ghgiXml, IPCC_END_YEAR, IPCC_START_YEAR, ipccPlots, ipccSurvey, landUnitsCsv, matrixSheets, perPlotCsv, strataMatrixSheets, timeSeriesXml, type IpccPlot, type Subdivision } from '../src/ipcc.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { demoCep, FIXTURE_DATE } from './fixtures/cep.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
type Summaries = Record<string, Record<string, string>>;
// The survey of a desktop export, with the ipcc_<year>_* questions IPCCSurveyAdapter wrote into it, and records of it as
// Collect Earth sends them: Collect worked out those questions (collect-import/SummaryDump.java, ipccScenarios.py)
const survey = ipccSurvey(analysisModel(new TextDecoder().decode(readZip(fixture('desktop-xml-export.zip')).get('idml.xml')!)));
const exported: Summaries = JSON.parse(fixture('collect-import/desktop-xml-export.summaries.json').toString('utf8'));
const scenarios: Summaries = JSON.parse(fixture('collect-import/ipcc-scenarios.summaries.json').toString('utf8'));
const YEARS = Array.from({ length: IPCC_END_YEAR - IPCC_START_YEAR + 1 }, (_, i) => IPCC_START_YEAR + i);

/** The plots of some summaries, the land uses worked out by the rules (not read from the survey's own questions). */
const plotsOf = (summaries: Summaries, areas: Record<string, number> = {}) =>
  ipccPlots({ ...survey, own: new Map(), id: undefined }, Object.entries(summaries).map(([id, summary]) => ({ id, summary, area: areas[id] ?? null })));
const byId = (plots: IpccPlot[], id: string) => plots.find((p) => p.id === id)!;

describe("a plot's land use in each year", () => {
  it('is what Collect works out with the rules IPCCSurveyAdapter writes into the survey', () => {
    const all = { ...exported, ...scenarios };
    const plots = plotsOf(all);
    expect(plots).toHaveLength(17);
    for (const p of plots) {
      const summary = all[p.id];
      YEARS.forEach((year, i) => {
        expect(p.years[i], `${p.id} in ${year}`).toEqual({ category: summary[`collect_code_ipcc_${year}_category`], subdivision: summary[`collect_code_ipcc_${year}_subdivision`] });
      });
    }
    // what the scenarios are: forest to cropland in 2010; grassland since 2005 from forest, settlement since 2018
    expect(byId(plots, '1/9001.xml').years[9]).toEqual({ category: 'F', subdivision: 'broadleaf_dec' });
    expect(byId(plots, '1/9001.xml').years[10]).toEqual({ category: 'C', subdivision: 'annual_crops' });
    expect(byId(plots, '1/9004.xml').years.map((y) => y.category).join('')).toBe('FFFFFGGGGGGGGGGGGGSSSSSS');
  });

  it("is read from the survey's own yearly questions when it has them", () => {
    const own = ipccPlots(survey, [{ id: '1', summary: { ...scenarios['1/9001.xml'], collect_code_ipcc_2000_category: 'G' }, area: null }]);
    expect(own[0].years[0].category).toBe('G');
    expect(own[0].years[23]).toEqual({ category: 'C', subdivision: 'annual_crops' });
  });
});

describe('what the survey needs', () => {
  it("is the IPCC template's questions and the strata's", () => {
    expect(survey.missing).toEqual([]);
    expect(survey.subdivisions.filter((s) => s.category === 'S').map((s) => [s.code, s.id, s.management])).toEqual([
      ['city', 1, 'OTHER'],
      ['village', 2, 'OTHER'],
      ['mining', 3, 'OTHER'],
      ['infrastructure', 4, 'OTHER'],
      ['built_up', 5, 'OTHER'],
      ['urban_park', 6, 'OTHER'],
    ]);
    const none = ipccSurvey({ languages: ['en'], tables: [{ name: 'plot', labels: {}, keyColumn: null, columns: [] }], lists: {} });
    expect(none.missing).toEqual([
      'land_use_subcategory',
      'land_use_subdivision',
      'land_use_initial_subdivision',
      'land_use_subcategory_year_of_change',
      'land_use_subdivision_change',
      'land_use_subdivision_year_of_change',
      'second_lu_change',
      'second_lu_conversion',
      'second_lu_conversion_year',
      'second_lu_subdivision',
      'climate',
      'soil',
      'gez',
    ]);
  });
});

describe('the land use change matrices (IPCCDataExportMatrixExcel)', () => {
  // 101: broadleaf evergreen forest all along; 9001: broadleaf deciduous forest, cropland in 2010; 9004: broadleaf
  // evergreen forest, grassland in 2005, settlement in 2018; 102: not submitted, so blank
  const plots = plotsOf({ '101': exported['1/247102.xml'], '102': exported['1/247103.xml'], '9001': scenarios['1/9001.xml'], '9004': scenarios['1/9004.xml'] }, { 101: 5, 9001: 10, 9004: 20 });

  it('has one sheet for each year and the next, the hectares that went from each subdivision to each other', () => {
    const sheets = matrixSheets(survey, plots);
    expect(sheets.map((s) => s.title)).toEqual(YEARS.slice(0, -1).map((y) => `LU Matrix ${y}-${y + 1}`));
    expect(sheets[4].rows).toEqual([
      ['Transition 2004/2005', 'F / Managed / Broadleaf deciduous', 'F / Managed / Broadleaf evergreen', 'G / Managed / Grassland'],
      ['F / Managed / Broadleaf deciduous', 10, 0, 0],
      ['F / Managed / Broadleaf evergreen', 0, 5, 20],
      ['G / Managed / Grassland', 0, 0, 0],
    ]);
    // the year of the change to cropland: categories in their code's order (C before F)
    expect(sheets[9].rows[0]).toEqual(['Transition 2009/2010', 'C / Annual / Annual crops', 'F / Managed / Broadleaf deciduous', 'F / Managed / Broadleaf evergreen', 'G / Managed / Grassland']);
    expect(sheets[9].rows[2]).toEqual(['F / Managed / Broadleaf deciduous', 10, 0, 0, 0]);
    expect(matrixSheets(survey, [])).toEqual([]);
  });

  it('by ecological zone, climate and soil, each stratum under its labels', () => {
    const north = { ...scenarios['1/9001.xml'], collect_code_climate: '3' };
    const sheets = strataMatrixSheets(survey, [...plots, ...plotsOf({ n: north }, { n: 1 })]);
    expect(sheets).toHaveLength(23);
    const rows = sheets[9].rows;
    // in the order of the climate list: CTM (3) before CTD (4)
    expect(rows.slice(0, 5)).toEqual([[], ['Climate', 'CTM'], ['Soil', 'HAC'], ['Global Ecological Zone (GEZ)', 'TAwb'], []]);
    expect(rows[5]).toEqual(['Transition 2009/2010', 'C / Annual / Annual crops', 'F / Managed / Broadleaf deciduous']);
    expect(rows[7]).toEqual(['F / Managed / Broadleaf deciduous', 1, 0]);
    expect(rows.slice(8, 16)).toEqual([[], [], [], [], ['Climate', 'CTD'], ['Soil', 'HAC'], ['Global Ecological Zone (GEZ)', 'TAwb'], []]);
  });
});

describe("the desktop's exporters on the same plots", () => {
  // plots.json: plots of the scenarios above in several strata, with their areas, as src/ipcc.ts reads them; desktop/:
  // what the desktop's own exporters make of them (ipcc/IpccDesktopDump.java)
  const input = JSON.parse(fixture('ipcc/plots.json').toString('utf8')) as { subdivisions: Subdivision[]; plots: (Omit<IpccPlot, 'summary'> & { province: string })[] };
  // the subdivisions with management types chosen as on the form, some not the defaults
  const chosen = { ...survey, subdivisions: input.subdivisions };
  const plots: IpccPlot[] = input.plots.map(({ province, ...p }) => ({ ...p, summary: { collect_text_province: province } }));
  const desktop = (name: string) => fixture(`ipcc/desktop/${name}`).toString('utf8');
  /** The GUIDs (random at each export) numbered in the order they first appear. */
  const numbered = (xml: string) => {
    const seen = new Map<string, number>();
    return xml.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (g) => {
      if (!seen.has(g)) seen.set(g, seen.size);
      return `guid-${seen.get(g)}`;
    });
  };
  /** The desktop's header has a space before most names (how its SQL was split): left out by the cloud. */
  const trimmedHeader = (csv: string) => csv.replace(/^.*\n/, (line) => line.replace(/" /g, '"'));

  it('give the same matrices', () => {
    expect(matrixSheets(chosen, plots)).toEqual(JSON.parse(desktop('LU_Matrixes.json')));
    expect(strataMatrixSheets(chosen, plots)).toEqual(JSON.parse(desktop('LU_Matrixes_stratified.json')));
  });

  it('give the same land uses of each plot and land units', () => {
    expect(perPlotCsv(chosen, plots)).toBe(trimmedHeader(desktop('LU_Timeseries_per_plot.csv')));
    expect(landUnitsCsv(chosen, plots)).toBe(trimmedHeader(desktop('LU_Timeseries_grouped.csv')));
  });

  it('give the same time series', () => {
    expect(numbered(timeSeriesXml(chosen, plots))).toBe(numbered(desktop('LU_Timeseries.xml')));
  });

  it('give the same file for the IPCC Inventory Software', () => {
    // the harness's soil descriptions; the regions are the plots' provinces
    const soilRemarks = new Map([...survey.labels.soil].map(([code, label]) => [code, `${label} description`]));
    const xml = ghgiXml(chosen, plots, { country: 'ALG', regionOf: (p) => p.summary.collect_text_province || null, soilRemarks });
    expect(numbered(xml)).toBe(numbered(desktop('GHGi_tool_data.xml')));
  });
});

describe('the IPCC export routes', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let ana: string;
  const get = (path: string, token = owner.token) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/exports/ipcc${path}`, headers: bearer(token) });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'IPCC')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 1 } });
    ana = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: invite.json().inviteToken } })).json().token;
    const res = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: zipCep(new Map(readCep(demoCep()).entries), FIXTURE_DATE) });
    expect(res.statusCode, res.body).toBe(200);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/plots.csv`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: 'id,round,lat,lon\n9001,1,-10,20\n9004,1,-10,21\n' });
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('are for coordinators, and say what the export is made of', async () => {
    expect((await get('', ana)).statusCode).toBe(403);
    expect((await get('/matrix', ana)).statusCode).toBe(403);
    expect((await get('')).json()).toMatchObject({ missing: [], plots: 0, areas: null, region: 'province' });
    expect((await get('/matrix')).json().error).toBe('no_plots');
    expect((await get('/nothing')).statusCode).toBe(404);
  });

  it('give the matrices of the plots, with their areas, and note each download', async () => {
    const records = ['1/9001.xml', '1/9004.xml'].map((f) => envelope({ recordKey: `${scenarios[f].collect_text_id},1`, operator: 'ana', modifiedOn: Date.UTC(2026, 10, 1), summary: scenarios[f] }));
    expect((await batchRequest(ctx.app, pid, ana, records)).statusCode).toBe(200);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/areas`, headers: bearer(owner.token), payload: { settings: { mode: 'total', area: 1000 } } });
    expect((await get('')).json()).toMatchObject({ missing: [], plots: 2, areas: 'total' });
    const res = await get('/matrix');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('LU_Matrixes.xlsx');
    const files = unzipSync(res.rawPayload);
    expect(strFromU8(files['xl/workbook.xml'])).toContain('<sheet name="LU Matrix 2004-2005"');
    // 2004 to 2005: 9004 went from broadleaf evergreen forest to grassland, 500 ha
    expect(strFromU8(files['xl/worksheets/sheet5.xml'])).toMatch(/Broadleaf evergreen<\/t><\/is><\/c><c r="B3"><v>0<\/v><\/c><c r="C3"><v>0<\/v><\/c><c r="D3"><v>500<\/v>/);
    expect((await get('/matrix-strata')).statusCode).toBe(200);
    const csv = await get('/plots');
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.body.split('\n').slice(1, 3).map((l) => l.slice(0, 25))).toEqual(['"9004","CTD","HAC","TAwb"', '"9001","CTD","HAC","TAwb"']);
    expect((await get('/land-units')).body).toMatch(/^"land_unit_id",.*\n"LU_0001",.*"500\.0"\n"LU_0002",.*"500\.0"\n$/);
    expect((await get('/timeseries')).body).toContain('<areaHa>500.0</areaHa>');
    const log = await ctx.store.listAudit(pid, { limit: 10, action: 'export.downloaded' });
    expect(log.map((e) => e.details.file)).toEqual(['timeseries', 'land-units', 'plots', 'matrix-strata', 'matrix']);
    expect(log[0].details).toEqual({ kind: 'ipcc', file: 'timeseries', plots: 2 });
  });

  it('give the file for the IPCC Inventory Software with the choices of the form', async () => {
    const records = ['1/9001.xml', '1/9004.xml'].map((f) => envelope({ recordKey: `${scenarios[f].collect_text_id},1`, operator: 'ana', modifiedOn: Date.UTC(2026, 10, 1), summary: scenarios[f] }));
    expect((await batchRequest(ctx.app, pid, ana, records)).statusCode).toBe(200);
    const status = (await get('')).json();
    expect(status.countries).toContainEqual(['ALG', 'Algeria']);
    expect(status.regions).toContain('province');
    expect(status.subdivisions).toContainEqual({ category: 'S', code: 'city', name: 'City', management: 'OTHER' });
    const post = (payload: Record<string, unknown>, token = owner.token) => ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/exports/ipcc/ghgi`, headers: bearer(token), payload });
    expect((await post({ country: 'ALG', region: 'province' }, ana)).statusCode).toBe(403);
    expect((await post({ country: 'XX', region: 'province' })).json().error).toBe('invalid_choice');
    expect((await post({ country: 'ALG', region: 'nothing' })).json().error).toBe('invalid_choice');
    const res = await post({ country: 'ALG', region: 'province', management: { 'S/city': 'TREED', 'C/annual_crops': 'NOPE' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('GHGi_tool_data.xml');
    // the settlement treed as chosen, the cropland annual (its default) for a choice it does not have
    expect(res.body).toContain('<settlementTypeId>9</settlementTypeId>');
    expect(res.body).toContain('<perennialCrops>false</perennialCrops>');
    expect(res.body).toContain('<name>Madrid</name>');
    expect((await ctx.store.listAudit(pid, { limit: 1, action: 'export.downloaded' }))[0].details).toEqual({ kind: 'ipcc', file: 'ghgi', plots: 2 });
  });
});
