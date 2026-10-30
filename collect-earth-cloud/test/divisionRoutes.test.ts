import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';
import { demoCep, idOnlyCep } from './fixtures/cep.js';

// 10 plots: a header, a quoted WKT column holding the separator and a line break,
// and a province column. Plot 4 has two rows.
const CSV =
  'id,lat,lon,wkt,province\n' +
  '1,0,0,"POLYGON((0 0, 1 1))",La Paz\n' +
  '2,0,0,"POLYGON((0 0,\n 1 1))",La Paz\n' +
  '3,0,0,x,Oruro\n' +
  '4,0,0,x,La Paz\n' +
  '4,1,1,second row,La Paz\n' +
  '5,0,0,x,Oruro\n' +
  '6,0,0,x,\n' +
  '7,0,0,x,La Paz\n' +
  '8,0,0,x,Potosi\n' +
  '9,0,0,x,La Paz\n' +
  '10,0,0,x,Oruro\n';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

async function registerUser(app: FastifyInstance, pid: string, adminToken: string, username: string, role = 'operator') {
  const invite = await app.inject({
    method: 'POST',
    url: `/v1/projects/${pid}/invites`,
    headers: bearer(adminToken),
    payload: { role, maxUses: 1 },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { username, password: 'password12', inviteToken: invite.json().inviteToken },
  });
  return { userId: res.json().userId as string, token: res.json().token as string, username };
}

describe('dividing plots between people', () => {
  let ctx: TestContext;
  let pid: string;
  let admin: string;
  let fileId: string;
  let maria: { userId: string; token: string; username: string };
  let jose: { userId: string; token: string; username: string };
  let ana: { userId: string; token: string; username: string };

  const upload = (content: string, filename = 'plots.csv') =>
    ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/${filename}`,
      headers: { ...bearer(admin), 'content-type': 'text/csv' },
      payload: content,
    });
  const divideFile = (body: Record<string, unknown>, id = fileId) =>
    ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/${id}/distribution`, headers: bearer(admin), payload: body });
  const getDistribution = async () =>
    (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files/${fileId}/distribution`, headers: bearer(admin) })).json();
  const myAssignment = async (token: string) =>
    (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/my-assignment`, headers: bearer(token) })).json().assignments;
  const download = (token: string, path: string) => ctx.app.inject({ method: 'GET', url: path, headers: bearer(token) });
  const plotsOf = (body: string) =>
    body.split('\n').slice(1).filter((l) => /^\d+,/.test(l)).map((l) => l.split(',')[0]);
  const share = (summary: { people: { username: string }[] }, username: string) =>
    summary.people.find((p) => p.username === username);

  beforeEach(async () => {
    ctx = await makeContext();
    const project = await createProject(ctx.app, 'Division project');
    pid = project.projectId;
    admin = project.adminToken;
    maria = await registerUser(ctx.app, pid, admin, 'maria');
    jose = await registerUser(ctx.app, pid, admin, 'jose');
    ana = await registerUser(ctx.app, pid, admin, 'ana', 'reviewer');
    fileId = (await upload(CSV)).json().id;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('describes the columns of the file', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files/${fileId}/columns`, headers: bearer(admin) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ plotCount: 10, hasHeader: true, separator: ',' });
    expect(body.columns).toHaveLength(5);
    expect(body.columns[0]).toEqual({ index: 0, name: 'id', distinctCount: 10, values: null });
    expect(body.columns[4]).toEqual({
      index: 4,
      name: 'province',
      distinctCount: 4,
      values: [
        { value: 'La Paz', count: 5 },
        { value: 'Oruro', count: 3 },
        { value: 'Potosi', count: 1 },
        { value: '', count: 1 },
      ],
    });
    const unknown = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files/not-a-uuid/columns`, headers: bearer(admin) });
    expect(unknown.statusCode).toBe(404);
  });

  it('a dry run saves nothing; applying divides evenly and drops the grid assignments', async () => {
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/assignments`,
      headers: bearer(admin),
      payload: { assignments: [{ userId: maria.userId, csvFileId: fileId }] },
    });
    const whole = await getDistribution();
    expect(whole).toMatchObject({ distribution: null, plotCount: 10, unassigned: 0 });
    expect(whole.people).toEqual([{ userId: maria.userId, username: 'maria', plots: 10, overlap: 0, submitted: 0 }]);

    const dry = await divideFile({ mode: 'even', people: [maria.userId, jose.userId, ana.userId], order: 'file', dryRun: true });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().people.map((p: { plots: number }) => p.plots)).toEqual([4, 3, 3]);
    expect((await getDistribution()).distribution).toBeNull();

    const applied = await divideFile({ mode: 'even', people: [maria.userId, jose.userId, ana.userId], order: 'file' });
    expect(applied.json().distribution).toEqual({
      mode: 'even', people: [maria.userId, jose.userId, ana.userId], order: 'file', overlapPercent: 0,
    });
    expect(await getDistribution()).toEqual(applied.json());
    expect(await ctx.store.listAssignments(pid)).toEqual([]);

    const list = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files`, headers: bearer(admin) });
    expect(list.json().csvFiles[0]).toMatchObject({ id: fileId, filename: 'plots.csv', divided: true, dividedPeople: 3 });
  });

  it('serves each person their own file; my-assignment checksum equals the served bytes', async () => {
    await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
    const mine = await myAssignment(maria.token);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      csvFileId: fileId,
      filename: 'plots.csv',
      plotCount: 5,
      downloadPath: `/v1/projects/${pid}/csv-files/${fileId}/content?mine=1&v=${mine[0].checksum}`,
    });
    const res = await download(maria.token, mine[0].downloadPath);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-checksum-sha256']).toBe(mine[0].checksum);
    expect(sha256(res.rawPayload)).toBe(mine[0].checksum);
    expect(res.body.startsWith('id,lat,lon,wkt,province\n1,0,0,"POLYGON((0 0, 1 1))",La Paz\n2,0,0,"POLYGON((0 0,\n 1 1))"')).toBe(true);
    expect(res.body).toContain('4,1,1,second row,La Paz\n');
    expect(res.body).not.toContain('\n6,');

    const joses = await myAssignment(jose.token);
    const theirs = await download(jose.token, joses[0].downloadPath);
    expect(sha256(theirs.rawPayload)).toBe(joses[0].checksum);
    expect(plotsOf(theirs.body)).toEqual(['6', '7', '8', '9', '10']);

    // Without ?mine=1 a collector still only gets their own plots; the admin the whole file.
    const plain = await download(jose.token, `/v1/projects/${pid}/csv-files/${fileId}/content`);
    expect(plain.body).toBe(theirs.body);
    const full = await download(admin, `/v1/projects/${pid}/csv-files/${fileId}/content`);
    expect(full.body).toBe(CSV);
  });

  it('a collector cannot download a divided file they hold no plot in', async () => {
    await divideFile({ mode: 'even', people: [maria.userId], order: 'file' });
    expect(await myAssignment(jose.token)).toEqual([]);
    const res = await download(jose.token, `/v1/projects/${pid}/csv-files/${fileId}/content?mine=1`);
    expect(res.statusCode).toBe(404);
    expect((await download(jose.token, `/v1/projects/${pid}/csv-files/${fileId}/content`)).statusCode).toBe(404);
  });

  it('the grid ignores divided files, and "whole file" makes it a grid file again', async () => {
    const other = (await upload('id,lat,lon\n1,0,0\n', 'other.csv')).json().id;
    await divideFile({ mode: 'even', people: [maria.userId], order: 'file' });
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/assignments`,
      headers: bearer(admin),
      payload: { assignments: [{ userId: jose.userId, csvFileId: fileId }, { userId: jose.userId, csvFileId: other }] },
    });
    expect(put.statusCode).toBe(200);
    expect((await ctx.store.listAssignments(pid)).map((a) => a.csvFileId)).toEqual([other]);
    const joses = await myAssignment(jose.token);
    expect(joses.map((a: { filename: string }) => a.filename)).toEqual(['other.csv']);
    // The whole-file entry has the stored checksum, also in the path (?v=, no mine=1).
    expect(joses[0].downloadPath).toBe(`/v1/projects/${pid}/csv-files/${other}/content?v=${joses[0].checksum}`);

    const whole = await divideFile({ mode: 'whole', people: ['ignored'] });
    expect(whole.statusCode).toBe(200);
    expect(whole.json()).toMatchObject({ distribution: null, plotCount: 10, unassigned: 10, people: [] });
    expect(await myAssignment(maria.token)).toEqual([]);
    expect(await ctx.store.listPlotAssignments(pid, fileId)).toEqual([]);
  });

  it('divides by a column, with overlap copies', async () => {
    const res = await divideFile({
      mode: 'column',
      column: 4,
      groups: [
        { value: 'La Paz', people: [maria.userId, jose.userId] },
        { value: 'Oruro', people: [ana.userId] },
      ],
      order: 'file',
      overlapPercent: 50,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.unassigned).toBe(2); // Potosi and the empty value
    // La Paz (1, 2, 4, 7, 9): maria 1, 2, 4 and jose 7, 9; copies: 1, 2 to jose, 7 to maria.
    // Oruro (3, 5, 10): ana alone, so her copies (3, 5) go to the next of all people: maria.
    expect(share(body, 'maria')).toMatchObject({ plots: 3 + 3, overlap: 3 });
    expect(share(body, 'jose')).toMatchObject({ plots: 2 + 2, overlap: 2 });
    expect(share(body, 'ana')).toMatchObject({ plots: 3, overlap: 0 });
    const mariaFile = await download(maria.token, (await myAssignment(maria.token))[0].downloadPath);
    expect(plotsOf(mariaFile.body)).toEqual(['1', '2', '3', '4', '4', '5', '7']);
    const joseFile = await download(jose.token, (await myAssignment(jose.token))[0].downloadPath);
    expect(plotsOf(joseFile.body)).toEqual(['1', '2', '7', '9']);
  });

  it('refuses bad requests with a reason', async () => {
    const stranger = '00000000-0000-0000-0000-000000000000';
    for (const body of [
      { mode: 'even', people: [stranger], order: 'file' },
      { mode: 'even', people: [], order: 'file' },
      { mode: 'even', people: [maria.userId], order: 'file', overlapPercent: 60 },
      { mode: 'column', column: 9, groups: [{ value: 'La Paz', people: [maria.userId] }], order: 'file' },
      { mode: 'column', column: 4, groups: [{ value: 'La Paz', people: [] }], order: 'file' },
    ]) {
      const res = await divideFile(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad_request' });
      expect(typeof res.json().reason).toBe('string');
    }
  });

  it('a mixed preview and an apply with the same seed give the identical result', async () => {
    const request = { mode: 'even', people: [maria.userId, jose.userId], order: 'mixed', overlapPercent: 20 };
    const preview = await divideFile({ ...request, dryRun: true });
    const seed = preview.json().distribution.seed;
    expect(Number.isInteger(seed)).toBe(true);
    const applied = await divideFile({ ...request, seed });
    expect(applied.json()).toEqual(preview.json());
    const first = await ctx.store.listPlotAssignments(pid, fileId);
    await divideFile({ ...request, seed });
    expect(await ctx.store.listPlotAssignments(pid, fileId)).toEqual(first);
    expect((await divideFile({ ...request, seed: seed + 1, dryRun: true })).json().distribution.seed).toBe(seed + 1);
  });

  it('keeps submitted plots with whoever submitted them when dividing again', async () => {
    await batchRequest(ctx.app, pid, jose.token, [
      envelope({ recordKey: '1', operator: 'jose' }),
      envelope({ recordKey: '2,2020', operator: 'jose' }),
    ]);
    const res = await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
    // Jose's two count towards his five; the free plots are dealt in order.
    expect(share(res.json(), 'jose')).toMatchObject({ plots: 5, submitted: 2 });
    const joseFile = await download(jose.token, (await myAssignment(jose.token))[0].downloadPath);
    expect(plotsOf(joseFile.body)).toEqual(['1', '2', '8', '9', '10']);
    const mariaFile = await download(maria.token, (await myAssignment(maria.token))[0].downloadPath);
    expect(plotsOf(mariaFile.body)).toEqual(['3', '4', '4', '5', '6', '7']);
  });

  it('moves unfinished plots on a divided file; submitted ones stay', async () => {
    await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '1', operator: 'maria' }),
      envelope({ recordKey: '2', operator: 'maria', activelySaved: false }),
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${pid}/csv-files/${fileId}/move-unfinished`,
      headers: bearer(admin),
      payload: { fromUserId: maria.userId, toUserId: ana.userId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ distribution: { mode: 'manual' }, moved: 4, unassigned: 0 });
    expect(share(res.json(), 'maria')).toMatchObject({ plots: 1, submitted: 1 });
    expect(share(res.json(), 'ana')).toMatchObject({ plots: 4 });
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${pid}/csv-files/${fileId}/move-unfinished`,
      headers: bearer(admin),
      payload: { fromUserId: maria.userId, toUserId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('moving to someone holding a copy makes it theirs, unless they already checked it', async () => {
    // 50%: maria holds 1-5 and copies of 6, 7 and 9; jose holds 6-10 and copies of 1, 2 and 4.
    await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file', overlapPercent: 50 });
    const before = await ctx.store.listPlotAssignments(pid, fileId);
    const joseCopies = before.filter((a) => a.userId === jose.userId && a.overlap).map((a) => a.plotKey);
    const mariaCopies = before.filter((a) => a.userId === maria.userId && a.overlap).map((a) => a.plotKey);
    expect(joseCopies).toEqual(['1', '2', '4']);
    expect(mariaCopies).toEqual(['6', '7', '9']);
    // Jose checked plot 2 (he holds it as a copy, and the key has no round).
    await batchRequest(ctx.app, pid, jose.token, [envelope({ recordKey: '2', operator: 'jose' })]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${pid}/csv-files/${fileId}/move-unfinished`,
      headers: bearer(admin),
      payload: { fromUserId: maria.userId, toUserId: jose.userId },
    });
    expect(res.statusCode).toBe(200);
    // 1, 3, 4, 5 move (1 and 4 were jose's copies: now his to assess); 2 stays with
    // maria; her copies of 6, 7 and 9 go, as jose holds them as main.
    expect(res.json()).toMatchObject({ moved: 4, notMoved: 1, droppedChecks: 3, unassigned: 0 });
    const after = await ctx.store.listPlotAssignments(pid, fileId);
    const of = (userId: string) =>
      after
        .filter((a) => a.userId === userId)
        .sort((x, y) => Number(x.plotKey) - Number(y.plotKey))
        .map((a) => `${a.plotKey}${a.overlap ? ' copy' : ''}`);
    expect(of(maria.userId)).toEqual(['2']);
    expect(of(jose.userId)).toEqual(['1', '2 copy', '3', '4', '5', '6', '7', '8', '9', '10']);
  });

  it('moves unfinished plots on a whole file by dividing it first', async () => {
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/assignments`,
      headers: bearer(admin),
      payload: { assignments: [{ userId: maria.userId, csvFileId: fileId }, { userId: jose.userId, csvFileId: fileId }] },
    });
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '3', operator: 'maria' })]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${pid}/csv-files/${fileId}/move-unfinished`,
      headers: bearer(admin),
      payload: { fromUserId: maria.userId, toUserId: jose.userId },
    });
    // jose already had every plot: maria just loses all but the one she submitted.
    expect(res.json()).toMatchObject({ distribution: { mode: 'manual' }, moved: 9 });
    expect(share(res.json(), 'maria')).toMatchObject({ plots: 1, submitted: 1 });
    expect(share(res.json(), 'jose')).toMatchObject({ plots: 10 });
    expect(await ctx.store.listAssignments(pid)).toEqual([]);
    const mariaFile = await download(maria.token, (await myAssignment(maria.token))[0].downloadPath);
    expect(plotsOf(mariaFile.body)).toEqual(['3']);
  });

  it('removing a member drops their plots', async () => {
    await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
    const res = await ctx.app.inject({ method: 'DELETE', url: `/v1/projects/${pid}/members/${maria.userId}`, headers: bearer(admin) });
    expect(res.statusCode).toBe(204);
    const summary = await getDistribution();
    expect(summary.unassigned).toBe(5);
    expect(summary.people.map((p: { username: string }) => p.username)).toEqual(['jose']);
  });

  it('replacing the file keeps the plots still in it; new ones are unassigned', async () => {
    await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
    const replaced = CSV.replace('1,0,0,"POLYGON((0 0, 1 1))",La Paz\n', '') + '11,0,0,x,Oruro\n';
    const res = await upload(replaced);
    expect(res.json().id).toBe(fileId);
    const summary = await getDistribution();
    expect(summary).toMatchObject({ plotCount: 10, unassigned: 1 });
    expect(share(summary, 'maria')).toMatchObject({ plots: 4 });
    const mine = await myAssignment(maria.token);
    expect(mine[0].plotCount).toBe(4);
    const served = await download(maria.token, mine[0].downloadPath);
    expect(sha256(served.rawPayload)).toBe(mine[0].checksum);
    expect(plotsOf(served.body)).toEqual(['2', '3', '4', '4', '5']);
  });

  const putCep = async (body: Buffer) => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/cep`,
      headers: { ...bearer(admin), 'content-type': 'application/zip' },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().round as { state: string };
  };

  it('someone holding a plot as main in one file and as a copy in another did its main assessment, as the export says', async () => {
    // Plot 1: maria's main plot in this file; in b.csv jose holds it as main and maria as a copy.
    await ctx.store.setDivision(pid, fileId, { mode: 'manual' }, [{ plotKey: '1', userId: maria.userId, overlap: false }]);
    const fileB = (await upload('id,lat,lon\n1,0,0\n2,0,0\n', 'b.csv')).json().id as string;
    await ctx.store.setDivision(pid, fileB, { mode: 'manual' }, [
      { plotKey: '1', userId: jose.userId, overlap: false },
      { plotKey: '1', userId: maria.userId, overlap: true },
      { plotKey: '2', userId: jose.userId, overlap: false },
    ]);
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '1', operator: 'maria' })]);
    const exported = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/export.csv`, headers: bearer(admin) });
    expect(exported.body).toContain('\r\n1,1,1,main,,maria,');
    // Dividing b.csv again between jose and ana: maria did the main assessment of plot 1,
    // so it stays hers (she is not among the people) and only plot 2 is dealt.
    const res = await divideFile({ mode: 'even', people: [jose.userId, ana.userId], order: 'file', dryRun: true }, fileB);
    expect(res.statusCode, res.body).toBe(200);
    expect(share(res.json(), 'maria')).toMatchObject({ plots: 1, overlap: 0, submitted: 1 });
    const people = res.json().people as { username: string; plots: number }[];
    expect(people.filter((p) => p.username !== 'maria').reduce((n, p) => n + p.plots, 0)).toBe(1);
  });

  it('with the round the server added, a check record counts as submitted by the person who made it', async () => {
    expect((await putCep(idOnlyCep())).state).toBe('added');
    await batchRequest(ctx.app, pid, jose.token, [
      envelope({ recordKey: '1,1', operator: 'jose' }),
      envelope({ recordKey: '2,2', operator: 'jose' }),
      // Not plot 1: "1" never catches "10" or "1x".
      envelope({ recordKey: '1x,1', operator: 'jose' }),
    ]);
    const res = await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
    // Jose checked plot 2: he keeps it as a copy (round 2), and maria gets it to assess.
    expect(share(res.json(), 'jose')).toMatchObject({ plots: 6, overlap: 1, submitted: 2 });
    expect(share(res.json(), 'maria')).toMatchObject({ plots: 5, overlap: 0 });
    const joseFile = await download(jose.token, (await myAssignment(jose.token))[0].downloadPath);
    expect(plotsOf(joseFile.body)).toEqual(['1', '2', '7', '8', '9', '10']);
    expect(joseFile.body).toContain('\n2,2,0,0,');
    expect(joseFile.body).toContain('\n1,1,0,0,');
  });

  it('refuses a project file that reads plots with other key columns while a file is divided', async () => {
    await divideFile({ mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
    const before = await ctx.store.listPlotAssignments(pid, fileId);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/cep`,
      headers: { ...bearer(admin), 'content-type': 'application/zip' },
      payload: demoCep(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'plots_divided' });
    expect(res.json().reason).toContain('2 key columns instead of 1');
    // Nothing changed.
    expect(await ctx.store.getRoundInfo(pid)).toBeNull();
    expect(await ctx.store.getCep(pid)).toBeNull();
    expect(await ctx.store.listPlotAssignments(pid, fileId)).toEqual(before);
    // The same key columns (the server adds round to an id-only file) are fine.
    expect((await putCep(idOnlyCep())).state).toBe('added');
  });

  it('counts the plots of every file again when a new project file changes the key columns', async () => {
    const plotCount = async () =>
      (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files`, headers: bearer(admin) })).json().csvFiles[0]
        .plotCount;
    expect(await plotCount()).toBe(10);
    // Two key columns: id and lat. Plot 4's two rows are two plots now.
    expect((await putCep(demoCep())).state).toBe('own');
    expect(await plotCount()).toBe(11);
    expect((await putCep(idOnlyCep())).state).toBe('added');
    expect(await plotCount()).toBe(10);
  });

  it('with a survey of two keys, a plot is its first two columns', async () => {
    expect((await putCep(demoCep())).state).toBe('own');
    const put = await upload('id,round,lat,lon\n17,1,0,0\n17,1,5,5\n18,1,0,0\n18,3,0,0\n', 'own.csv');
    expect(put.json().plotCount).toBe(3);
    const ownId = put.json().id as string;
    const columns = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/csv-files/${ownId}/columns`, headers: bearer(admin) });
    expect(columns.json().plotCount).toBe(3);
    // A check record (round 2, the reassessment code) belongs to plot 18 whatever its round.
    await batchRequest(ctx.app, pid, jose.token, [envelope({ recordKey: '18,2', operator: 'jose' })]);
    const res = await divideFile({ mode: 'even', people: [jose.userId, maria.userId], order: 'file' }, ownId);
    expect(res.json().plotCount).toBe(3);
    // Jose's check keeps 18,1 with him as a copy; maria gets it to assess.
    expect(share(res.json(), 'jose')).toMatchObject({ plots: 3, overlap: 1, submitted: 1 });
    const holdings = await ctx.store.listPlotAssignments(pid, ownId);
    const of = (userId: string) =>
      holdings.filter((a) => a.userId === userId).map((a) => `${a.plotKey}${a.overlap ? ' copy' : ''}`).sort();
    expect(of(jose.userId)).toEqual(['17,1', '18,1 copy', '18,3']);
    expect(of(maria.userId)).toEqual(['18,1']);
  });
});
