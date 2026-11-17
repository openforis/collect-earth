// Invitation links that hand out plots (src/invitePlots.ts): a file whole, or the next N plots nobody holds.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestMailer } from '../src/mail.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { demoCep } from './fixtures/cep.js';

// The demo survey's plots are keyed by id and round
const PLOTS = ['id,round,lat,lon', ...Array.from({ length: 10 }, (_, i) => `P${i + 1},1,${10 + i / 100},${20 + i / 100}`), ''].join('\n');

describe('invitation links that hand out plots', () => {
  let ctx: TestContext;
  let coordinator: { token: string; userId: string };
  let projectId: string;
  let fileId: string;

  const link = async (plots: unknown, maxUses = 20) =>
    ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId}/invites`, headers: bearer(coordinator.token), payload: { role: 'operator', maxUses, plots } });
  const join = async (username: string, inviteToken: string) =>
    (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: `${username}-password`, inviteToken } })).json() as { token: string; userId: string };
  /** The plot ids a person's plot file holds, as Collect Earth downloads it */
  const plotsOf = async (token: string) => {
    const mine = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/my-assignment`, headers: bearer(token) })).json();
    const files = (mine.assignments ?? mine.files ?? mine) as { downloadPath?: string; csvFileId?: string; plotCount?: number }[];
    const ids: string[] = [];
    for (const f of files) {
      const path = f.downloadPath ?? `/v1/projects/${projectId}/csv-files/${f.csvFileId}/content`;
      const text = (await ctx.app.inject({ method: 'GET', url: path, headers: bearer(token) })).body;
      ids.push(...text.split('\n').slice(1).filter(Boolean).map((l) => l.split(',')[0]));
    }
    return ids;
  };

  beforeEach(async () => {
    ctx = await makeContext();
    coordinator = await setupPlatformAdmin(ctx.app, 'coordinator', 'coordinator-pw');
    projectId = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coordinator.token), payload: { name: 'Mapathon' } })).json().projectId;
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${projectId}/cep`, headers: { ...bearer(coordinator.token), 'content-type': 'application/zip' }, payload: demoCep() });
    const put = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${projectId}/csv-files/mapathon.csv`, headers: { ...bearer(coordinator.token), 'content-type': 'text/csv' }, payload: PLOTS });
    fileId = put.json().id ?? put.json().csvFile?.id;
  });
  afterEach(async () => ctx.app.close());

  it('a whole-file link gives each person who joins the whole file', async () => {
    const res = await link({ csvFileId: fileId, mode: 'whole' });
    expect(res.json().plots).toEqual({ csvFileId: fileId, mode: 'whole', count: null });
    const ana = await join('ana', res.json().inviteToken);
    const bea = await join('bea', res.json().inviteToken);
    expect(await plotsOf(ana.token)).toHaveLength(10);
    expect(await plotsOf(bea.token)).toHaveLength(10);
  });

  it('a share link gives each person the next plots nobody holds, in the file’s order, until none is left', async () => {
    const token = (await link({ csvFileId: fileId, mode: 'share', count: 4 })).json().inviteToken;
    const ana = await join('ana', token);
    const bea = await join('bea', token);
    const cid = await join('cid', token);
    const dan = await join('dan', token);
    expect(await plotsOf(ana.token)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(await plotsOf(bea.token)).toEqual(['P5', 'P6', 'P7', 'P8']);
    expect(await plotsOf(cid.token)).toEqual(['P9', 'P10']);
    expect(await plotsOf(dan.token)).toEqual([]);
    // the file is divided now, and the open link says what it gives
    const files = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/csv-files`, headers: bearer(coordinator.token) })).json().csvFiles;
    expect(files[0].divided).toBe(true);
    const open = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/invites`, headers: bearer(coordinator.token) })).json().invites;
    expect(open[0].plots).toEqual({ csvFileId: fileId, mode: 'share', count: 4 });
  });

  it('skips the plots someone submitted already', async () => {
    const first = await join('ana', (await link(null)).json().inviteToken);
    // ana did P1 and P2 before the share link was made (on a file nobody holds yet)
    await batchRequest(ctx.app, projectId, first.token, [envelope({ recordKey: 'P1,1', operator: 'ana' }), envelope({ recordKey: 'P2,1', operator: 'ana' })]);
    const bea = await join('bea', (await link({ csvFileId: fileId, mode: 'share', count: 3 })).json().inviteToken);
    expect(await plotsOf(bea.token)).toEqual(['P3', 'P4', 'P5']);
  });

  it('two people joining at the same moment never take the same plots', async () => {
    const token = (await link({ csvFileId: fileId, mode: 'share', count: 3 })).json().inviteToken;
    const [a, b, c] = await Promise.all(['ana', 'bea', 'cid'].map((u) => join(u, token)));
    const all = [...(await plotsOf(a.token)), ...(await plotsOf(b.token)), ...(await plotsOf(c.token))];
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
  });

  it('refuses what cannot be given', async () => {
    expect((await link({ csvFileId: 'nope', mode: 'whole' })).statusCode).toBe(400);
    expect((await link({ csvFileId: fileId, mode: 'share', count: 0 })).statusCode).toBe(400);
    // a file people have whole cannot be shared out by number
    const ana = await join('ana', (await link(null)).json().inviteToken);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${projectId}/assignments`, headers: bearer(coordinator.token), payload: { assignments: [{ userId: ana.userId, csvFileId: fileId }] } });
    expect((await link({ csvFileId: fileId, mode: 'share', count: 2 })).json().error).toBe('file_whole_assigned');
  });

  it('gives plots to collectors only, and a file given whole since is not shared out', async () => {
    const reviewerLink = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId}/invites`, headers: bearer(coordinator.token), payload: { role: 'reviewer', maxUses: 2, plots: { csvFileId: fileId, mode: 'whole' } } });
    expect(reviewerLink.statusCode).toBe(400);
    const token = (await link({ csvFileId: fileId, mode: 'share', count: 2 })).json().inviteToken;
    // the coordinator gives the whole file to someone after making the link
    const ana = await join('ana', (await link(null)).json().inviteToken);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${projectId}/assignments`, headers: bearer(coordinator.token), payload: { assignments: [{ userId: ana.userId, csvFileId: fileId }] } });
    const bea = await join('bea', token);
    expect(await plotsOf(bea.token)).toEqual([]);
  });

  it('a divided file is given only by number', async () => {
    await join('ana', (await link({ csvFileId: fileId, mode: 'share', count: 2 })).json().inviteToken);
    expect((await link({ csvFileId: fileId, mode: 'whole' })).json().error).toBe('file_divided');
  });

});

describe('the coordinator’s email says what the link gave', () => {
  let ctx: TestContext;
  let mailer: TestMailer;

  beforeEach(async () => {
    mailer = new TestMailer();
    ctx = await makeContext({ publicBaseUrl: 'https://ce.example.org', linkSecret: 'a-link-secret-of-at-least-32-characters!' }, { mailer });
  });
  afterEach(async () => ctx.app.close());

  it('names the plots taken, or says none was left', async () => {
    const coordinator = await setupPlatformAdmin(ctx.app, 'coordinator', 'coordinator-pw');
    await ctx.store.setEmail(coordinator.userId, 'coord@example.org');
    await ctx.store.confirmEmail(coordinator.userId, 'coord@example.org', Date.now());
    const projectId = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coordinator.token), payload: { name: 'Mapathon' } })).json().projectId;
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${projectId}/cep`, headers: { ...bearer(coordinator.token), 'content-type': 'application/zip' }, payload: demoCep() });
    const put = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${projectId}/csv-files/mapathon.csv`, headers: { ...bearer(coordinator.token), 'content-type': 'text/csv' }, payload: PLOTS });
    const fileId = put.json().id ?? put.json().csvFile?.id;
    const inviteToken = (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId}/invites`, headers: bearer(coordinator.token), payload: { role: 'operator', maxUses: 5, plots: { csvFileId: fileId, mode: 'share', count: 8 } } })).json().inviteToken;
    for (const u of ['ana', 'bea', 'cid']) await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: u, password: `${u}-password`, inviteToken } });
    await ctx.app.mailWork?.idle();
    const texts = mailer.sent.filter((m) => m.tag?.startsWith('project.joined')).map((m) => m.text);
    expect(texts.join('\n')).toContain('They got 8 plots of mapathon.csv, from the link.');
    expect(texts.join('\n')).not.toContain('Give them plots to do');
  });
});
