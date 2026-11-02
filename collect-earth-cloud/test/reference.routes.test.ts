import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

interface Entry {
  csvFileId: string;
  filename: string;
  checksum: string;
  plotCount: number;
  downloadPath: string;
}

describe('reference plots: marking, copies for every collector, accuracy against the reference', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  const people: Record<string, { token: string; userId: string }> = {};
  let fileId: string;
  let wholeId: string;
  const at = Date.UTC(2026, 10, 2, 9);

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer' = 'operator') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
  };
  /** Records of plots: round 1 (first assessment) or 2 (a check), land use F unless given. */
  const send = async (operator: string, round: 1 | 2, plots: number[], landUse: (p: number) => string = () => 'F') => {
    const res = await batchRequest(
      ctx.app,
      pid,
      projectToken,
      plots.map((p) => envelope({ recordKey: `${p},${round}`, operator, modifiedOn: at, activelySaved: true, summary: { [LAND_USE]: landUse(p), collect_code_round: String(round) } })),
    );
    expect(res.statusCode, res.body).toBe(200);
  };
  const mark = (payload: unknown, token = owner.token) => call('POST', '/reference/plots', token, payload);
  const reference = async (token = owner.token) => {
    const res = await call('GET', '/reference', token);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const holdings = async () =>
    (await ctx.store.listPlotAssignments(pid, fileId)).map((a) => `${a.plotKey}:${name(a.userId)}:${a.overlap ? 'copy' : 'main'}`).sort();
  const name = (userId: string) => (userId === owner.userId ? 'owner' : Object.keys(people).find((n) => people[n].userId === userId));
  const myAssignment = async (token: string) => {
    const res = await call('GET', '/my-assignment', token);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().assignments as Entry[];
  };
  const download = async (entry: Entry, token: string) => {
    const res = await ctx.app.inject({ method: 'GET', url: entry.downloadPath, headers: bearer(token) });
    expect(res.statusCode, res.body).toBe(200);
    expect(sha256(res.rawPayload)).toBe(entry.checksum);
    return res.body;
  };
  /** The quality figures once they follow the records. */
  const settled = async <T>(get: () => Promise<{ statusCode: number; body: string; json: () => T & { stale?: boolean; figures?: { stale: boolean } } }>, done: (body: T) => boolean) => {
    let last: T | null = null;
    for (let i = 0; i < 200; i++) {
      const res = await get();
      expect(res.statusCode, res.body).toBe(200);
      last = res.json();
      const body = res.json();
      if (!(body.stale ?? body.figures?.stale) && done(body)) return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return last as T;
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Reference');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const n of ['maria', 'jose', 'ana']) await join(n);
    await join('rita', 'reviewer');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const rows = Array.from({ length: 12 }, (_, i) => `${i + 1};-10;${20 + i}`).join('\r\n');
    fileId = (await call('PUT', '/csv-files/north.csv', owner.token, `id;lat;lon\r\n${rows}\r\n`, { 'content-type': 'text/csv' })).json().id;
    wholeId = (await call('PUT', '/csv-files/south.csv', owner.token, 'id;lat;lon\r\n90;-1;1\r\n', { 'content-type': 'text/csv' })).json().id;
    // maria holds 1-6, jose 7-12.
    const put = await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [people.maria.userId, people.jose.userId], order: 'file' });
    expect(put.statusCode, put.body).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('roles; marking gives the assessor the plots and every collector a blind copy (round 2); audited; nothing tells a collector', async () => {
    expect((await call('GET', '/reference', people.maria.token)).statusCode).toBe(403);
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1'] }, people.maria.token)).statusCode).toBe(403);
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1'] }, people.rita.token)).statusCode).toBe(403);
    expect((await call('POST', '/reference/remove', people.rita.token, { all: true })).statusCode).toBe(403);
    const ana = await myAssignment(people.ana.token);
    expect(ana).toEqual([]);

    const res = await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '7'] });
    expect(res.statusCode, res.body).toBe(200);
    // maria's 1 and jose's 7 became copies; each collector got a copy of the other one; not the reviewer.
    expect(res.json().result).toEqual({ unmarked: 0, marked: 2, copiesAdded: 4, copiesDropped: 0 });
    const held = await holdings();
    expect(held.filter((h) => h.startsWith('1:') || h.startsWith('7:'))).toEqual([
      '1:ana:copy',
      '1:jose:copy',
      '1:maria:copy',
      '1:owner:main',
      '7:ana:copy',
      '7:jose:copy',
      '7:maria:copy',
      '7:owner:main',
    ]);
    expect(res.json()).toMatchObject({ count: 2, collectors: 3, max: 500, wholeFiles: [{ csvFileId: wholeId, filename: 'south.csv' }] });
    expect(res.json().plots.map((p: { plot: string; assessor: string; copies: number }) => [p.plot, p.assessor, p.copies])).toEqual([
      ['1', 'owner', 3],
      ['7', 'owner', 3],
    ]);
    expect(res.json().assessors.map((a: { username: string }) => a.username).sort()).toEqual(['owner', 'rita']);
    const log = await ctx.store.listAudit(pid, { limit: 5, action: 'reference.changed' });
    expect(log[0]).toMatchObject({ actorUserId: owner.userId, details: { csvFileId: fileId, added: 2, removed: 0, assessorUserId: owner.userId, copiesAdded: 4 } });

    // ana's plot list: north.csv with plots 1 and 7, round 2, like any copy.
    const [entry] = await myAssignment(people.ana.token);
    expect(Object.keys(entry).sort()).toEqual(['checksum', 'csvFileId', 'downloadPath', 'downloadUrl', 'filename', 'plotCount']);
    expect(entry).toMatchObject({ filename: 'north.csv', plotCount: 2 });
    const body = await download(entry, people.ana.token);
    expect(body).toContain('\r\n1;2;-10;');
    expect(body).toContain('\r\n7;2;-10;');
    // The owner's file has them as first assessments.
    const mine = (await myAssignment(owner.token)).find((e) => e.filename === 'north.csv')!;
    expect(await download(mine, owner.token)).toContain('\r\n1;1;-10;');
    // Nothing a collector reads says "reference".
    for (const n of ['ana', 'maria']) {
      const work = await call('GET', '/my-work?tz=UTC', people[n].token);
      expect(work.statusCode).toBe(200);
      expect(JSON.stringify(work.json())).not.toMatch(/referen|accura|check|cop(y|ies)|overlap/i);
      expect(JSON.stringify(await myAssignment(people[n].token))).not.toMatch(/referen/i);
    }
    // The reviewer reads the figures, not which plots are reference plots.
    const forRita = await reference(people.rita.token);
    expect(forRita).toMatchObject({ coordinator: false, count: 2 });
    expect(forRita.plots).toBeUndefined();
    expect(forRita.figures.byPlot).toBeUndefined();
  });

  it('refuses a collector as assessor, a whole file, unknown plots, plots someone else assessed first; picks free plots at random', async () => {
    const asCollector = await mark({ csvFileId: fileId, assessorUserId: people.maria.userId, plots: ['1'] });
    expect(asCollector.statusCode).toBe(400);
    expect(asCollector.json().code).toBe('bad_assessor');
    expect((await mark({ csvFileId: wholeId, assessorUserId: owner.userId, plots: ['90'] })).json().code).toBe('whole_file');
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '99'] })).json()).toMatchObject({ code: 'unknown_plots', plots: ['99'] });
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId })).statusCode).toBe(400);
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: [] })).statusCode).toBe(400);
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, random: 0 })).statusCode).toBe(400);
    // maria assessed plot 2 (a draft is enough): it cannot be a reference plot.
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${pid}/records:batch`,
      headers: bearer(projectToken),
      payload: { records: [envelope({ recordKey: '2,1', operator: 'maria', modifiedOn: at, activelySaved: false, summary: { [LAND_USE]: 'F' } })] },
    });
    const taken = await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['2', '3'] });
    expect(taken.statusCode).toBe(400);
    expect(taken.json()).toMatchObject({ code: 'assessed_by_others', plots: ['2'] });
    // At random: never plot 2.
    const picked = await mark({ csvFileId: fileId, assessorUserId: people.rita.userId, random: 11 });
    expect(picked.statusCode, picked.body).toBe(200);
    expect(picked.json().plots.map((p: { plot: string }) => p.plot)).toEqual(['1', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(picked.json().plots.every((p: { assessor: string }) => p.assessor === 'rita')).toBe(true);
    // Nothing free is left.
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, random: 1 })).json().code).toBe('none_free');
  });

  it('accuracy against the reference; the reference plots are out of the agreement figures, the queue and the differences', async () => {
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '2', '3'] })).statusCode).toBe(200);
    await send('owner', 1, [1, 2]);
    // ana and jose check all three; ana gets plot 2 wrong, jose plot 1. The reference of 3 is not submitted yet.
    await send('ana', 2, [1, 2, 3], (p) => (p === 2 ? 'G' : 'F'));
    await send('jose', 2, [1, 2, 3], (p) => (p === 1 ? 'G' : 'F'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const got = await settled<any>(() => call('GET', '/reference', owner.token), (b) => b.figures.checks === 4);
    expect(got.figures).toMatchObject({ plots: 3, assessed: 2, checks: 4 });
    expect(got.figures.people).toEqual([
      { username: 'ana', plots: { compared: 2, agreeing: 1, rate: null }, questions: [{ key: LAND_USE, label: expect.any(String), compared: 2, agreeing: 1, rate: null }] },
      { username: 'jose', plots: { compared: 2, agreeing: 1, rate: null }, questions: [{ key: LAND_USE, label: expect.any(String), compared: 2, agreeing: 1, rate: null }] },
    ]);
    expect(got.figures.byPlot).toEqual([
      { plot: '1', assessor: 'owner', assessed: true, checks: 2 },
      { plot: '2', assessor: 'owner', assessed: true, checks: 2 },
      { plot: '3', assessor: 'owner', assessed: false, checks: 2 },
    ]);
    expect(got.plots.map((p: { plot: string; assessed: boolean; checked: number }) => [p.plot, p.assessed, p.checked])).toEqual([
      ['1', true, 2],
      ['2', true, 2],
      ['3', false, 2],
    ]);
    expect(got.people.find((p: { username: string }) => p.username === 'ana')).toMatchObject({ copies: 3, checked: 3 });
    // The checks of reference plots are not agreement: nothing checked, nothing differing, nothing to decide.
    const quality = await call('GET', '/quality', owner.token);
    expect(quality.json()).toMatchObject({ plotsChecked: 0, plotsDiffering: 0, differences: [] });
    const queue = await call('GET', '/quality/queue', owner.token);
    expect(queue.json().counts.difference).toBe(0);
    // The plot page says it is a reference plot, and lists no difference.
    const page = await call('GET', '/plots/1', owner.token);
    expect(page.json()).toMatchObject({ reference: { assessor: 'owner' }, differences: [] });
    expect((await call('GET', '/plots/1', people.rita.token)).json().reference).toEqual({});
    expect((await call('GET', '/plots/4', owner.token)).json().reference).toBeNull();
    // The coordinator's person page shows it; My work never.
    const person = await call('GET', `/people/${people.ana.userId}?tz=UTC`, owner.token);
    expect(person.json().quality.reference).toMatchObject({ username: 'ana', plots: { compared: 2, agreeing: 1 } });
    const work = await call('GET', '/my-work?tz=UTC', people.ana.token);
    expect(work.json().quality.reference).toBeUndefined();
  });

  it('a collector who joins later gets the copies on their next plot list; one who is no longer a collector loses those not done', async () => {
    await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1'] });
    await join('bruno');
    expect((await holdings()).filter((h) => h.includes('bruno'))).toEqual([]);
    const [entry] = await myAssignment(people.bruno.token);
    expect(entry).toMatchObject({ filename: 'north.csv', plotCount: 1 });
    expect(await download(entry, people.bruno.token)).toContain('\r\n1;2;-10;');
    expect((await holdings()).filter((h) => h.includes('bruno'))).toEqual(['1:bruno:copy']);
    // A reviewer's plot list adds nothing.
    await myAssignment(people.rita.token);
    expect((await holdings()).filter((h) => h.includes('rita'))).toEqual([]);
    // ana becomes a reviewer and jose has checked plot 1; the next change of the set drops ana's copy, keeps jose's.
    await send('jose', 2, [1]);
    await ctx.store.setMemberRole(pid, people.ana.userId, 'reviewer');
    await ctx.store.setMemberRole(pid, people.jose.userId, 'reviewer');
    const res = await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['2'] });
    expect(res.json().result).toMatchObject({ marked: 1, copiesDropped: 1 });
    expect((await holdings()).filter((h) => h.startsWith('1:'))).toEqual(['1:bruno:copy', '1:jose:copy', '1:maria:copy', '1:owner:main']);
  });

  it('unmarking drops the copies not done and keeps the checks made; a new division keeps the reference plots; whole again drops them', async () => {
    await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '2'] });
    await send('ana', 2, [2]);
    const removed = await call('POST', '/reference/remove', owner.token, { plots: [{ csvFileId: fileId, plot: '2' }] });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().result).toMatchObject({ unmarked: 1, copiesDropped: 2 });
    expect((await holdings()).filter((h) => h.startsWith('2:'))).toEqual(['2:ana:copy', '2:owner:main']);
    const log = await ctx.store.listAudit(pid, { limit: 1, action: 'reference.changed' });
    expect(log[0].details).toMatchObject({ removed: 1, added: 0, copiesDropped: 2 });
    // A new division deals the other plots; plot 1 keeps its assessor and its copies.
    const redivide = await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [people.jose.userId, people.maria.userId], order: 'file', overlapPercent: 50 });
    expect(redivide.statusCode, redivide.body).toBe(200);
    expect((await holdings()).filter((h) => h.startsWith('1:'))).toEqual(['1:ana:copy', '1:jose:copy', '1:maria:copy', '1:owner:main']);
    expect((await reference()).count).toBe(1);
    // Moving maria's unfinished plots leaves plot 1 as it is.
    const moved = await call('POST', `/csv-files/${fileId}/move-unfinished`, owner.token, { fromUserId: people.maria.userId, toUserId: people.ana.userId });
    expect(moved.statusCode, moved.body).toBe(200);
    expect((await holdings()).filter((h) => h.startsWith('1:'))).toEqual(['1:ana:copy', '1:jose:copy', '1:maria:copy', '1:owner:main']);
    // Whole again: no holdings, no reference plots.
    await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'whole' });
    expect((await reference()).count).toBe(0);
    expect(await ctx.store.listReferencePlots(pid)).toEqual([]);
  });

  it('the check sampling never draws a reference plot, and its copies are no open checks', async () => {
    await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '2'] });
    await send('owner', 1, [1, 2]);
    await send('maria', 1, [3, 4]);
    expect((await call('PUT', '/sampling', owner.token, { firstN: 10, checkers: [people.ana.userId, people.jose.userId] })).statusCode).toBe(200);
    const drawn = await call('POST', '/sampling/draw', owner.token);
    expect(drawn.statusCode, drawn.body).toBe(200);
    const sampled = (await ctx.store.listPlotAssignments(pid, fileId)).filter((a) => a.sampledAt !== undefined).map((a) => a.plotKey).sort();
    expect(sampled).toEqual(['3', '4']);
    const view = (await call('GET', '/sampling', owner.token)).json();
    expect(view.files[0]).toMatchObject({ referenceCopies: 6, sampledCopies: 2 });
    // ana's reference copies (2) are not counted as her open checks.
    const anaChecks = view.checkers.find((c: { username: string }) => c.username === 'ana');
    const joseChecks = view.checkers.find((c: { username: string }) => c.username === 'jose');
    expect(anaChecks.open + joseChecks.open).toBe(2);
  });
});
