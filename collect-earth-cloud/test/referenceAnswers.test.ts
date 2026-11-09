import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';
import { externalReferenceFigures, parseReferenceAnswers } from '../src/reference.js';
import type { Question } from '../src/surveyOutline.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

const question = (key: string, kind: 'choice' | 'number', label: string, options: { code: string; label: string }[] | null = null): Question =>
  ({ key, label, kind, options, help: null, excluded: false, multiple: false, calculated: false }) as Question;
const outline = new Map<string, Question>([
  [LAND_USE, question(LAND_USE, 'choice', 'Land Use 2025', [{ code: 'F', label: 'Forest' }, { code: 'G', label: 'Grassland' }])],
  [FOREST, question(FOREST, 'number', 'Percentage of Forest')],
  ['collect_text_id', { ...question('collect_text_id', 'choice', 'Id'), kind: 'text', excluded: true } as Question],
]);
const units = new Set(['1', '2', '3']);

describe('parseReferenceAnswers', () => {
  it('reads a CSV keyed by plot id, columns matched by question name, key or label; reports what does not match', () => {
    const csv = Buffer.from('plot,land_use_category,Percentage of Forest,colour\n1,F,80,red\n2,grassland,x,blue\n3,Z,,\n9,F,10,\n');
    const result = parseReferenceAnswers(csv, outline, units, 1);
    expect(result.columns).toEqual([
      { column: 'land_use_category', key: LAND_USE },
      { column: 'Percentage of Forest', key: FOREST },
    ]);
    expect(result.unmatchedColumns).toEqual(['colour']);
    // Labels are taken for their codes; unknown answers and non-numbers reported, with how often.
    expect(result.rows).toEqual([
      { plotKey: '1', answers: { [LAND_USE]: 'F', [FOREST]: '80' } },
      { plotKey: '2', answers: { [LAND_USE]: 'G' } },
    ]);
    expect(result.unmatchedValues).toEqual([
      { column: 'Percentage of Forest', value: 'x', count: 1 },
      { column: 'land_use_category', value: 'Z', count: 1 },
    ]);
    expect(result).toMatchObject({ unknownPlots: ['9'], unknownPlotCount: 1 });
  });

  it('reads a JSON array with a plot field and the questions as keys', () => {
    const result = parseReferenceAnswers([{ plot: 1, [LAND_USE]: 'G' }, { id: '2', forest_percentage: 30 }, 'junk'], outline, units, 1);
    expect(result.rows).toEqual([
      { plotKey: '1', answers: { [LAND_USE]: 'G' } },
      { plotKey: '2', answers: { [FOREST]: '30' } },
    ]);
  });
});

describe('externalReferenceFigures', () => {
  const rec = (recordKey: string, operator: string, summary: Record<string, string>, modifiedOn = 1) => ({ recordKey, operator, modifiedOn, activelySaved: true, deleted: false, summary });
  it('compares each person`s latest submitted record of a reference plot with its answers, per question, person and plot', () => {
    const answers = new Map<string, Record<string, string>>([
      ['1', { [LAND_USE]: 'F', [FOREST]: '80' }],
      ['2', { [LAND_USE]: 'G' }],
    ]);
    const records = [
      rec('1', 'ana', { [LAND_USE]: 'F', [FOREST]: '81', other: 'x' }),
      rec('1', 'ben', { [LAND_USE]: 'G', [FOREST]: '20' }, 1),
      rec('1', 'ben', { [LAND_USE]: 'G', [FOREST]: '20' }, 2),
      rec('2', 'ben', { [LAND_USE]: 'F' }),
      { ...rec('2', 'ana', { [LAND_USE]: 'F' }), activelySaved: false },
    ];
    const f = externalReferenceFigures({ records, info: null, units, copyHolders: new Map(), outline, referenceAnswers: answers })!;
    expect(f).toMatchObject({ plots: 2, assessed: 2, checks: 3 });
    expect(f.questions.map((q) => [q.key, q.compared, q.agreeing])).toEqual([
      [LAND_USE, 3, 1],
      [FOREST, 2, 1],
    ]);
    const ben = f.people.find((p) => p.username === 'ben')!;
    expect(ben.answers).toMatchObject({ compared: 3, agreeing: 0 });
    expect(ben.plots).toMatchObject({ compared: 2, agreeing: 0 });
    expect(f.people.find((p) => p.username === 'ana')!.answers).toMatchObject({ compared: 2, agreeing: 2 });
    expect(f.byPlot).toEqual([
      { plot: '1', records: 2, compared: 4, agreeing: 2 },
      { plot: '2', records: 1, compared: 1, agreeing: 0 },
    ]);
    expect(externalReferenceFigures({ records, info: null, units, copyHolders: new Map(), outline })).toBeNull();
  });
});

async function registerUser(app: FastifyInstance, pid: string, adminToken: string, username: string, role = 'operator') {
  const invite = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(adminToken), payload: { role, maxUses: 1 } });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
  return { userId: res.json().userId as string, token: res.json().token as string };
}

describe('reference answers from a file (routes)', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  let pid: string;
  let reviewer: { token: string };
  const admin = () => bearer(project.adminToken);
  const url = (path: string) => `/v1/projects/${pid}${path}`;
  const get = (path: string, headers = admin()) => ctx.app.inject({ method: 'GET', url: url(path), headers });
  const putCsv = (text: string) => ctx.app.inject({ method: 'PUT', url: url('/reference/answers'), headers: { ...admin(), 'content-type': 'text/csv' }, payload: text });
  const fresh = async (headers = admin()) => {
    for (let i = 0; i < 200; i++) {
      const body = (await get('/reference', headers)).json();
      if (!body.figures?.stale) return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'External reference');
    pid = project.projectId;
    await ctx.app.inject({ method: 'PUT', url: url('/cep'), headers: { ...admin(), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    const csv = ['id,lat,lon', ...Array.from({ length: 25 }, (_, i) => `${i + 1},0,0`)].join('\n');
    await ctx.app.inject({ method: 'PUT', url: url('/csv-files/plots.csv'), headers: { ...admin(), 'content-type': 'text/csv' }, payload: csv });
    reviewer = await registerUser(ctx.app, pid, project.adminToken, 'rita', 'reviewer');
    const records = [];
    for (let i = 1; i <= 25; i++) {
      records.push(envelope({ recordKey: `${i},1`, operator: 'ana', summary: { [LAND_USE]: 'F', collect_code_round: '1' } }));
      records.push(envelope({ recordKey: `${i},1`, operator: 'ben', summary: { [LAND_USE]: i <= 5 ? 'F' : 'G', collect_code_round: '1' } }));
    }
    expect((await batchRequest(ctx.app, pid, project.projectToken, records)).statusCode).toBe(200);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('takes a reference set, measures everyone against it, replaces it on a new upload and deletes it', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => `${i + 1},F,${i === 0 ? 'Q' : ''}`);
    const res = await putCsv(['plot,land_use_category,forest_percentage,unknown_column', ...rows, '99,F,,'].join('\n'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      plots: 25,
      unmatchedColumns: ['unknown_column'],
      unmatchedValues: [{ column: 'forest_percentage', value: 'Q', count: 1 }],
      unknownPlots: ['99'],
    });

    const body = await fresh();
    expect(body.external).toMatchObject({ count: 25 });
    const external = body.figures.external;
    expect(external).toMatchObject({ plots: 25, assessed: 25, checks: 50 });
    const ben = external.people.find((p: { username: string }) => p.username === 'ben');
    expect(ben.answers).toMatchObject({ compared: 25, agreeing: 5, rate: 0.2 });
    expect(external.byPlot).toHaveLength(25);

    // Reviewers see the figures per question only.
    const forReviewer = await fresh(bearer(reviewer.token));
    expect(forReviewer.figures.external.questions[0]).toMatchObject({ key: LAND_USE, compared: 50, agreeing: 30 });
    expect(forReviewer.figures.external).not.toHaveProperty('people');
    expect(forReviewer.figures.external).not.toHaveProperty('byPlot');
    expect((await ctx.app.inject({ method: 'PUT', url: url('/reference/answers'), headers: { ...bearer(reviewer.token), 'content-type': 'text/csv' }, payload: 'plot,land_use_category\n1,F\n' })).statusCode).toBe(403);

    // A new upload replaces the set.
    expect((await putCsv('plot,land_use_category\n1,G\n2,G\n')).json()).toMatchObject({ plots: 2 });
    expect((await fresh()).figures.external).toMatchObject({ plots: 2 });

    // JSON too.
    const json = await ctx.app.inject({ method: 'PUT', url: url('/reference/answers'), headers: admin(), payload: [{ plot: '3', land_use_category: 'G' }] });
    expect(json.json()).toMatchObject({ plots: 1 });

    expect((await ctx.app.inject({ method: 'DELETE', url: url('/reference/answers'), headers: admin() })).statusCode).toBe(204);
    const after = await fresh();
    expect(after.external).toMatchObject({ count: 0 });
    expect(after.figures.external).toBeUndefined();
    expect(JSON.stringify((await get('/activity?kind=files')).json())).toContain('"external"');
  });

  it('refuses a file with nothing it can use', async () => {
    const res = await putCsv('plot,colour\n1,red\n');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_request', unmatchedColumns: ['colour'] });
    expect((await putCsv('nothing')).statusCode).toBe(400);
  });
});
