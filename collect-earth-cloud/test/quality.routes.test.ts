import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';
import { WorkerRestartedError } from '../src/qualityService.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';
/** A number from the plot file (collectearth:fromcsv): excluded, never compared. */
const SLOPE = 'collect_real_slope';

describe('quality routes', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  let pid: string;
  const admin = () => bearer(project.adminToken);
  const url = (path: string) => `/v1/projects/${pid}${path}`;
  const get = (path: string, headers = admin()) => ctx.app.inject({ method: 'GET', url: url(path), headers });
  const send = (method: 'PUT' | 'POST' | 'DELETE', path: string, payload?: unknown, headers = admin()) =>
    ctx.app.inject({ method, url: url(path), headers, payload: payload as object });
  /** GET /quality until it is no longer stale (the newer figures are computed behind a stale answer). */
  const fresh = async () => {
    for (let i = 0; i < 200; i++) {
      const body = (await get('/quality')).json();
      if (!body.stale) {
        return body;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };

  /** n plots of the added round: ana's first assessment and ben's check; land use differs on the last `differ`. */
  const collect = async (n: number, differ: number, slope = (_i: number) => ['10', '10']) => {
    const records = [];
    for (let i = 1; i <= n; i++) {
      const [s1, s2] = slope(i);
      records.push(envelope({ recordKey: `${i},1`, operator: 'ana', summary: { [LAND_USE]: 'F', [FOREST]: s1, [SLOPE]: '3', collect_code_round: '1' } }));
      records.push(
        envelope({
          recordKey: `${i},2`,
          operator: 'ben',
          modifiedOn: Date.UTC(2026, 9, 28),
          summary: { [LAND_USE]: i > n - differ ? 'G' : 'F', [FOREST]: s2, [SLOPE]: '4', collect_code_round: '2' },
        }),
      );
    }
    const res = await batchRequest(ctx.app, pid, project.projectToken, records);
    expect(res.statusCode, res.body).toBe(200);
  };

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Quality');
    pid = project.projectId;
    const put = await ctx.app.inject({ method: 'PUT', url: url('/cep'), headers: { ...admin(), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    expect(put.json().round.state).toBe('added');
    const csv = ['id,lat,lon', ...Array.from({ length: 30 }, (_, i) => `${i + 1},0,0`)].join('\n');
    const up = await ctx.app.inject({ method: 'PUT', url: url('/csv-files/plots.csv'), headers: { ...admin(), 'content-type': 'text/csv' }, payload: csv });
    expect(up.statusCode, up.body).toBe(201);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('GET /quality: the figures, with the served survey\'s questions, and no decisions or notes yet', async () => {
    await collect(25, 5);
    const res = await get('/quality');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ plotsChecked: 25, plotsDiffering: 5, decisions: [], notes: [], settings: { margins: {} } });
    // Labels come from the outline of the served project file; round (its key) and the
    // plot file's slope (which differs on every plot) are never compared.
    expect(body.questions).toEqual([
      { key: FOREST, label: 'Land cover - Percentage of Forest', kind: 'number', compared: 25, agreeing: 25, rate: 1, margin: 10 },
      { key: LAND_USE, label: 'Land Use 2025', kind: 'choice', compared: 25, agreeing: 20, rate: 0.8 },
    ]);
    expect(body.confusions).toEqual([{ key: LAND_USE, first: 'F', check: 'G', count: 5, plots: ['21', '22', '23', '24', '25'] }]);
    expect(body.differences[0]).toEqual({
      plot: '21',
      first: { operator: 'ana', recordKey: '21,1' },
      check: { operator: 'ben', recordKey: '21,2' },
      fields: [{ key: LAND_USE, first: 'F', check: 'G' }],
    });
  });

  it('GET /quality compares the answers of records sent with null for their empty attributes, as Collect Earth sends them', async () => {
    const res = await batchRequest(ctx.app, pid, project.projectToken, [
      envelope({ recordKey: '1,1', operator: 'ana', summary: { [LAND_USE]: 'F', [FOREST]: null, collect_text_comments: null } as never }),
      envelope({ recordKey: '1,2', operator: 'ben', summary: { [LAND_USE]: 'G', [FOREST]: null, collect_text_comments: null } as never }),
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const body = await fresh();
    expect(body).toMatchObject({ plotsChecked: 1, plotsDiffering: 1 });
    expect(body.questions).toEqual([{ key: LAND_USE, label: 'Land Use 2025', kind: 'choice', compared: 1, agreeing: 0, rate: null }]);
    expect(body.differences[0].fields).toEqual([{ key: LAND_USE, first: 'F', check: 'G' }]);
  });

  it('GET /quality says when the figures were computed, and that they are not stale', async () => {
    await collect(2, 1);
    const before = Date.now();
    const body = (await get('/quality')).json();
    expect(body.stale).toBe(false);
    expect(body.computedAt).toBeGreaterThanOrEqual(before);
    expect(body.computedAt).toBeLessThanOrEqual(Date.now());
  });

  it('data problems: a plot in no file, a key with more parts than the survey, two main assessments', async () => {
    await batchRequest(ctx.app, pid, project.projectToken, [
      envelope({ recordKey: '99,1', operator: 'ana', summary: {} }),
      envelope({ recordKey: '3,1,7', operator: 'ana', summary: {} }),
      envelope({ recordKey: '4,1', operator: 'ana', summary: {} }),
      envelope({ recordKey: '4,1', operator: 'carl', summary: {} }),
    ]);
    const body = (await get('/quality')).json();
    expect(body.problems).toEqual([
      { kind: 'extra_key_parts', plot: '3', recordKey: '3,1,7', operator: 'ana' },
      { kind: 'two_main', plot: '4', recordKey: '4,1', operator: 'ana' },
      { kind: 'two_main', plot: '4', recordKey: '4,1', operator: 'carl' },
      { kind: 'no_plot', plot: '99', recordKey: '99,1', operator: 'ana' },
    ]);
    expect(body.problemsTotal).toBe(4);
  });

  it('the figures are cached, and a new record, a changed record or a margin changes them', async () => {
    await collect(20, 0, (i) => (i === 1 ? ['100', '91'] : ['10', '10']));
    const first = (await get('/quality')).json();
    expect(first.plotsChecked).toBe(20);
    expect(first.questions.find((q: { key: string }) => q.key === FOREST)).toMatchObject({ agreeing: 20, margin: 10 });
    expect((await get('/quality')).json()).toEqual(first);

    await batchRequest(ctx.app, pid, project.projectToken, [
      envelope({ recordKey: '21,1', operator: 'ana', summary: { [LAND_USE]: 'F' } }),
      envelope({ recordKey: '21,2', operator: 'ben', summary: { [LAND_USE]: 'C' } }),
    ]);
    // Computed under two minutes ago: served at once, marked stale, and brought up to date behind.
    const stale = (await get('/quality')).json();
    expect(stale).toMatchObject({ stale: true, plotsChecked: 20, computedAt: first.computedAt });
    const second = await fresh();
    expect(second).toMatchObject({ plotsChecked: 21, plotsDiffering: 1 });
    expect(second.computedAt).toBeGreaterThanOrEqual(first.computedAt);

    expect((await send('PUT', '/quality/settings', { margins: { [FOREST]: 5 } })).statusCode).toBe(200);
    const third = await fresh();
    expect(third.settings).toEqual({ margins: { [FOREST]: 5 } });
    expect(third.questions.find((q: { key: string }) => q.key === FOREST)).toMatchObject({ agreeing: 19, margin: 5 });
    expect(third.plotsDiffering).toBe(2);

    // A changed record (same key, later) is a new version too.
    await batchRequest(ctx.app, pid, project.projectToken, [
      envelope({ recordKey: '21,2', operator: 'ben', modifiedOn: 5000, summary: { [LAND_USE]: 'F' } }),
    ]);
    expect((await fresh()).plotsDiffering).toBe(1);
  });

  it('PUT /quality/settings: margins 0-100, only for number questions of the served survey', async () => {
    const ok = await send('PUT', '/quality/settings', { margins: { [FOREST]: 0, collect_integer_cropland_percentage: 100 } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ margins: { [FOREST]: 0, collect_integer_cropland_percentage: 100 } });
    for (const payload of [
      {},
      { margins: [] },
      { margins: 5 },
      { margins: { [LAND_USE]: 5 } },
      { margins: { collect_code_round: 5 } },
      { margins: { collect_real_nothing: 5 } },
      { margins: { [SLOPE]: 5 } },
      { margins: { [FOREST]: 101 } },
      { margins: { [FOREST]: -1 } },
      { margins: { [FOREST]: '5' } },
      { margins: { [FOREST]: null } },
    ]) {
      const res = await send('PUT', '/quality/settings', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error).toBe('bad_request');
    }
    // Nothing refused was stored.
    expect((await get('/quality')).json().settings).toEqual({ margins: { [FOREST]: 0, collect_integer_cropland_percentage: 100 } });
  });

  it('decisions: set, replace, list, delete, by plot unit', async () => {
    await collect(3, 1);
    const set = await send('PUT', '/quality/decisions/3', { decision: 'check', comment: '  the check saw the river  ' });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject({ plot: '3', decision: 'check', comment: 'the check saw the river', decidedBy: null });
    expect(typeof set.json().decidedAt).toBe('number');
    const odd = 'plot/with ,odd chars';
    expect((await send('PUT', `/quality/decisions/${encodeURIComponent(odd)}`, { decision: 'recheck' })).json()).toMatchObject({ plot: odd, comment: null });
    expect((await send('PUT', '/quality/decisions/3', { decision: 'first', comment: '' })).json()).toMatchObject({ decision: 'first', comment: null });

    const listed = (await get('/quality')).json().decisions;
    expect(listed.map((d: { plot: string; decision: string }) => [d.plot, d.decision])).toEqual([
      ['3', 'first'],
      [odd, 'recheck'],
    ]);
    expect((await send('DELETE', '/quality/decisions/3')).statusCode).toBe(204);
    expect((await send('DELETE', '/quality/decisions/3')).statusCode).toBe(404);
    expect((await get('/quality')).json().decisions.map((d: { plot: string }) => d.plot)).toEqual([odd]);
  });

  it('decisions: refuses an unknown decision, a long comment or a long plot', async () => {
    for (const [plot, payload] of [
      ['3', {}],
      ['3', { decision: 'both' }],
      ['3', { decision: 'first', comment: 5 }],
      ['3', { decision: 'first', comment: 'x'.repeat(2001) }],
      ['x'.repeat(1001), { decision: 'first' }],
    ] as const) {
      const res = await send('PUT', `/quality/decisions/${plot}`, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await send('PUT', '/quality/decisions/3', { decision: 'first', comment: 'x'.repeat(2000) })).statusCode).toBe(200);
    // DELETE checks the plot the same way.
    expect((await send('DELETE', `/quality/decisions/${'x'.repeat(1001)}`)).statusCode).toBe(400);
  });

  it('a plot id of 1000 three-byte characters still reaches the route', async () => {
    const plot = '€'.repeat(1000); // 9000 characters once URL-encoded
    const res = await send('PUT', `/quality/decisions/${encodeURIComponent(plot)}`, { decision: 'first' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().plot).toBe(plot);
    expect((await send('DELETE', `/quality/decisions/${encodeURIComponent(plot)}`)).statusCode).toBe(204);
  });

  it('a decision made with a session names who made it', async () => {
    const invite = await send('POST', '/invites', { role: 'admin', maxUses: 1 });
    const reg = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'coord', password: 'password12', inviteToken: invite.json().inviteToken } });
    const session = bearer(reg.json().token);
    expect((await send('PUT', '/quality/decisions/1', { decision: 'first' }, session)).json().decidedBy).toBe('coord');
    expect((await send('POST', '/quality/notes', { questionKey: LAND_USE, text: 'Look at the trees.' }, session)).json().updatedBy).toBe('coord');
    // The account goes; what it decided and wrote stays, without a name.
    await ctx.store.deleteUser(reg.json().userId);
    const body = (await get('/quality')).json();
    expect(body.decisions).toMatchObject([{ plot: '1', decision: 'first', decidedBy: null }]);
    expect(body.notes).toMatchObject([{ text: 'Look at the trees.', updatedBy: null }]);
  });

  it('guidance notes: create, list, update, delete', async () => {
    const created = await send('POST', '/quality/notes', { questionKey: LAND_USE, firstValue: 'F', checkValue: 'G', text: ' Grassland with scattered trees is not forest. ' });
    expect(created.statusCode, created.body).toBe(201);
    const note = created.json();
    expect(note).toMatchObject({ questionKey: LAND_USE, firstValue: 'F', checkValue: 'G', text: 'Grassland with scattered trees is not forest.', updatedBy: null });
    const general = (await send('POST', '/quality/notes', { questionKey: FOREST, text: 'Count tree cover from above, not from the ground.' })).json();
    expect(general).toMatchObject({ firstValue: null, checkValue: null });

    expect((await get('/quality/notes')).json().notes.map((n: { id: string }) => n.id)).toEqual([note.id, general.id]);
    const updated = await send('PUT', `/quality/notes/${note.id}`, { questionKey: LAND_USE, firstValue: 'F', checkValue: 'S', text: 'Shrubland, not forest.' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: note.id, checkValue: 'S', text: 'Shrubland, not forest.' });
    expect((await get('/quality')).json().notes).toHaveLength(2);

    expect((await send('DELETE', `/quality/notes/${note.id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `/quality/notes/${note.id}`)).statusCode).toBe(404);
    expect((await send('PUT', `/quality/notes/${note.id}`, { questionKey: LAND_USE, text: 'x' })).statusCode).toBe(404);
    expect((await send('PUT', '/quality/notes/not-an-id', { questionKey: LAND_USE, text: 'x' })).statusCode).toBe(404);
    expect((await get('/quality/notes')).json().notes.map((n: { id: string }) => n.id)).toEqual([general.id]);
  });

  it('guidance notes: refuses a note without a question or text, or too long', async () => {
    for (const payload of [
      {},
      { questionKey: LAND_USE },
      { questionKey: LAND_USE, text: '   ' },
      { questionKey: LAND_USE, text: 'x'.repeat(2001) },
      { questionKey: '', text: 'x' },
      { questionKey: 5, text: 'x' },
      { questionKey: LAND_USE, text: 'x', firstValue: 5 },
      { questionKey: LAND_USE, text: 'x', checkValue: 'y'.repeat(1001) },
    ]) {
      const res = await send('POST', '/quality/notes', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const note = (await send('POST', '/quality/notes', { questionKey: LAND_USE, text: 'x'.repeat(2000) })).json();
    expect((await send('PUT', `/quality/notes/${note.id}`, { questionKey: LAND_USE, text: '' })).statusCode).toBe(400);
    expect((await get('/quality/notes')).json().notes).toHaveLength(1);
  });

  it('the export says which answer the coordinator took: yes, no, recheck or blank', async () => {
    await collect(3, 3);
    await send('PUT', '/quality/decisions/1', { decision: 'first' });
    await send('PUT', '/quality/decisions/2', { decision: 'check' });
    await send('PUT', '/quality/decisions/3', { decision: 'recheck' });
    await batchRequest(ctx.app, pid, project.projectToken, [envelope({ recordKey: '4,1', operator: 'ana', summary: {} })]);
    const res = await get('/export.csv');
    const lines = res.rawPayload.subarray(3).toString('utf8').split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toMatch(/^record_key,plot,round,assessment,final,operator,/);
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 8).join(','))).toEqual([
      '"1,1",1,1,main,yes,ana,true',
      '"1,2",1,2,check,no,ben,true',
      '"2,1",2,1,main,no,ana,true',
      '"2,2",2,2,check,yes,ben,true',
      '"3,1",3,1,main,recheck,ana,true',
      '"3,2",3,2,check,recheck,ben,true',
      '"4,1",4,1,main,,ana,true',
    ]);
  });

  it('an operator gets 403 on every quality route', async () => {
    const op = bearer(project.projectToken);
    const cases: ['GET' | 'PUT' | 'POST' | 'DELETE', string, unknown][] = [
      ['GET', '/quality', undefined],
      ['PUT', '/quality/settings', { margins: {} }],
      ['PUT', '/quality/decisions/1', { decision: 'first' }],
      ['DELETE', '/quality/decisions/1', undefined],
      ['GET', '/quality/notes', undefined],
      ['POST', '/quality/notes', { questionKey: LAND_USE, text: 'x' }],
      ['PUT', '/quality/notes/00000000-0000-0000-0000-000000000000', { questionKey: LAND_USE, text: 'x' }],
      ['DELETE', '/quality/notes/00000000-0000-0000-0000-000000000000', undefined],
    ];
    for (const [method, path, payload] of cases) {
      const res = await ctx.app.inject({ method, url: url(path), headers: op, payload: payload as object });
      expect(res.statusCode, `${method} ${path}`).toBe(403);
    }
    expect(await ctx.store.listQualityDecisions(pid)).toEqual([]);
    expect(await ctx.store.listGuidanceNotes(pid)).toEqual([]);
  });

  it('figures that fail give a plain message: no stack, path or query reaches the client', async () => {
    await collect(2, 1);
    const leaky = new Error('relation "records" does not exist: SELECT summary FROM records WHERE project_id = $1');
    leaky.stack = `${leaky.message}\n    at listRecordSummaries (C:\\srv\\collect-earth-cloud\\src\\store\\postgres.ts:812:11)`;
    ctx.store.listRecordSummaries = async () => {
      throw leaky;
    };
    for (const path of ['/quality', '/quality/team-report']) {
      const res = await get(path);
      expect(res.statusCode, path).toBe(500);
      expect(res.json()).toEqual({ error: 'quality_failed', reason: 'The quality figures could not be worked out. Try again in a few minutes.' });
      expect(res.body).not.toMatch(/SELECT|relation|postgres\.ts|\bat\b|\\/);
    }
  });

  it('a job whose worker was restarted because of another is answered busy, to try again', async () => {
    await collect(2, 1);
    ctx.store.listRecordSummaries = async () => {
      throw new WorkerRestartedError('another job took too long');
    };
    const res = await get('/quality');
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('10');
    expect(res.json().error).toBe('busy');
  });
});
