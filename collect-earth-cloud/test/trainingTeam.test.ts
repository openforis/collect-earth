import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { idOnlyCep, integerIdCep } from './fixtures/cep.js';

// Training the team before the work (docs/plans/2026-11-17-training-the-team.md): a training for everyone, before the
// project is published, on copies of the project's plots, finished with its results kept and its answers deleted.

const LU = 'collect_code_land_use';

describe('training the team', () => {
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
  const csv = (ids: (number | string)[]) => `id,lat,lon\n${ids.map((i, n) => `${i},-10,${20 + n}`).join('\n')}\n`;
  const createSet = (filename: string, ids: (number | string)[], query = '') =>
    call('PUT', `/training-sets/${filename}${query}`, owner.token, csv(ids), { 'content-type': 'text/csv' });
  const sendAs = (who: string, plots: string[], at = Date.now() - 60_000) =>
    batchRequest(ctx.app, pid, people[who].token, plots.map((plot) => envelope({ recordKey: plot, operator: who, modifiedOn: at, activelySaved: true, summary: { [LU]: 'F' } })));
  const statuses = (res: { json: () => { results: { status: string }[] } }) => res.json().results.map((r) => r.status);
  const myAssignment = async (who: string) =>
    (await call('GET', '/my-assignment', people[who].token)).json() as {
      assignments: { filename: string; training?: unknown }[];
      finishedTraining?: { files: string[]; plots: string[] };
    };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Training the team')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const n of ['ana', 'bo']) await join(n);
    await call('PUT', '/csv-files/north.csv', owner.token, csv([1, 2, 3]), { 'content-type': 'text/csv' });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('a set for everyone: every collector and reviewer, whoever joins later included, never the coordinators', async () => {
    const created = await createSet('day1.csv', [10, 11], '?everyone=true&name=Day%201');
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ everyone: true, finishedAt: null });
    expect(created.json().participants.map((p: { username: string }) => p.username).sort()).toEqual(['ana', 'bo']);
    await join('cy');
    await join('rita', 'reviewer');
    for (const who of ['ana', 'cy', 'rita']) {
      expect((await myAssignment(who)).assignments.map((a) => a.filename), who).toEqual(['Calibration – day1.csv']);
    }
    const list = (await call('GET', '/training', owner.token)).json();
    expect(list.sets[0].participants.map((p: { username: string }) => p.username).sort()).toEqual(['ana', 'bo', 'cy', 'rita']);
    // Chosen people instead: no longer everyone
    const setId = created.json().id as string;
    expect((await call('PUT', `/training/${setId}/members`, owner.token, { userIds: [people.ana.userId] })).statusCode).toBe(200);
    expect((await myAssignment('cy')).assignments).toEqual([]);
    expect((await call('GET', '/training', owner.token)).json().sets[0]).toMatchObject({ everyone: false });
    // and everyone again
    expect((await call('PUT', `/training/${setId}/members`, owner.token, { everyone: true })).statusCode).toBe(200);
    expect((await myAssignment('cy')).assignments).toHaveLength(1);
  });

  it('a project still being set up takes the records of a training running, and only those', async () => {
    await createSet('day1.csv', [10, 11], '?everyone=true');
    await ctx.store.setProjectStatus(pid, 'draft');
    // Training records only: stored
    expect(statuses(await sendAs('ana', ['10']))).toEqual(['stored']);
    // With a plot of the project: the training's stored, the other kept by Collect Earth for later
    const mixed = await sendAs('ana', ['11', '1']);
    expect(mixed.statusCode).toBe(200);
    expect(statuses(mixed)).toEqual(['stored', 'error']);
    expect(mixed.json().results[1].reason).toMatch(/still being set up/);
    // None of the training's: refused whole, as before
    const refused = await sendAs('ana', ['1']);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('project_draft');
    expect((await ctx.store.listTrainingRecords(pid)).map((r) => r.recordKey).sort()).toEqual(['10', '11']);
    expect(await ctx.store.listRecordStates(pid)).toEqual([]);
    // Published: the project's records are taken
    await ctx.store.setProjectStatus(pid, 'active');
    expect(statuses(await sendAs('ana', ['1']))).toEqual(['stored']);
  });

  it('copies plots of a plot file with new ids that fit the survey: T-17 for a text id, -17 for a number id', async () => {
    const north = (await call('GET', '/csv-files', owner.token)).json().csvFiles[0].id as string;
    // No project file yet: the new ids cannot be made to fit its survey
    expect((await call('POST', '/training-sets/from-plot-file', owner.token, { csvFileId: north, count: 2, name: 'Day 1' })).statusCode).toBe(409);
    expect((await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' })).statusCode).toBeLessThan(300);
    for (const body of [{ csvFileId: north, count: 0, name: 'x' }, { csvFileId: north, count: 2, name: '' }, { csvFileId: 'nope', count: 2, name: 'x' }]) {
      expect((await call('POST', '/training-sets/from-plot-file', owner.token, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await call('POST', '/training-sets/from-plot-file', people.ana.token, { csvFileId: north, count: 2, name: 'Day 1' })).statusCode).toBe(403);

    const made = await call('POST', '/training-sets/from-plot-file', owner.token, { csvFileId: north, count: 2, name: 'Day 1', kind: 'calibration' });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ name: 'Day 1', plotCount: 2, everyone: true, kind: 'calibration' });
    const set = await ctx.store.getTrainingSet(pid, made.json().id as string);
    expect(set!.plotKeys).toEqual(['T-1', 'T-2']);
    // Spread through the file, the same places and columns
    expect(set!.data.toString()).toBe('id,lat,lon\nT-1,-10,20\nT-2,-10,21\n');
    // Again from the same file: the plots no set has (a second day's training has other plots), never the first set's
    const again = await call('POST', '/training-sets/from-plot-file', owner.token, { csvFileId: north, count: 2, name: 'Again', everyone: false });
    expect(again.statusCode, again.body).toBe(201);
    expect((await ctx.store.getTrainingSet(pid, again.json().id as string))!.plotKeys).toEqual(['T-3']);
    // None left
    const none = await call('POST', '/training-sets/from-plot-file', owner.token, { csvFileId: north, count: 50, name: 'All', everyone: false });
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ error: 'no_plots_left' });
    // A deleted set's plots are free again; more plots asked for than the file has: all of them
    await call('DELETE', `/training/${made.json().id}`, owner.token);
    await call('DELETE', `/training/${again.json().id}`, owner.token);
    const whole = await call('POST', '/training-sets/from-plot-file', owner.token, { csvFileId: north, count: 50, name: 'All', everyone: false });
    expect(whole.statusCode, whole.body).toBe(201);
    expect(whole.json()).toMatchObject({ plotCount: 3, everyone: false, participants: [] });

    // A survey whose id is a number: negative ids, which no plot of the project has
    await call('DELETE', `/training/${whole.json().id}`, owner.token);
    expect((await call('PUT', '/cep', owner.token, integerIdCep(), { 'content-type': 'application/zip' })).statusCode).toBeLessThan(300);
    const numeric = await call('POST', '/training-sets/from-plot-file', owner.token, { csvFileId: north, count: 3, name: 'Numbers' });
    expect(numeric.statusCode, numeric.body).toBe(201);
    expect((await ctx.store.getTrainingSet(pid, numeric.json().id as string))!.plotKeys).toEqual(['-1', '-2', '-3']);
  });

  it('finishing keeps the scores and deletes the answers; Collect Earth is told; a record sent late is discarded', async () => {
    const created = await createSet('learn.csv', [10, 11], '?kind=learning&everyone=true&name=Day%202&passMark=50');
    const setId = created.json().id as string;
    await call('PUT', `/training/${setId}/golden/10`, owner.token, { answers: { [LU]: 'F' } });
    await call('PUT', `/training/${setId}/golden/11`, owner.token, { answers: { [LU]: 'C' } });
    expect(statuses(await sendAs('ana', ['10', '11']))).toEqual(['stored', 'stored']);
    expect(statuses(await sendAs('bo', ['10']))).toEqual(['stored']);
    const before = (await call('GET', `/training/${setId}`, owner.token)).json();
    const anaBefore = before.scores.find((s: { username: string }) => s.username === 'ana').score;
    expect(anaBefore.answers.rate).toBe(0.5);

    expect((await call('POST', `/training/${setId}/finish`, people.ana.token)).statusCode).toBe(403);
    const done = await call('POST', `/training/${setId}/finish`, owner.token);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ recordsDeleted: 3, set: { finishedAt: expect.any(Number) } });
    expect(await ctx.store.listTrainingRecords(pid)).toEqual([]);

    // The results as they were: the set's view, the list's progress, each person's own page, the export
    const after = (await call('GET', `/training/${setId}`, owner.token)).json();
    expect(after.set.finishedAt).toEqual(done.json().set.finishedAt);
    expect(after.scores.find((s: { username: string }) => s.username === 'ana').score).toEqual(anaBefore);
    expect(after.calibration).toEqual(before.calibration);
    const listed = (await call('GET', '/training', owner.token)).json().sets[0];
    expect(listed).toMatchObject({ finishedAt: expect.any(Number), golden: 2 });
    expect(listed.progress.find((p: { userId: string }) => p.userId === people.ana.userId)).toMatchObject({ submitted: 2, accuracy: 0.5, passed: true });
    const mine = (await call('GET', '/training/mine', people.ana.token)).json().sets[0];
    expect(mine).toMatchObject({ finishedAt: expect.any(Number), submitted: 2, score: { answers: { rate: 0.5 } } });
    const scores = await call('GET', `/training/${setId}/export?what=scores`, owner.token);
    const anaRows = scores.body.split('\r\n').filter((l) => l.startsWith('ana,'));
    expect(anaRows).toHaveLength(1);
    expect(anaRows[0]).toContain(',50,');

    // Collect Earth: no training file any more, and what to clean up
    expect(await myAssignment('ana')).toEqual({ assignments: [], finishedTraining: { files: ['Learning – learn.csv'], plots: ['10', '11'] } });
    // A computer that was offline sends its answer late: discarded, as Collect Earth is told it is done with
    expect(statuses(await sendAs('bo', ['11']))).toEqual(['stale']);
    expect(await ctx.store.listTrainingRecords(pid)).toEqual([]);
    expect(await ctx.store.listRecordStates(pid)).toEqual([]);

    // Nothing more to change in it; its plots are still no plot of the project
    expect((await call('PUT', `/training/${setId}/golden/10`, owner.token, { answers: { [LU]: 'G' } })).statusCode).toBe(409);
    expect((await call('POST', `/training/${setId}/attempts`, owner.token, { all: true })).statusCode).toBe(409);
    expect((await call('PUT', `/training/${setId}/members`, owner.token, { everyone: true })).statusCode).toBe(409);
    expect((await call('POST', `/training/${setId}/finish`, owner.token)).statusCode).toBe(409);
    // Renamed, yes; scored otherwise, no
    expect((await call('PATCH', `/training/${setId}`, owner.token, { passMark: 90 })).statusCode).toBe(409);
    expect((await call('PATCH', `/training/${setId}`, owner.token, { kind: 'calibration' })).statusCode).toBe(409);
    expect((await call('PATCH', `/training/${setId}`, owner.token, { name: 'Day 2 (done)' })).json()).toMatchObject({ name: 'Day 2 (done)', passMark: 50 });
    expect((await call('PUT', '/csv-files/south.csv', owner.token, csv([11, 20]), { 'content-type': 'text/csv' })).json().error).toBe('training_plot_in_file');
    // Renamed, it keeps its results
    expect((await call('PATCH', `/training/${setId}`, owner.token, { name: 'Day 2 (done)' })).statusCode).toBe(200);
    expect((await call('GET', `/training/${setId}`, owner.token)).json().set.name).toBe('Day 2 (done)');
  });

  it("deleting a set retires its plots, so a late record is discarded; a new set may take them again", async () => {
    const setId = (await createSet('c.csv', [10], '?everyone=true')).json().id as string;
    expect(statuses(await sendAs('ana', ['10']))).toEqual(['stored']);
    await call('DELETE', `/training/${setId}`, owner.token);
    expect(statuses(await sendAs('ana', ['10']))).toEqual(['stale']);
    expect(await ctx.store.listRecordStates(pid)).toEqual([]);
    expect((await myAssignment('ana')).finishedTraining).toEqual({ files: [], plots: ['10'] });
    // Taken again by a new set: its records are a training's again
    expect((await createSet('c2.csv', [10], '?everyone=true')).statusCode).toBe(201);
    expect(statuses(await sendAs('ana', ['10']))).toEqual(['stored']);
    expect((await myAssignment('ana')).finishedTraining).toBeUndefined();
  });
});
