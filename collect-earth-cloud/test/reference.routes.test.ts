import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const CRLF = String.fromCharCode(13, 10);
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
    // Decision 3: the figures per question only, no one's accuracy by name.
    expect(forRita.figures.people).toBeUndefined();
    expect(Object.keys(forRita.figures).sort()).toEqual(['assessed', 'checks', 'computedAt', 'plots', 'questions', 'stale']);
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
    // A reviewer neither finds nor opens a reference plot (which plots they are is the coordinators').
    expect((await call('GET', '/plots/1', people.rita.token)).statusCode).toBe(404);
    expect((await call('GET', '/plots/4', people.rita.token)).statusCode).toBe(200);
    const found = (q: string, token: string) => call('GET', `/plots/search?q=${q}`, token).then((r) => r.json().plots.map((p: { plot: string }) => p.plot));
    expect(await found('1', owner.token)).toContain('1');
    expect(await found('1', people.rita.token)).not.toContain('1');
    expect(await found('1', people.rita.token)).toContain('10');
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

  it('a role change, a removal, an account disabled or enabled put the copies right at once; two plot lists at once add each copy once', async () => {
    await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '2'] });
    await send('jose', 2, [1]);
    const copiesOf = async (n: string) => (await holdings()).filter((h) => h.endsWith(`:${n}:copy`));
    // ana a reviewer: her copies (untouched) go; jose a reviewer: the copy of plot 1 he checked stays.
    expect((await call('PUT', `/members/${people.ana.userId}`, owner.token, { role: 'reviewer' })).statusCode).toBe(200);
    expect((await call('PUT', `/members/${people.jose.userId}`, owner.token, { role: 'reviewer' })).statusCode).toBe(200);
    expect(await copiesOf('ana')).toEqual([]);
    expect(await copiesOf('jose')).toEqual(['1:jose:copy']);
    // ana a collector again: both back.
    await call('PUT', `/members/${people.ana.userId}`, owner.token, { role: 'operator' });
    expect(await copiesOf('ana')).toEqual(['1:ana:copy', '2:ana:copy']);
    // maria's account disabled: her untouched copies go; enabled again: back.
    const disabled = await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${people.maria.userId}/disable`, headers: bearer(owner.token) });
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(await copiesOf('maria')).toEqual([]);
    await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${people.maria.userId}/enable`, headers: bearer(owner.token) });
    expect(await copiesOf('maria')).toEqual(['1:maria:copy', '2:maria:copy']);
    // Removing ana: her holdings go with her.
    expect((await call('DELETE', `/members/${people.ana.userId}`, owner.token)).statusCode).toBe(204);
    expect(await copiesOf('ana')).toEqual([]);
    // A newcomer's two plot lists at once (Collect Earth's Refresh twice): each copy once.
    await join('carla');
    await Promise.all([myAssignment(people.carla.token), myAssignment(people.carla.token)]);
    expect(await copiesOf('carla')).toEqual(['1:carla:copy', '2:carla:copy']);
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

  it('reference plots are never decided (set, bulk), never in the queue; the export says reference and leaves final blank', async () => {
    // Plot 3: the owner's first assessment and maria's check (her division copy), decided before it is marked.
    await ctx.store.setDivision(pid, fileId, { mode: 'manual' }, [
      ...(await ctx.store.listPlotAssignments(pid, fileId)).filter((a) => a.plotKey !== '3'),
      { plotKey: '3', userId: owner.userId, overlap: false },
      { plotKey: '3', userId: people.maria.userId, overlap: true },
    ]);
    await send('owner', 1, [3]);
    await send('maria', 2, [3], () => 'G');
    expect((await settled(() => call('GET', '/quality', owner.token), (b: { plotsDiffering: number }) => b.plotsDiffering === 1)).plotsDiffering).toBe(1);
    expect((await call('PUT', '/quality/decisions/3', owner.token, { decision: 'check' })).statusCode).toBe(200);
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1', '2', '3'] })).statusCode).toBe(200);
    // The owner's reference assessments of 1 and 2 at the same moment: "very fast" flags them, yet the queue never lists them.
    await send('owner', 1, [1, 2]);
    const refused = await call('PUT', '/quality/decisions/1', owner.token, { decision: 'first' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('reference_plot');
    // A reviewer is answered as for a plot that is not there (Decision 10).
    expect((await call('PUT', '/quality/decisions/1', people.rita.token, { decision: 'first' })).statusCode).toBe(404);
    const flags = await settled(() => call('GET', '/quality/flags', owner.token), (b: { flags: { plot: string }[] }) => b.flags.some((f) => f.plot === '2'));
    expect(flags.flags.some((f: { plot: string }) => f.plot === '2')).toBe(true);
    const queue = await call('GET', '/quality/queue', owner.token);
    expect(queue.json().items.map((i: { plot: string }) => i.plot)).toEqual([]);
    expect(queue.json().counts).toEqual({ difference: 0, flag: 0, resubmitted: 0 });
    const bulk = await call('POST', '/quality/decisions:bulk?dryRun=1', owner.token, { rule: 'check_by_reviewer' });
    expect(bulk.json().count).toBe(0);
    // The export: reference "yes" on the reference plots' records, final blank for them (the old decision on 3 too).
    const csv = (await call('GET', '/export.csv', owner.token)).rawPayload.subarray(3).toString('utf8').split(CRLF);
    expect(csv[0]).toMatch(/^record_key,plot,round,assessment,final,reference,operator,/);
    const row = (key: string, op: string) => csv.find((l) => l.startsWith(`"${key}",`) && l.includes(`,${op},`))!.split(',').slice(0, 9).join(',');
    expect(row('3,1', 'owner')).toBe('"3,1",3,1,main,,yes,owner,true');
    expect(row('3,2', 'maria')).toBe('"3,2",3,2,check,,yes,maria,true');
  });

  it('a plot sent back before it was marked a reference plot is no longer sent back (M-1)', async () => {
    await ctx.store.setDivision(pid, fileId, { mode: 'manual' }, [
      ...(await ctx.store.listPlotAssignments(pid, fileId)).filter((a) => a.plotKey !== '3'),
      { plotKey: '3', userId: owner.userId, overlap: false },
      { plotKey: '3', userId: people.maria.userId, overlap: true },
    ]);
    await send('owner', 1, [3]);
    await send('maria', 2, [3], () => 'G');
    await settled(() => call('GET', '/quality', owner.token), (b: { plotsDiffering: number }) => b.plotsDiffering === 1);
    expect((await call('PUT', '/quality/decisions/3', owner.token, { decision: 'recheck' })).statusCode).toBe(200);
    const again = (entries: Entry[]) => entries.filter((e) => e.filename.startsWith('To check again'));
    expect(again(await myAssignment(people.maria.token))).toHaveLength(1);
    expect((await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['3'] })).statusCode).toBe(200);
    expect(again(await myAssignment(people.maria.token))).toEqual([]);
  });

  it('copies in two divided files, one submitted as main in the second: the listed checksum is the downloaded one', async () => {
    // ana holds copies in north.csv (reference plot 1) and in west.csv (plot 22, a division copy).
    await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['1'] });
    const westRows = Array.from({ length: 4 }, (_, i) => `${21 + i};-11;${30 + i}`).join('\r\n');
    const westId = (await call('PUT', '/csv-files/west.csv', owner.token, `id;lat;lon\r\n${westRows}\r\n`, { 'content-type': 'text/csv' })).json().id;
    await ctx.store.setDivision(pid, westId, { mode: 'manual' }, [
      { plotKey: '21', userId: people.ana.userId, overlap: false },
      { plotKey: '22', userId: people.jose.userId, overlap: false },
      { plotKey: '22', userId: people.ana.userId, overlap: true },
    ]);
    // ana submitted plot 22 as a first assessment (round 1): her copy of it is served as main.
    await send('ana', 1, [22]);
    const entries = await myAssignment(people.ana.token);
    expect(entries.map((e) => e.filename).sort()).toEqual(['north.csv', 'west.csv']);
    for (const entry of entries) {
      const res = await ctx.app.inject({ method: 'GET', url: entry.downloadPath, headers: bearer(people.ana.token) });
      expect(res.statusCode, `${entry.filename}: ${res.body}`).toBe(200);
      expect(sha256(res.rawPayload)).toBe(entry.checksum);
    }
    const west = entries.find((e) => e.filename === 'west.csv')!;
    expect(await download(west, people.ana.token)).toContain('\r\n22;1;-11;');
  });

  it('a plot file uploaded (new or replaced) that holds a reference plot of another file is refused; a division keeps a plot marked meanwhile', async () => {
    await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['3'] });
    const refused = await call('PUT', '/csv-files/south.csv', owner.token, 'id;lat;lon\r\n90;-1;1\r\n3;-1;2\r\n', { 'content-type': 'text/csv' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'reference_plot_in_file', plots: ['3'] });
    expect((await call('PUT', '/csv-files/other.csv', owner.token, 'id;lat;lon\r\n3;-1;2\r\n', { 'content-type': 'text/csv' })).statusCode).toBe(409);
    // The reference plot's own file may be uploaded again with it.
    const rows = Array.from({ length: 12 }, (_, i) => `${i + 1};-10;${20 + i}`).join('\r\n');
    expect((await call('PUT', '/csv-files/north.csv', owner.token, `id;lat;lon\r\n${rows}\r\n`, { 'content-type': 'text/csv' })).statusCode).toBe(201);
    // A division saved with holdings read before plot 5 was marked keeps plot 5 as marked (setDivision re-reads under the lock).
    const stale = await ctx.store.listPlotAssignments(pid, fileId);
    await mark({ csvFileId: fileId, assessorUserId: owner.userId, plots: ['5'] });
    await ctx.store.setDivision(pid, fileId, { mode: 'manual' }, stale);
    expect((await holdings()).filter((h) => h.startsWith('5:'))).toEqual(['5:ana:copy', '5:jose:copy', '5:maria:copy', '5:owner:main']);
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
