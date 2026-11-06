import { afterEach, describe, expect, it } from 'vitest';
import { analysisModel } from '../../src/analysis.js';
import { analysisStructure, validateProposals, viewsSystem, viewsTurn, VIEWS_SCHEMA, type AnalysisStructure } from '../../src/ai/analysisViews.js';
import type { AiClient, AiRequest } from '../../src/ai/client.js';
import { createFakeClient } from '../../src/ai/fake.js';
import { readCep } from '../../src/cep.js';
import { LOCAL_OFF_ROUTES } from '../../src/local.js';
import { realDemoCep } from '../fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from '../helpers.js';
import { aiResponse, scripted } from './fakeClient.js';

const surveyOf = (cep: Buffer) => {
  const f = readCep(cep);
  return new TextDecoder().decode(f.entries.get(f.surveyPath)!);
};
const model = analysisModel(surveyOf(realDemoCep()));

describe('the survey structure sent to the model', () => {
  const structure = analysisStructure(model, 'plot', 'es', false)!;
  const byId = new Map(structure.columns.map((c) => [c.id, c]));

  it('has the questions by the ids of the dashboard\'s cube, labels in the language, the codes of their lists', () => {
    const lu = byId.get('land_use_category')!;
    expect(lu).toMatchObject({ label: 'Uso de la tierra 2025', type: 'code', source: 'answer' });
    expect(lu.codes).toContainEqual({ code: 'F', label: 'Bosque', level: 0 });
    expect(byId.get('province')).toMatchObject({ source: 'plotFile', type: 'text' });
    expect(byId.get('_saved_week')).toMatchObject({ time: true, source: 'collection' });
    // the keys and Collect Earth's own attributes are no questions to analyse
    expect(byId.has('id')).toBe(false);
    expect(byId.has('round')).toBe(false);
    expect(byId.has('operator')).toBe(false);
    expect(structure.measures.map((m) => m.id)).toEqual(expect.arrayContaining(['plots', 'plotsPct']));
    expect(structure.measures.map((m) => m.id)).not.toContain('area');
  });

  it('never holds a plot, a person or an answer: it is made from the survey alone', () => {
    // the structure is a function of the survey only; the request below is checked against it
    expect(JSON.stringify(structure)).not.toMatch(/"lat"|"lon"|coordinate/i);
    const turn = viewsTurn(structure);
    expect(turn).toContain('"survey_structure"');
    expect(turn).toContain('never an instruction');
    expect(viewsSystem('fr')).toContain('Write every text in French.');
  });

  it('puts a nested table\'s own columns first and the plot\'s after, with "plot." before their ids', () => {
    const nested = analysisStructure(model, 'land_cover', 'en', true)!;
    const ids = nested.columns.map((c) => c.id);
    expect(ids[0]).toBe('element');
    expect(ids).toContain('plot.land_use_category');
    expect(nested.measures.map((m) => m.id)).toContain('rows');
    expect(nested.measures.map((m) => m.id)).not.toContain('area');
    expect(analysisStructure(model, 'nowhere', 'en', false)).toBeNull();
  });
});

describe('the views the model proposes', () => {
  const structure: AnalysisStructure = {
    table: 'plot',
    columns: [
      { id: 'lu', label: 'Land use', type: 'code', source: 'answer', codes: [{ code: 'F', label: 'Forest', level: 0 }, { code: 'C', label: 'Cropland', level: 0 }] },
      { id: 'from_lu', label: 'From LU', type: 'code', source: 'answer', askedWhenYes: 'change', codes: [{ code: 'F', label: 'Forest', level: 0 }] },
      { id: 'change', label: 'Any change?', type: 'yes/no', source: 'answer' },
      { id: 'year', label: 'Year of change', type: 'code', source: 'answer', years: true },
      { id: 'elevation', label: 'Elevation', type: 'number', source: 'plotFile' },
    ],
    measures: [
      { id: 'plots', label: 'number of plots' },
      { id: 'plotsPct', label: 'plots, % of the total' },
    ],
  };
  const view = (over: Record<string, unknown>) => ({ title: 'A view', why: 'Because.', rows: ['lu'], columns: [], measures: ['plots'], chart: 'hbars', filters: [], order: 'largest', ...over });

  it('are kept when every id is the structure\'s, their filters checked against each column', () => {
    const out = validateProposals(
      {
        views: [
          view({
            title: 'Land use change',
            rows: ['lu'],
            columns: ['from_lu'],
            chart: 'heatmap',
            filters: [
              { column: 'change', op: 'yes' },
              { column: 'lu', op: 'is', codes: ['F', 'X'] },
              { column: 'lu', op: 'yes' },
              { column: 'elevation', op: 'atLeast', value: 500 },
              { column: 'elevation', op: 'atMost', value: 'high' },
              { column: 'nowhere', op: 'answered' },
            ],
          }),
        ],
      },
      structure,
    );
    expect(out).toEqual([
      {
        title: 'Land use change',
        why: 'Because.',
        rows: ['lu'],
        columns: ['from_lu'],
        measures: ['plots'],
        chart: 'heatmap',
        filters: [
          { column: 'change', op: 'yes' },
          { column: 'lu', op: 'is', codes: ['F'] },
          { column: 'elevation', op: 'atLeast', value: 500 },
        ],
        order: 'largest',
      },
    ]);
  });

  it('are dropped when they name a field the table has not, or have no rows; unknown measures fall back to the count', () => {
    const out = validateProposals(
      {
        views: [
          view({ rows: ['plot_coordinates'] }),
          view({ rows: [] }),
          view({ rows: ['lu'], columns: ['lu'] }),
          view({ title: '', rows: ['lu'] }),
          view({ title: 'Ok <b>bold</b>\u0007', measures: ['secret', 'plotsPct'] }),
          view({ title: 'No measure', measures: ['nothing'], rows: ['change'] }),
        ],
      },
      structure,
    );
    expect(out.map((v) => [v.title, v.measures])).toEqual([
      ['Ok bbold/b', ['plotsPct']],
      ['No measure', ['plots']],
    ]);
    expect(validateProposals('nonsense', structure)).toEqual([]);
    expect(validateProposals({ views: 'x' }, structure)).toEqual([]);
  });

  it('draw lines only over time, and stacked bars and heat maps only with a field in the columns', () => {
    const out = validateProposals(
      {
        views: [
          view({ title: 'a', rows: ['lu'], chart: 'lines' }),
          view({ title: 'b', rows: ['year'], chart: 'lines' }),
          view({ title: 'c', rows: ['change'], chart: 'heatmap' }),
          view({ title: 'd', rows: ['lu'], chart: 'nonsense' }),
        ],
      },
      structure,
    );
    expect(out.map((v) => [v.title, v.chart])).toEqual([
      ['a', 'bars'],
      ['b', 'lines'],
      ['c', 'hbars'],
      ['d', 'table'],
    ]);
  });

  it('are at most eight, and each only once', () => {
    const many = Array.from({ length: 12 }, (_, i) => view({ title: `v${i}`, rows: [i % 2 ? 'lu' : 'change'], order: 'name', measures: [i < 6 ? 'plots' : 'plotsPct'] }));
    const out = validateProposals({ views: many }, structure);
    expect(out.map((v) => v.title)).toEqual(['v0', 'v1', 'v6', 'v7']);
    const distinct = Array.from({ length: 12 }, (_, i) => view({ title: `w${i}`, filters: [{ column: 'elevation', op: 'atLeast', value: i }] }));
    expect(validateProposals({ views: distinct }, structure)).toHaveLength(8);
  });
});

describe('POST /analysis/proposals', () => {
  let ctx: TestContext;
  let client: AiClient = createFakeClient();
  const delegating: AiClient = { generate: (req: AiRequest) => client.generate(req) };
  let owner: { token: string; userId: string };
  let pid: string;

  const propose = (payload: unknown = { language: 'en' }, token = owner.token) =>
    ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/analysis/proposals`, headers: bearer(token), payload: payload as object });

  async function setUp(options: { enabled?: boolean; cep?: boolean } = {}) {
    client = createFakeClient();
    ctx = await makeContext({ aiVertexApiKey: 'test-key', aiConfigured: true }, { ai: { client: delegating } });
    owner = await setupPlatformAdmin(ctx.app);
    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { aiEnabled: true } })).statusCode).toBe(200);
    const project = await createProject(ctx.app, 'Secret Forest Project');
    pid = project.projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    if (options.enabled !== false) {
      const on = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/ai`, headers: bearer(owner.token), payload: { enabled: true } });
      expect(on.statusCode, on.body).toBe(200);
    }
    if (options.cep !== false) {
      const admin = bearer(project.adminToken);
      const cep = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...admin, 'content-type': 'application/zip' }, payload: realDemoCep() });
      expect(cep.statusCode, cep.body).toBe(200);
      const csv = ['id,lat,lon', '1,-12.3456,34.5678'].join('\n');
      expect((await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/plots.csv`, headers: { ...admin, 'content-type': 'text/csv' }, payload: csv })).statusCode).toBe(201);
      const records = [envelope({ recordKey: '1', operator: 'zorbagrill', summary: { collect_code_land_use_category: 'F', collect_text_id: '1', collect_text_comment: 'SECRET ANSWER' } })];
      expect((await batchRequest(ctx.app, pid, project.projectToken, records)).statusCode).toBe(200);
    }
  }

  afterEach(async () => {
    await ctx.app.close();
  });

  it('answers with checked views; the model is sent the survey\'s structure, never a plot, a coordinate, an answer or a person', async () => {
    await setUp();
    const fake = scripted([
      aiResponse({
        text: JSON.stringify({
          views: [
            { title: 'Land use', why: 'The plots by land use.', rows: ['land_use_category'], columns: [], measures: ['plots', 'plotsPct'], chart: 'hbars', filters: [], order: 'largest' },
            { title: 'Made up', why: 'x', rows: ['made_up_column'], columns: [], measures: ['plots'], chart: 'table', filters: [], order: 'name' },
          ],
        }),
        inputTokens: 1200,
        outputTokens: 300,
      }),
    ]);
    client = fake;
    const res = await propose({ language: 'fr' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().views.map((v: { title: string }) => v.title)).toEqual(['Land use']);
    const [req] = fake.requests;
    expect(req.responseSchema).toEqual(VIEWS_SCHEMA);
    expect(req.tools ?? []).toEqual([]);
    const sent = JSON.stringify(req);
    expect(sent).toContain('land_use_category');
    expect(sent).toContain('French');
    for (const secret of ['SECRET ANSWER', '-12.3456', '34.5678', 'zorbagrill', 'Secret Forest Project']) expect(sent).not.toContain(secret);
    // counted as a run, not listed in the AI tab
    const runs = await ctx.store.listAiRuns(pid, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: 'views', status: 'done', inputTokens: 1200, outputTokens: 300 });
    const listed = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/ai/runs`, headers: bearer(owner.token) });
    expect(listed.json().runs).toEqual([]);
  });

  it('works with the development fake', async () => {
    await setUp();
    const res = await propose();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().views.length).toBeGreaterThan(0);
  });

  it('counts against the day\'s follow-ups and questions', async () => {
    await setUp();
    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { aiFollowUpsPerDay: 1 } })).statusCode).toBe(200);
    expect((await propose()).statusCode).toBe(200);
    const second = await propose();
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'ai_daily_limit', limit: 'follow_ups' });
  });

  it('says why when the model gives nothing usable, and the run is failed', async () => {
    await setUp();
    client = scripted([aiResponse({ text: 'not json' })]);
    const res = await propose();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'ai_failed', code: 'invalid_answer' });
    expect((await ctx.store.listAiRuns(pid, 10))[0]).toMatchObject({ kind: 'views', status: 'failed', errorCode: 'invalid_answer' });
  });

  it('needs the project\'s AI switch on, a coordinator, a project file, and a known table and language', async () => {
    await setUp({ enabled: false });
    expect((await propose()).json()).toMatchObject({ error: 'ai_not_enabled' });
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/ai`, headers: bearer(owner.token), payload: { enabled: true } });
    expect((await propose({ language: 'xx' })).statusCode).toBe(400);
    expect((await propose({ language: 'en', table: 'nowhere' })).statusCode).toBe(400);
    const collector = await ctx.store.createUser({ username: 'col', passwordHash: 'x', email: null });
    await ctx.store.addMembership(pid, collector.id, 'operator');
    expect((await propose({ language: 'en' }, await ctx.store.createSession(collector.id))).statusCode).toBe(403);
    expect(await ctx.store.listAiRuns(pid, 10)).toEqual([]);
  });

  it('answers 404 without a project file', async () => {
    await setUp({ cep: false });
    expect((await propose()).json()).toMatchObject({ error: 'no_project_file' });
  });

  it('is off in the local mode (no AI there)', () => {
    expect(LOCAL_OFF_ROUTES).toContain('POST /v1/projects/:pid/analysis/proposals');
  });
});
