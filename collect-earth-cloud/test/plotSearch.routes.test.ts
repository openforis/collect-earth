import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoCep, idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

describe('plot search: GET /plots/search, GET /plots/:plot', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  let rita: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let ben: { token: string; userId: string };
  let plotsFile: string;
  let extraFile: string;

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string, userId: (await ctx.store.getUserByUsername(username))!.id };
  };
  const t0 = Date.UTC(2026, 9, 1, 9);
  const main = (plot: number | string, operator: string, seconds: number, landUse = 'F', extra = {}) =>
    envelope({ recordKey: `${plot},1`, operator, modifiedOn: t0 + seconds * 1000, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '1' }, ...extra });
  const check = (plot: number | string, operator: string, landUse: string) =>
    envelope({ recordKey: `${plot},2`, operator, modifiedOn: t0 + 5_000_000, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '2' } });
  /** The quality figures worked out (the page only reads those at hand). */
  const figures = async () => {
    for (let i = 0; i < 200; i++) {
      const res = await call('GET', '/quality', owner.token);
      expect(res.statusCode, res.body).toBe(200);
      if (!res.json().stale) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Search');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    rita = await join('rita', 'reviewer');
    maria = await join('maria', 'operator');
    ben = await join('ben', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const csv = (name: string, ids: (number | string)[]) =>
      call('PUT', `/csv-files/${name}`, owner.token, ['id,lat,lon', ...ids.map((id, i) => `${id},${-10 - i / 10},${20 + i / 10}`)].join('\n'), { 'content-type': 'text/csv' });
    plotsFile = (await csv('plots.csv', Array.from({ length: 120 }, (_, i) => i + 1))).json().id;
    // Plot 1 is in both files; the second is divided: maria holds 1, ben a copy of it.
    extraFile = (await csv('extra.csv', [1, 'A-7', 'a-8'])).json().id;
    await ctx.store.setAssignments(pid, [{ userId: maria.userId, csvFileId: plotsFile }]);
    await ctx.store.setDivision(pid, extraFile, { mode: 'manual' }, [
      { plotKey: '1', userId: maria.userId, overlap: false },
      { plotKey: '1', userId: ben.userId, overlap: true },
    ]);
    const res = await batchRequest(ctx.app, pid, projectToken, [
      main(1, 'maria', 0),
      check(1, 'ben', 'G'),
      main(2, 'maria', 5),
      main(3, 'rita', 100),
      // A draft of plot 10.
      main(10, 'maria', 200, 'F', { activelySaved: false }),
    ]);
    expect(res.statusCode, res.body).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('finds plots by the start of their id, at most 20, the shortest first, with their files; coordinators and reviewers', async () => {
    const res = await call('GET', '/plots/search?q=1', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.plots).toHaveLength(20);
    expect(body.more).toBe(true);
    expect(body.plots.slice(0, 3).map((p: { plot: string }) => p.plot)).toEqual(['1', '10', '11']);
    expect(body.plots[0]).toEqual({
      plot: '1',
      name: '1',
      files: [
        { id: plotsFile, filename: 'plots.csv' },
        { id: extraFile, filename: 'extra.csv' },
      ],
    });
    const few = (await call('GET', '/plots/search?q=12', rita.token)).json();
    expect(few).toEqual({ plots: ['12', '120'].map((plot) => ({ plot, name: plot, files: [{ id: plotsFile, filename: 'plots.csv' }] })), more: false });
    // Case is ignored.
    expect((await call('GET', '/plots/search?q=a-', owner.token)).json().plots.map((p: { plot: string }) => p.plot)).toEqual(['A-7', 'a-8']);
    expect((await call('GET', '/plots/search?q=999', owner.token)).json()).toEqual({ plots: [], more: false });
    expect((await call('GET', `/plots/search?q=${'x'.repeat(1001)}`, owner.token)).statusCode).toBe(400);
    // The index is built once and kept while the files stay the same.
    for (const q of ['2', '3', '4']) await call('GET', `/plots/search?q=${q}`, owner.token);
    expect((await call('GET', '/plots/search?q=200', owner.token)).json().plots).toEqual([]);
    await call('PUT', '/csv-files/more.csv', owner.token, 'id,lat,lon\n200,1,1', { 'content-type': 'text/csv' });
    expect((await call('GET', '/plots/search?q=200', owner.token)).json().plots.map((p: { plot: string }) => p.plot)).toEqual(['200']);
  });

  it('a plot: its files and people, every record with its round and answers, decision, flags and place', async () => {
    let res = await call('GET', '/plots/1', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    let body = res.json();
    expect(body).toMatchObject({
      plot: '1',
      name: '1',
      files: [
        { id: plotsFile, filename: 'plots.csv', divided: false, main: ['maria'], copies: [] },
        { id: extraFile, filename: 'extra.csv', divided: true, main: ['maria'], copies: ['ben'] },
      ],
      decision: null,
      ownPlot: false,
      // No figures at hand yet: the page never works them out.
      flags: null,
      differences: null,
      figures: null,
      place: { lat: -10, lon: 20, name: '1' },
    });
    expect(body.records).toEqual([
      { operator: 'maria', recordKey: '1,1', round: '1', assessment: 'main', submitted: true, deleted: false, modifiedOn: t0, receivedAt: expect.any(Number), answers: { [LAND_USE]: 'F', [FOREST]: '50' } },
      { operator: 'ben', recordKey: '1,2', round: '2', assessment: 'check', submitted: true, deleted: false, modifiedOn: t0 + 5_000_000, receivedAt: expect.any(Number), answers: { [LAND_USE]: 'G', [FOREST]: '50' } },
    ]);
    expect(body.questions.map((q: { key: string }) => q.key)).toEqual(expect.arrayContaining([LAND_USE, FOREST]));
    expect(body.labels[LAND_USE]).toBe('Land Use 2025');
    expect(body.options[LAND_USE].length).toBeGreaterThan(0);
    // Only this plot's records: plot 10's draft is on its own page.
    expect((await call('GET', '/plots/10', owner.token)).json().records).toEqual([expect.objectContaining({ operator: 'maria', submitted: false, round: '1' })]);
    expect((await call('GET', '/plots/1', owner.token)).json().records.map((r: { recordKey: string }) => r.recordKey)).not.toContain('10,1');

    // With the figures worked out (elsewhere) and a decision.
    await figures();
    const decided = await call('PUT', '/quality/decisions/1', rita.token, { decision: 'check', comment: 'G is right' });
    expect(decided.statusCode, decided.body).toBe(200);
    body = (await call('GET', '/plots/1', rita.token)).json();
    expect(body.decision).toMatchObject({ plot: '1', decision: 'check', comment: 'G is right', decidedBy: 'rita', byAssessor: false });
    expect(body.decision).not.toHaveProperty('seen');
    expect(body.figures).toMatchObject({ computedAt: expect.any(Number), stale: false });
    expect(body.flags).toEqual([]);
    expect(body.differences).toEqual([{ plot: '1', first: { operator: 'maria', recordKey: '1,1' }, check: { operator: 'ben', recordKey: '1,2' }, fields: [{ key: LAND_USE, first: 'F', check: 'G' }] }]);
    // Plot 2: maria's first assessment 5 s after plot 1, very fast.
    res = await call('GET', '/plots/2', owner.token);
    expect(res.json().flags).toEqual([expect.objectContaining({ kind: 'very_fast', plot: '2', operator: 'maria' })]);
    // A reviewer's own plot: someone else decides it.
    expect((await call('GET', '/plots/3', rita.token)).json().ownPlot).toBe(true);
    expect((await call('GET', '/plots/3', owner.token)).json().ownPlot).toBe(false);
    expect((await call('PUT', '/quality/decisions/3', rita.token, { decision: 'first' })).statusCode).toBe(409);
    // A plot in no plot file is not found.
    expect((await call('GET', '/plots/999', owner.token)).statusCode).toBe(404);
  });

  it('collectors and project tokens get 403 on both routes; another project\'s coordinator 404', async () => {
    for (const token of [maria.token, ben.token, projectToken]) {
      expect((await call('GET', '/plots/search?q=1', token)).statusCode).toBe(403);
      expect((await call('GET', '/plots/1', token)).statusCode).toBe(403);
    }
    const other = await createProject(ctx.app, 'Other');
    for (const path of ['/plots/search?q=1', '/plots/1']) {
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}${path}`, headers: bearer(other.adminToken) });
      expect(res.statusCode, path).toBe(404);
    }
    // The other project has no plots: nothing of this one shows there.
    const theirs = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other.projectId}/plots/search?q=1`, headers: bearer(other.adminToken) });
    expect(theirs.json()).toEqual({ plots: [], more: false });
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other.projectId}/plots/1`, headers: bearer(other.adminToken) })).statusCode).toBe(404);
  });

  it('an own round: the plot unit with its round, its check found under the reassessment code', async () => {
    // A project of its own, with the demo survey (its own round key).
    const own = await createProject(ctx.app, 'Own round');
    pid = own.projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    expect((await call('PUT', '/cep', owner.token, demoCep(), { 'content-type': 'application/zip' })).json().round).toMatchObject({ state: 'own', reassessmentCode: '2' });
    await call('PUT', '/csv-files/own.csv', owner.token, 'id,round,lat,lon\n5,1,1.5,2.5\n50,1,1,1', { 'content-type': 'text/csv' });
    await batchRequest(ctx.app, pid, own.projectToken, [
      envelope({ recordKey: '5,1', operator: 'ana', modifiedOn: t0, summary: { [LAND_USE]: 'F' } }),
      envelope({ recordKey: '5,2', operator: 'ben', modifiedOn: t0 + 1000, summary: { [LAND_USE]: 'G' } }),
      envelope({ recordKey: '50,1', operator: 'ana', modifiedOn: t0, summary: { [LAND_USE]: 'C' } }),
    ]);
    const found = (await call('GET', '/plots/search?q=5', owner.token)).json();
    expect(found.plots.map((p: { plot: string }) => p.plot)).toEqual(['5,1', '50,1']);
    const page = (await call('GET', `/plots/${encodeURIComponent('5,1')}`, owner.token)).json();
    expect(page.records.map((r: { recordKey: string; round: string; assessment: string }) => [r.recordKey, r.round, r.assessment])).toEqual([
      ['5,1', '1', 'main'],
      ['5,2', '2', 'check'],
    ]);
    expect(page.place).toEqual({ lat: 1.5, lon: 2.5, name: '5,1' });
  });
});
