import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// The person's plots in one file (docs/plans/2026-11-16-plots-from-the-server.md, stage 1): every plot a person holds,
// whatever their role, from every plot file, the training sets apart; a version Collect Earth asks every few minutes.

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const csv = (ids: number[], header = 'id,lat,lon') => `${header}\n${ids.map((i) => `${i},-10,${20 + i}`).join('\n')}\n`;
const rowsOf = (body: string) => body.trimEnd().split('\n').slice(1);
const idsOf = (body: string) => rowsOf(body).map((l) => l.split(',')[0]);

describe('the person’s plots (my-plots)', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  const people: Record<string, { token: string; userId: string }> = {};

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const upload = async (filename: string, text: string) => (await call('PUT', `/csv-files/${filename}`, owner.token, text, { 'content-type': 'text/csv' })).json().id as string;
  const myPlots = async (who: { token: string }) => (await call('GET', '/my-plots', who.token)).json();
  const download = (who: { token: string }, path: string, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method: 'GET', url: path, headers: { ...bearer(who.token), ...headers } });
  const join = async (username: string) => {
    const invite = await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'One list')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const n of ['ana', 'bo']) await join(n);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('puts a whole file and a share of a divided one in one file, without the training sets; 304 and 409 as a plot file', async () => {
    const north = await upload('north.csv', csv([1, 2, 3, 4]));
    const south = await upload('south.csv', csv([5, 6]));
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: people.ana.userId, csvFileId: south }] });
    expect((await call('PUT', `/csv-files/${north}/distribution`, owner.token, { mode: 'even', people: [people.ana.userId, people.bo.userId], order: 'file' })).statusCode).toBe(200);
    // a training set ana takes part in stays apart
    const set = (await call('PUT', '/training-sets/calib.csv', owner.token, csv([10, 11]), { 'content-type': 'text/csv' })).json().id as string;
    await call('PUT', `/training/${set}/members`, owner.token, { userIds: [people.ana.userId] });

    const mine = await myPlots(people.ana);
    expect(mine).toMatchObject({ plots: 4, keyColumns: 1, leftOut: [], repeated: 0 });
    expect(mine.sources).toEqual([
      { csvFileId: south, filename: 'south.csv', plots: 2 },
      { csvFileId: north, filename: 'north.csv', plots: 2 },
    ]);
    expect(mine.version).toMatch(/^[0-9a-f]{32}$/);
    const file = await download(people.ana, mine.downloadPath);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.headers['x-checksum-sha256']).toBe(sha256(file.rawPayload));
    expect(file.headers['x-plots']).toBe('4');
    expect(file.body.split('\n')[0]).toBe('id,lat,lon');
    expect(idsOf(file.body)).toEqual(['5', '6', '1', '2']);
    // bo has the other half
    expect(idsOf((await download(people.bo, (await myPlots(people.bo)).downloadPath)).body)).toEqual(['3', '4']);

    // asked again with the version it has: nothing to download
    expect((await download(people.ana, mine.downloadPath, { 'if-none-match': `"${mine.version}"` })).statusCode).toBe(304);
    // with the plot file of each row
    const named = await download(people.ana, `${mine.downloadPath}&plotFile=1`);
    expect(named.body.split('\n')[0]).toBe('id,lat,lon,plot_file');
    expect(rowsOf(named.body)).toEqual(['5,-10,25,south.csv', '6,-10,26,south.csv', '1,-10,21,north.csv', '2,-10,22,north.csv']);

    // the coordinator moves ana's unfinished plots of north to bo: a new version, and the old one is refused
    await call('POST', `/csv-files/${north}/move-unfinished`, owner.token, { fromUserId: people.ana.userId, toUserId: people.bo.userId });
    const after = await myPlots(people.ana);
    expect(after.version).not.toBe(mine.version);
    expect(after.plots).toBe(2);
    expect((await download(people.ana, mine.downloadPath)).statusCode).toBe(409);
    expect(idsOf((await download(people.ana, after.downloadPath)).body)).toEqual(['5', '6']);
    expect((await download(people.ana, after.downloadPath, { 'if-none-match': `"${mine.version}"` })).statusCode).toBe(200);
    // nothing changed: the same version
    expect((await myPlots(people.ana)).version).toBe(after.version);
  });

  it('a coordinator gets the plots they hold, not the whole project; a project token and someone with none get none', async () => {
    const north = await upload('north.csv', csv([1, 2, 3, 4]));
    expect((await myPlots(owner)).plots).toBe(0);
    const empty = await download(owner, (await myPlots(owner)).downloadPath);
    expect(empty.statusCode).toBe(200);
    expect(empty.rawPayload.length).toBe(0);
    await call('PUT', `/csv-files/${north}/distribution`, owner.token, { mode: 'even', people: [owner.userId, people.ana.userId], order: 'file' });
    expect(idsOf((await download(owner, (await myPlots(owner)).downloadPath)).body)).toEqual(['1', '2']);
    const project = await createProject(ctx.app, 'Tokens only');
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/my-plots`, headers: bearer(project.projectToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().plots).toBe(0);
  });

  it('puts the columns of a file in the order of the others, leaves out a file with other columns, and writes a plot in two files once', async () => {
    const a = await upload('a.csv', csv([1, 2, 3]));
    const b = await upload('b.csv', 'lon;id;lat\n24;4;-10\n');
    const c = await upload('c.csv', csv([5], 'id,lat,lon,province'));
    const d = await upload('d.csv', `${csv([1, 6])}7,,\n8,-95,20\n`);
    await call('PUT', '/assignments', owner.token, { assignments: [a, b, c, d].map((csvFileId) => ({ userId: people.ana.userId, csvFileId })) });
    const mine = await myPlots(people.ana);
    // d's plot 1 is a's; its plots 7 (no place) and 8 (a latitude of -95) would stop Google Earth Pro's plot file
    expect(mine).toMatchObject({ plots: 5, repeated: 1, unreadable: 2, leftOut: [{ csvFileId: c, filename: 'c.csv', reason: 'columns_differ' }] });
    expect(rowsOf((await download(people.ana, mine.downloadPath)).body)).toEqual(['1,-10,21', '2,-10,22', '3,-10,23', '4,-10,24', '6,-10,26']);
  });

  it('with the round the server adds to the survey, every row has it', async () => {
    const cep = await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    expect(cep.json().round.state).toBe('added');
    const north = await upload('north.csv', csv([1, 2]));
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: people.ana.userId, csvFileId: north }] });
    const mine = await myPlots(people.ana);
    const body = (await download(people.ana, mine.downloadPath)).body;
    // the keys are the id and the round the server added: the files people get carry the round after the id
    expect(mine.keyColumns).toBe(2);
    expect(body.split('\n')[0].split(',').slice(0, 2)).toEqual(['id', 'round']);
    expect(rowsOf(body).map((r) => r.split(',').slice(0, 2).join(','))).toEqual(['1,1', '2,1']);
    expect(mine.plots).toBe(2);
  });
});
