import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { SAMPLING_INTERVAL_MS } from '../src/samplingService.js';
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

describe('automatic check sampling: the rule, the draws, and what checkers get', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  const people: Record<string, { token: string; userId: string }> = {};
  let clock: number;
  let fileId: string;
  let wholeId: string;

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer' = 'operator') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
  };
  const submit = async (operator: string, plots: number[], at = clock) => {
    const res = await batchRequest(
      ctx.app,
      pid,
      projectToken,
      plots.map((p) => envelope({ recordKey: `${p},1`, operator, modifiedOn: at, activelySaved: true, summary: { [LAND_USE]: 'F', collect_code_round: '1' } })),
    );
    expect(res.statusCode, res.body).toBe(200);
  };
  const view = async () => {
    const res = await call('GET', '/sampling', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const holdings = () => ctx.store.listPlotAssignments(pid, fileId);
  const drawn = async () => (await holdings()).filter((a) => a.sampledAt !== undefined);
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

  const start = async (overrides: Partial<Config> = {}) => {
    clock = Date.UTC(2026, 9, 5, 9);
    ctx = await makeContext(overrides, { ai: { now: () => clock } });
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Sampling');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const name of ['maria', 'jose', 'ana']) await join(name);
    await join('rita', 'reviewer');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const rows = Array.from({ length: 12 }, (_, i) => `${i + 1};-10;${20 + i}`).join('\r\n');
    fileId = (await call('PUT', '/csv-files/north.csv', owner.token, `id;lat;lon\r\n${rows}\r\n`, { 'content-type': 'text/csv' })).json().id;
    wholeId = (await call('PUT', '/csv-files/south.csv', owner.token, 'id;lat;lon\r\n90;-1;1\r\n', { 'content-type': 'text/csv' })).json().id;
    // maria holds 1-6, jose 7-12.
    const put = await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [people.maria.userId, people.jose.userId], order: 'file' });
    expect(put.statusCode, put.body).toBe(200);
  };

  beforeEach(() => start());

  afterEach(async () => {
    await ctx.app.close();
  });

  it('coordinators only; the rule is checked and audited; whole files are listed apart; nothing drawn until a rule is on', async () => {
    expect((await call('GET', '/sampling', people.maria.token)).statusCode).toBe(403);
    expect((await call('GET', '/sampling', people.rita.token)).statusCode).toBe(403);
    expect((await call('POST', '/sampling/draw', people.maria.token)).statusCode).toBe(403);
    const empty = await view();
    expect(empty).toMatchObject({ rule: null, active: false, due: false, lastDraw: null, noCheckers: false, intervalMinutes: 10 });
    expect(empty.wholeFiles).toEqual([{ csvFileId: wholeId, filename: 'south.csv' }]);
    expect(empty.files).toEqual([expect.objectContaining({ csvFileId: fileId, filename: 'north.csv', use: 'project', plots: 12, submitted: 0, sampledCopies: 0 })]);
    // Collectors may check; the reviewer and the coordinator are not by default (Decision 10).
    expect(empty.checkers.map((c: { username: string }) => c.username)).toEqual(['ana', 'jose', 'maria']);
    expect(empty.warning).toBeNull();
    expect((await call('POST', '/sampling/draw', owner.token)).statusCode).toBe(409);
    expect((await call('PUT', '/sampling', owner.token, { percent: 0 })).statusCode).toBe(400);
    expect((await call('PUT', '/sampling', owner.token, { files: { [wholeId]: { use: 'off' } } })).statusCode).toBe(400);
    const saved = await call('PUT', '/sampling', owner.token, { firstN: 2, percent: null, checkers: null });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ active: true, rule: { firstN: 2, percent: null, checkers: null, files: {} } });
    expect(typeof saved.json().rule.seed).toBe('number');
    // The seed stays when the rule is saved again.
    const again = await call('PUT', '/sampling', owner.token, { firstN: 3 });
    expect(again.json().rule.seed).toBe(saved.json().rule.seed);
    const log = await ctx.store.listAudit(pid, { limit: 10, action: 'settings.changed' });
    expect(log[0].details).toMatchObject({ setting: 'sampling', active: true, firstN: 3 });
    // A coordinator may be chosen; nobody chosen is said.
    const boss = await call('PUT', '/sampling', owner.token, { firstN: 2, checkers: [owner.userId] });
    expect(boss.json()).toMatchObject({ noCheckers: false, checkers: [expect.objectContaining({ username: 'owner', eligible: true })] });
    const none = await call('PUT', '/sampling', owner.token, { firstN: 2, checkers: [] });
    expect(none.json().noCheckers).toBe(true);
  });

  it('a first submission draws at once (blind, round 2 for the checker), then at most once per 10 minutes, the rest on the next plot list', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 2 });
    const before = await myAssignment(people.ana.token);
    expect(before).toEqual([]);
    const mariaBefore = await myAssignment(people.maria.token);
    await submit('maria', [1, 2, 3]);
    // maria's first 2 plots got a check each, given to someone else.
    const first = await drawn();
    expect(first.map((a) => a.plotKey).sort()).toEqual(['1', '2']);
    expect(first.every((a) => a.overlap && a.userId !== people.maria.userId)).toBe(true);
    const v = await view();
    expect(v.lastDraw).toMatchObject({ automatic: true, by: null, drawn: 2, firstN: 2, percent: 0, noChecker: 0 });
    expect(v.files[0]).toMatchObject({ sampledCopies: 2, divisionCopies: 0, submitted: 3, pending: 0 });
    const audit = await ctx.store.listAudit(pid, { limit: 5, action: 'sampling.drawn' });
    expect(audit[0]).toMatchObject({ actorUserId: null, details: { automatic: true, drawn: 2, firstN: 2, percent: 0 } });
    // The checkers' plot lists change: their file now has the plot with round 2.
    const checks = new Map<string, string[]>();
    for (const a of first) checks.set(a.userId, [...(checks.get(a.userId) ?? []), a.plotKey]);
    for (const [userId, plots] of checks) {
      const name = Object.keys(people).find((n) => people[n].userId === userId)!;
      const entries = await myAssignment(people[name].token);
      const entry = entries.find((e) => e.filename === 'north.csv')!;
      const body = await download(entry, people[name].token);
      for (const p of plots) expect(body).toContain(`\r\n${p};2;-10;`);
    }
    // maria's own file did not change (her plots stay round 1, nothing says a check exists).
    expect((await myAssignment(people.maria.token)).map((e) => e.checksum)).toEqual(mariaBefore.map((e) => e.checksum));
    // jose submits within the 10 minutes: due, not drawn yet.
    clock += 60_000;
    await submit('jose', [7, 8]);
    expect((await drawn()).length).toBe(2);
    expect(await view()).toMatchObject({ due: true, pending: { drawn: 2, firstN: 2 } });
    // Still within the interval: a plot list does not draw either.
    await myAssignment(people.ana.token);
    expect((await drawn()).length).toBe(2);
    // Once the 10 minutes are over, the next plot list (a checker's Refresh) draws.
    clock += SAMPLING_INTERVAL_MS;
    await myAssignment(people.ana.token);
    const second = await drawn();
    expect(second.map((a) => a.plotKey).sort()).toEqual(['1', '2', '7', '8']);
    expect(second.filter((a) => ['7', '8'].includes(a.plotKey)).every((a) => a.userId !== people.jose.userId)).toBe(true);
    expect(await view()).toMatchObject({ due: false, pending: { drawn: 0 } });
    // A draw again finds nothing: no double copies.
    const now = await call('POST', '/sampling/draw', owner.token);
    expect(now.statusCode, now.body).toBe(200);
    expect(now.json().draw).toMatchObject({ automatic: false, drawn: 0 });
    expect((await drawn()).length).toBe(4);
    const manual = await ctx.store.listAudit(pid, { limit: 1, action: 'sampling.drawn' });
    expect(manual[0]).toMatchObject({ actorUserId: owner.userId, details: { automatic: false, drawn: 0 } });
    // The last draw shown stays the last one that added copies; the empty one is when it last looked.
    const after = await view();
    expect(after.lastDraw).toMatchObject({ automatic: true, drawn: 2 });
    expect(after.lastCheckedAt).toBe(clock);
  });

  it('the checks stay blind: My work counts the copies as plots, and the files say nothing of a check', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 6, checkers: [people.ana.userId] });
    await submit('maria', [1, 2, 3, 4, 5, 6]);
    expect((await drawn()).map((a) => a.userId)).toEqual(Array(6).fill(people.ana.userId));
    const anaWork = await call('GET', '/my-work?tz=UTC', people.ana.token);
    expect(anaWork.statusCode, anaWork.body).toBe(200);
    const text = JSON.stringify(anaWork.json());
    expect(text).not.toMatch(/check|cop(y|ies)|overlap|sampl/i);
    expect(anaWork.json().person.plots.assigned).toBe(6);
    const mariaWork = JSON.stringify((await call('GET', '/my-work?tz=UTC', people.maria.token)).json());
    expect(mariaWork).not.toMatch(/check|cop(y|ies)|overlap|sampl/i);
    // ana's file is a plain plot file; its entry looks like any other.
    const [entry] = await myAssignment(people.ana.token);
    expect(Object.keys(entry).sort()).toEqual(['checksum', 'csvFileId', 'downloadPath', 'downloadUrl', 'filename', 'plotCount']);
    expect(entry).toMatchObject({ filename: 'north.csv', plotCount: 6 });
    // ana's checks, submitted with round 2, pair with maria's plots in the figures.
    await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/quality`, headers: bearer(owner.token) });
    const res = await batchRequest(
      ctx.app,
      pid,
      projectToken,
      [1, 2, 3, 4, 5, 6].map((p) => envelope({ recordKey: `${p},2`, operator: 'ana', modifiedOn: clock, activelySaved: true, summary: { [LAND_USE]: p === 1 ? 'G' : 'F', collect_code_round: '2' } })),
    );
    expect(res.statusCode).toBe(200);
    let report: { plotsChecked: number; plotsDiffering: number; stale?: boolean } | null = null;
    for (let i = 0; i < 200; i++) {
      const q = await call('GET', '/quality', owner.token);
      expect(q.statusCode, q.body).toBe(200);
      report = q.json();
      if (!q.json().stale && q.json().plotsChecked === 6) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(report).toMatchObject({ plotsChecked: 6, plotsDiffering: 1 });
    // The load: ana holds 6 checks, all done.
    expect((await view()).checkers.find((c: { username: string }) => c.username === 'ana')).toMatchObject({ open: 0, done: 6, sampled: 6 });
  });

  it('a new division keeps the drawn copies; the file page counts them apart; whole again drops them', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 1, checkers: [people.ana.userId] });
    await submit('maria', [1]);
    expect((await drawn()).map((a) => [a.plotKey, a.userId])).toEqual([['1', people.ana.userId]]);
    const page = await call('GET', `/csv-files/${fileId}/distribution`, owner.token);
    expect(page.json().people.find((p: { username: string }) => p.username === 'ana')).toMatchObject({ plots: 1, overlap: 1, sampled: 1 });
    const redivide = await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, {
      mode: 'even',
      people: [people.jose.userId, people.maria.userId],
      order: 'file',
      overlapPercent: 20,
    });
    expect(redivide.statusCode, redivide.body).toBe(200);
    expect((await drawn()).map((a) => [a.plotKey, a.userId])).toEqual([['1', people.ana.userId]]);
    // Plot 1 (maria's, submitted) keeps its one copy: the division gives it no other.
    expect((await holdings()).filter((a) => a.plotKey === '1' && a.overlap)).toHaveLength(1);
    await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'whole' });
    expect(await holdings()).toEqual([]);
    expect((await view()).wholeFiles.map((f: { filename: string }) => f.filename)).toEqual(['north.csv', 'south.csv']);
  });

  it('a rule per file: off, or its own; no checker says so', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 2, files: { [fileId]: { use: 'off' } } });
    await submit('maria', [1, 2]);
    expect(await drawn()).toEqual([]);
    expect((await view()).files[0]).toMatchObject({ use: 'off', pending: 0 });
    await call('PUT', '/sampling', owner.token, { firstN: 2, files: { [fileId]: { use: 'own', firstN: 1, checkers: [people.maria.userId] } } });
    // Only maria may check her own file's plots: nobody can take maria's.
    const res = await call('POST', '/sampling/draw', owner.token);
    expect(res.json().draw).toMatchObject({ drawn: 0, noChecker: 1 });
    expect((await view()).files[0]).toMatchObject({ use: 'own', own: { firstN: 1, checkers: [people.maria.userId], percent: null } });
  });

  it('isolation: a project never reads or draws into another', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 2 });
    const other = await createProject(ctx.app, 'Other');
    expect(await ctx.store.getSampling(other.projectId)).toEqual({ rule: null, dueSince: null, lastAutoDrawAt: null, lastDraw: null, lastCheckedAt: null });
    // A copy for a file of this project, stored "in" the other one, is refused.
    const added = await ctx.store.addSampledCopies(other.projectId, [{ csvFileId: fileId, plotKey: '1', userId: people.ana.userId, reason: 'firstN' }], [], { at: clock, byUserId: null, automatic: true, drawn: 0, firstN: 0, percent: 0, noChecker: 0 }, clock);
    expect(added).toEqual([]);
    expect(await drawn()).toEqual([]);
    // Another project's coordinator cannot read this one's.
    const theirs = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/sampling`, headers: bearer(other.adminToken) });
    expect(theirs.statusCode).toBeGreaterThanOrEqual(401);
  });

  it('a mark during a draw keeps the draw due (the store: B1 claims and draws, B2 marks meanwhile)', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 2 });
    const q = (now: number) => ({ now, markDue: true, minIntervalMs: SAMPLING_INTERVAL_MS });
    const draw = (at: number) => ({ at, byUserId: null, automatic: true, drawn: 0, firstN: 0, percent: 0, noChecker: 0 });
    // B1 claims at 1000 and reads its inputs at 1001; B2 marks at 1002 (no claim: within the interval).
    expect(await ctx.store.claimSamplingDraw(pid, q(1000))).toBe(true);
    expect(await ctx.store.claimSamplingDraw(pid, q(1002))).toBe(false);
    await ctx.store.addSampledCopies(pid, [], [], draw(1003), 1001);
    expect((await ctx.store.getSampling(pid)).dueSince).toBe(1000);
    // A draw whose inputs were read after the last mark ends it.
    await ctx.store.addSampledCopies(pid, [], [], draw(1005), 1004);
    expect((await ctx.store.getSampling(pid)).dueSince).toBeNull();
    // Inputs read before the first mark: still due.
    expect(await ctx.store.claimSamplingDraw(pid, q(2000))).toBe(false);
    await ctx.store.addSampledCopies(pid, [], [], draw(2001), 1999);
    expect((await ctx.store.getSampling(pid)).dueSince).toBe(2000);
  });

  it('a draw that fails never fails the batch, and stays due', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 2 });
    ctx.store.addSampledCopies = async () => {
      throw new Error('the database went away');
    };
    const res = await batchRequest(ctx.app, pid, projectToken, [1, 2].map((p) => envelope({ recordKey: `${p},1`, operator: 'maria', modifiedOn: clock, activelySaved: true })));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().results).toEqual([
      { recordKey: '1,1', status: 'stored' },
      { recordKey: '2,1', status: 'stored' },
    ]);
    expect((await ctx.store.getSampling(pid)).dueSince).toBe(clock);
    expect(await drawn()).toEqual([]);
  });

  it('a draw that takes too long: the batch answers after the inline wait', async () => {
    await ctx.app.close();
    await start({ samplingInlineMs: 50 });
    await call('PUT', '/sampling', owner.token, { firstN: 2 });
    ctx.store.addSampledCopies = () => new Promise(() => {});
    const t0 = performance.now();
    const res = await batchRequest(ctx.app, pid, projectToken, [envelope({ recordKey: '1,1', operator: 'maria', modifiedOn: clock, activelySaved: true })]);
    const ms = performance.now() - t0;
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().results).toEqual([{ recordKey: '1,1', status: 'stored' }]);
    expect(ms).toBeLessThan(1000);
  });

  it('a disabled checker’s drawn copy not done is drawn again for someone else, the old one dropped', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 1, checkers: [people.ana.userId, people.rita.userId] });
    await submit('maria', [1]);
    const [first] = await drawn();
    const was = first.userId === people.ana.userId ? 'ana' : 'rita';
    const other = was === 'ana' ? 'rita' : 'ana';
    expect(await ctx.store.disableUser(people[was].userId, owner.userId)).toBe('ok');
    const res = await call('POST', '/sampling/draw', owner.token);
    expect(res.json().draw).toMatchObject({ drawn: 1 });
    expect((await drawn()).map((a) => [a.plotKey, a.userId])).toEqual([['1', people[other].userId]]);
    const log = await ctx.store.listAudit(pid, { limit: 1, action: 'sampling.drawn' });
    expect(log[0].details).toMatchObject({ drawn: 1, replaced: 1 });
    // Drawing again adds nothing: the plot has its new copy.
    expect((await call('POST', '/sampling/draw', owner.token)).json().draw).toMatchObject({ drawn: 0 });
  });

  it('"Draw now" waits for an automatic draw running and then makes its own, audited as the coordinator’s', async () => {
    await call('PUT', '/sampling', owner.token, { firstN: 2 });
    const real = ctx.store.addSampledCopies.bind(ctx.store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    ctx.store.addSampledCopies = async (...args) => {
      calls += 1;
      if (calls === 1) await gate;
      return real(...args);
    };
    // The batch's automatic draw is held at the gate.
    const batch = submit('maria', [1, 2, 3]);
    for (let i = 0; i < 200 && calls === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(1);
    const manual = call('POST', '/sampling/draw', owner.token);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // "Draw now" waits: it did not join the automatic draw, nor start its own yet.
    expect(calls).toBe(1);
    release();
    await batch;
    const res = await manual;
    expect(res.statusCode, res.body).toBe(200);
    expect(calls).toBe(2);
    expect(res.json().draw).toMatchObject({ automatic: false, drawn: 0 });
    const log = await ctx.store.listAudit(pid, { limit: 5, action: 'sampling.drawn' });
    expect(log.map((e) => [e.actorUserId, e.details.automatic])).toEqual([
      [owner.userId, false],
      [null, true],
    ]);
  });
});
