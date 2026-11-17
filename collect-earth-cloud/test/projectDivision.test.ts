import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, legacyPlotFile, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// One division over the project's plots (docs/plans/2026-11-16-plots-from-the-server.md, stage 3): every plot file's
// plots together, divided once, moved, taken by a coordinator, or shared out by a link.

const rows = (ids: number[], province: (id: number) => string) => ids.map((i) => `${i},-10,${20 + i / 10},${province(i)}`).join('\n');

describe('the project’s plots, divided once', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let north: string;
  let south: string;
  const people: Record<string, { token: string; userId: string }> = {};

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token = owner.token, payload?: unknown) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: bearer(token), payload: payload as never });
  const upload = async (filename: string, text: string) =>
    (await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/${filename}`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: text })).json().id as string;
  const join = async (username: string, extra: Record<string, unknown> = {}) => {
    const invite = await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 1, ...extra });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
    return invite;
  };
  const share = (summary: { people: { username: string; plots: number }[] }) => Object.fromEntries(summary.people.map((p) => [p.username, p.plots]));
  const held = async (fileId: string) => (await ctx.store.listPlotAssignments(pid, fileId)).map((a) => `${a.plotKey}:${a.userId}`).sort();
  const myPlots = async (who: string) => (await call('GET', '/my-plots', people[who].token)).json().plots as number;

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'One set')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    north = await upload('north.csv', `id,lat,lon,province\n${rows([1, 2, 3, 4, 5, 6], (i) => (i <= 3 ? 'La Paz' : 'Oruro'))}\n`);
    south = await upload('south.csv', `id,lat,lon,province\n${rows([7, 8, 9, 10], () => 'Potosi')}\n`);
    for (const n of ['ana', 'bo', 'cy']) await join(n);
  });
  afterEach(async () => ctx.app.close());

  it('gives the columns of the project’s plots, the values of every plot file counted', async () => {
    const columns = (await call('GET', '/plots/columns')).json();
    expect(columns).toMatchObject({ plotCount: 10, hasHeader: true });
    const province = columns.columns.find((c: { name: string }) => c.name === 'province');
    expect(province.values).toEqual([
      { value: 'La Paz', count: 3 },
      { value: 'Oruro', count: 3 },
      { value: 'Potosi', count: 4 },
    ]);
  });

  it('divides every plot file’s plots evenly at once; a dry run saves nothing', async () => {
    const body = { mode: 'even', people: [people.ana.userId, people.bo.userId], order: 'file' };
    const preview = await call('PUT', '/plots/division', owner.token, { ...body, dryRun: true });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(share(preview.json())).toEqual({ ana: 5, bo: 5 });
    expect(await held(north)).toEqual([]);
    const applied = (await call('PUT', '/plots/division', owner.token, body)).json();
    expect(applied).toMatchObject({ plotCount: 10, unassigned: 0 });
    // ana the first five (all in north.csv), bo the rest: one of north and the four of south
    expect(await held(north)).toEqual(['1', '2', '3', '4', '5'].map((p) => `${p}:${people.ana.userId}`).concat([`6:${people.bo.userId}`]).sort());
    expect((await held(south)).every((h) => h.endsWith(people.bo.userId))).toBe(true);
    expect(await myPlots('ana')).toBe(5);
    expect(await myPlots('bo')).toBe(5);
    expect(share((await call('GET', '/plots/division')).json())).toEqual({ ana: 5, bo: 5 });
    // what was submitted stays with who submitted it
    await batchRequest(ctx.app, pid, people.bo.token, [envelope({ recordKey: '9', operator: 'bo', activelySaved: true })]);
    await call('PUT', '/plots/division', owner.token, { mode: 'even', people: [people.ana.userId, people.cy.userId], order: 'file' });
    expect((await held(south)).filter((h) => h.startsWith('9:'))).toEqual([`9:${people.bo.userId}`]);
  });

  it('divides by a column of the project’s plots, whatever file a plot is in', async () => {
    const columns = (await call('GET', '/plots/columns')).json().columns as { index: number; name: string }[];
    const column = columns.find((c) => c.name === 'province')!.index;
    const res = await call('PUT', '/plots/division', owner.token, {
      mode: 'column',
      column,
      groups: [
        { value: 'La Paz', people: [people.ana.userId] },
        { value: 'Potosi', people: [people.bo.userId, people.cy.userId] },
      ],
      order: 'file',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(share(res.json())).toEqual({ ana: 3, bo: 2, cy: 2 });
    expect(res.json().unassigned).toBe(3); // Oruro: nobody
    expect((await call('PUT', '/plots/division', owner.token, { mode: 'whole' })).statusCode).toBe(400);
  });

  it('moves someone’s unfinished plots over every plot file, all or some', async () => {
    await call('PUT', '/plots/division', owner.token, { mode: 'even', people: [people.ana.userId, people.bo.userId], order: 'file' });
    const some = (await call('POST', '/plots/move-unfinished', owner.token, { fromUserId: people.bo.userId, toUserId: people.cy.userId, count: 2 })).json();
    expect(some).toMatchObject({ moved: 2 });
    expect(share(some)).toEqual({ ana: 5, bo: 3, cy: 2 });
    const all = (await call('POST', '/plots/move-unfinished', owner.token, { fromUserId: people.bo.userId, toUserId: people.cy.userId })).json();
    expect(all.moved).toBe(3);
    expect(await myPlots('cy')).toBe(5);
    expect(await myPlots('bo')).toBe(0);
  });

  it('lets a coordinator take plots nobody holds, of a column’s value if they choose', async () => {
    const columns = (await call('GET', '/plots/columns')).json().columns as { index: number; name: string }[];
    const column = columns.find((c) => c.name === 'province')!.index;
    const potosi = (await call('POST', '/plots/take', owner.token, { count: 2, column, value: 'Potosi' })).json();
    expect(potosi).toMatchObject({ taken: 2, free: 2 });
    expect((await held(south)).map((h) => h.split(':')[0])).toEqual(['7', '8']);
    const more = (await call('POST', '/plots/take', owner.token, { count: 20 })).json();
    expect(more.taken).toBe(8);
    expect(more.unassigned).toBe(0);
    expect((await call('GET', '/my-plots')).json().plots).toBe(10);
    // collectors do not take plots themselves
    expect((await call('POST', '/plots/take', people.ana.token, { count: 1 })).statusCode).toBe(403);
  });

  it('shares the project’s plots out by a link, file after file', async () => {
    const link = await join('dee', { plots: { csvFileId: null, mode: 'share', count: 4 } });
    expect(link.json().plots).toEqual({ csvFileId: null, mode: 'share', count: 4 });
    await join('eve', { plots: { csvFileId: null, mode: 'share', count: 4 } });
    expect(await myPlots('dee')).toBe(4);
    expect(await myPlots('eve')).toBe(4);
    // eve: the last two of north, then two of south
    expect((await held(south)).filter((h) => h.endsWith(people.eve.userId))).toHaveLength(2);
    expect((await call('POST', '/invites', owner.token, { role: 'operator', plots: { csvFileId: null, mode: 'whole' } })).statusCode).toBe(400);
  });

  it('refuses to divide the plots of a project whose files break the rules of one set, and says which', async () => {
    await legacyPlotFile(ctx, pid, 'west.csv', `id,lat,lon,province\n${rows([10, 11], () => 'Beni')}\n`);
    const res = await call('PUT', '/plots/division', owner.token, { mode: 'even', people: [people.ana.userId], order: 'file' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'not_one_set', files: [{ filename: 'west.csv', reason: 'plots_in_other_file' }] });
    // coordinators only
    expect((await call('GET', '/plots/division', people.ana.token)).statusCode).toBe(403);
    // moving and taking too: the file a plot is not counted in would lose it, or the plot be taken twice
    expect((await call('POST', '/plots/move-unfinished', owner.token, { fromUserId: people.ana.userId, toUserId: people.bo.userId })).statusCode).toBe(409);
    expect((await call('POST', '/plots/take', owner.token, { count: 1 })).statusCode).toBe(409);
  });

  it('shares a plot two files have once, and none of a file with other columns, by a link', async () => {
    await legacyPlotFile(ctx, pid, 'west.csv', `id,lat,lon,province\n${rows([10, 11], () => 'Beni')}\n`);
    await legacyPlotFile(ctx, pid, 'wide.csv', `id,lat,lon,province,extra\n${rows([12], () => 'Pando')},x\n`);
    await join('dee', { plots: { csvFileId: null, mode: 'share', count: 50 } });
    // 1 to 11 once each (10 is in south.csv and west.csv); 12 is in a file with other columns
    expect(await myPlots('dee')).toBe(11);
  });
});
