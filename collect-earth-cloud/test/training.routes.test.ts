import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LU = 'collect_code_land_use';
const COVER = 'collect_real_cover';
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

describe('training: calibration and learning plots', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  const people: Record<string, { token: string; userId: string }> = {};

  const call = (method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer' = 'operator') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
  };
  const csv = (ids: number[]) => `id,lat,lon\n${ids.map((i) => `${i},-10,${20 + i}`).join('\n')}\n`;
  const createSet = (filename: string, ids: number[], query = '') =>
    call('PUT', `/training-sets/${filename}${query}`, owner.token, csv(ids), { 'content-type': 'text/csv' });
  /** Each person's records: plot -> answers. */
  const send = async (who: string, answers: Record<number, Record<string, string>>, at = Date.now() - 60_000) => {
    const res = await batchRequest(
      ctx.app,
      pid,
      people[who].token,
      Object.entries(answers).map(([plot, summary]) => envelope({ recordKey: plot, operator: who, modifiedOn: at, activelySaved: true, summary })),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().results.every((r: { status: string }) => r.status === 'stored')).toBe(true);
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Training')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const n of ['ana', 'bo', 'cy']) await join(n);
    await call('PUT', '/csv-files/north.csv', owner.token, csv([1, 2, 3]), { 'content-type': 'text/csv' });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('a set: coordinators only, its plots its own, served to its participants, records kept apart', async () => {
    expect((await call('GET', '/training', people.ana.token)).statusCode).toBe(403);
    expect((await call('PUT', '/training-sets/c.csv', people.ana.token, csv([10]), { 'content-type': 'text/csv' })).statusCode).toBe(403);
    // Plots of a plot file, or none, are refused.
    const clash = await createSet('c.csv', [3, 10]);
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ code: 'in_plot_file', plots: ['3'] });
    expect((await call('PUT', '/training-sets/e.csv', owner.token, 'id,lat,lon\n', { 'content-type': 'text/csv' })).json().code).toBe('no_plots');

    const created = await createSet('calib.csv', [10, 11, 12], '?kind=calibration&name=Week%201');
    expect(created.statusCode, created.body).toBe(201);
    const setId = created.json().id as string;
    expect(created.json()).toMatchObject({ kind: 'calibration', name: 'Week 1', plotCount: 3, servedName: 'Calibration – calib.csv' });
    // A plot file cannot take a training plot afterwards.
    expect((await call('PUT', '/csv-files/south.csv', owner.token, csv([11, 20]), { 'content-type': 'text/csv' })).json().error).toBe('training_plot_in_file');

    expect((await call('PUT', `/training/${setId}/members`, owner.token, { userIds: [people.ana.userId, people.bo.userId] })).statusCode).toBe(200);
    const mine = (await call('GET', '/my-assignment', people.ana.token)).json().assignments as { filename: string; downloadPath: string; checksum: string; training?: { kind: string; attempt: number; freshSince: number | null } }[];
    const entry = mine.find((a) => a.training)!;
    expect(entry).toMatchObject({ filename: 'Calibration – calib.csv', training: { kind: 'calibration', attempt: 1, freshSince: null } });
    const file = await ctx.app.inject({ method: 'GET', url: entry.downloadPath, headers: bearer(people.ana.token) });
    expect(file.statusCode).toBe(200);
    expect(sha256(file.rawPayload)).toBe(entry.checksum);
    expect(file.body).toContain('12,-10,32');
    // Not a participant: no entry, no file.
    expect(((await call('GET', '/my-assignment', people.cy.token)).json().assignments as unknown[]).length).toBe(0);
    expect((await ctx.app.inject({ method: 'GET', url: entry.downloadPath, headers: bearer(people.cy.token) })).statusCode).toBe(404);

    await send('ana', { 10: { [LU]: 'F' }, 1: { [LU]: 'F' } });
    // The training plot's record is a training record; the plot file's is a record.
    expect((await ctx.store.listTrainingRecords(pid)).map((r) => r.recordKey)).toEqual(['10']);
    expect((await ctx.store.listRecordStates(pid)).map((r) => r.recordKey)).toEqual(['1']);

    // Deleting the set deletes its records too.
    expect((await call('DELETE', `/training/${setId}`, owner.token)).statusCode).toBe(200);
    expect(await ctx.store.listTrainingRecords(pid)).toEqual([]);
    expect((await call('GET', '/training', owner.token)).json().sets).toEqual([]);
  });

  it('calibration: spread and agreement, the agreed answers become golden, then a learning set scores each attempt', async () => {
    const setId = (await createSet('calib.csv', [10, 11], '?name=Calibration')).json().id as string;
    await call('PUT', `/training/${setId}/members`, owner.token, { userIds: ['ana', 'bo', 'cy'].map((n) => people[n].userId) });
    await send('ana', { 10: { [LU]: 'F', [COVER]: '50' }, 11: { [LU]: 'G' } });
    await send('bo', { 10: { [LU]: 'F', [COVER]: '52' }, 11: { [LU]: 'G' } });
    await send('cy', { 10: { [LU]: 'C', [COVER]: '90' }, 11: { [LU]: 'G' } });

    const view = (await call('GET', `/training/${setId}`, owner.token)).json();
    const lu = view.calibration.questions.find((q: { key: string }) => q.key === LU);
    expect(lu.pairs).toEqual({ compared: 6, agreeing: 4, rate: 4 / 6 });
    expect(lu.kappa).not.toBeNull();
    expect(view.calibration.plots[0].questions.find((q: { key: string }) => q.key === LU)).toMatchObject({ consensus: 'F', answers: [{ value: 'F', count: 2 }, { value: 'C', count: 1 }] });
    // Collectors see no one's answers in a calibration.
    const anaMine = (await call('GET', '/training/mine', people.ana.token)).json().sets;
    expect(anaMine).toEqual([expect.objectContaining({ kind: 'calibration', submitted: 2, plotCount: 2 })]);
    expect(anaMine[0].score).toBeUndefined();

    expect((await call('POST', `/training/${setId}/golden`, owner.token, { from: 'consensus' })).json()).toEqual({ plots: 2 });
    const note = await call('PUT', `/training/${setId}/golden/10`, owner.token, { answers: { [LU]: 'F', [COVER]: '52' }, note: 'Crowns cover half the plot.' });
    expect(note.statusCode, note.body).toBe(200);
    expect((await call('PATCH', `/training/${setId}`, owner.token, { kind: 'learning', passMark: 80 })).json()).toMatchObject({ kind: 'learning', passMark: 80, servedName: 'Learning – calib.csv' });

    // cy: 2 of 3 answers right (plot 10 land use wrong, cover 90 off).
    const cy = (await call('GET', '/training/mine', people.cy.token)).json().sets[0];
    expect(cy.score.answers).toEqual({ compared: 3, agreeing: 1, rate: 1 / 3 });
    expect(cy.score.passed).toBe(false);
    expect(cy.score.byPlot[0]).toMatchObject({ plot: '10', note: 'Crowns cover half the plot.', right: false });
    expect(cy.score.byPlot[0].questions).toEqual([
      expect.objectContaining({ key: LU, golden: 'F', given: 'C', right: false }),
      expect.objectContaining({ key: COVER, golden: '52', given: '90', right: false }),
    ]);
    expect((await call('GET', '/training/mine', people.ana.token)).json().sets[0].score.passed).toBe(true);

    // A new attempt for cy: the score starts again, the old one is kept, Collect Earth starts afresh.
    const before = Date.now();
    expect((await call('POST', `/training/${setId}/attempts`, owner.token, { userIds: [people.cy.userId] })).json()).toEqual({ started: 1 });
    let again = (await call('GET', '/training/mine', people.cy.token)).json().sets[0];
    expect(again.attempt.number).toBe(2);
    expect(again.submitted).toBe(0);
    expect(again.history).toEqual([expect.objectContaining({ number: 1, submitted: 2, passed: false })]);
    const entry = ((await call('GET', '/my-assignment', people.cy.token)).json().assignments as { training?: { attempt: number; freshSince: number } }[]).find((a) => a.training)!;
    expect(entry.training).toMatchObject({ kind: 'learning', attempt: 2 });
    expect(entry.training!.freshSince).toBeGreaterThanOrEqual(before);
    await send('cy', { 10: { [LU]: 'F', [COVER]: '55' }, 11: { [LU]: 'G' } }, Date.now() + 1000);
    again = (await call('GET', '/training/mine', people.cy.token)).json().sets[0];
    expect(again.score.answers.rate).toBe(1);
    expect(again.score.passed).toBe(true);
    // ana is still in attempt 1.
    expect((await call('GET', '/training/mine', people.ana.token)).json().sets[0].attempt.number).toBe(1);

    const list = (await call('GET', '/training', owner.token)).json().sets[0];
    expect(list.progress.find((p: { userId: string }) => p.userId === people.cy.userId)).toMatchObject({ attempt: 2, submitted: 2, accuracy: 1, passed: true });
    const audits = await ctx.store.listAudit(pid, { limit: 20, action: 'training.changed' });
    expect(audits.map((a) => String(a.details.change)).sort()).toEqual(['attempts', 'changed', 'created', 'golden', 'members']);
  });

  it('golden answers from one person\'s records (an expert)', async () => {
    const setId = (await createSet('learn.csv', [10, 11], '?kind=learning')).json().id as string;
    await call('PUT', `/training/${setId}/members`, owner.token, { userIds: [people.bo.userId] });
    await send('bo', { 10: { [LU]: 'F' }, 11: { [LU]: 'C' } });
    expect((await call('POST', `/training/${setId}/golden`, owner.token, { from: 'person', userId: people.bo.userId })).json()).toEqual({ plots: 2 });
    const golden = (await call('GET', `/training/${setId}`, owner.token)).json().golden as { plotKey: string; answers: Record<string, string> }[];
    expect(golden.map((g) => [g.plotKey, g.answers[LU]]).sort()).toEqual([
      ['10', 'F'],
      ['11', 'C'],
    ]);
  });
});
