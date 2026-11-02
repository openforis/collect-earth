import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePlotFile } from '../src/plots.js';
import { fileKeyCount } from '../src/rounds.js';
import { recheckFileId, recheckFilename, recheckFilesOf, sentBackOf, sentBackTo } from '../src/sendBack.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { QualityDecision, RecordRow } from '../src/types.js';
import { demoCep, idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

interface Entry {
  csvFileId: string;
  filename: string;
  checksum: string;
  plotCount: number;
  downloadPath: string;
  downloadUrl: string | null;
}

describe('the plots sent back: who, which round, submitted again (pure)', () => {
  const row = (recordKey: string, operator: string, over: Partial<RecordRow> = {}): RecordRow => ({
    projectId: 'p',
    recordKey,
    operator,
    modifiedOn: 100,
    receivedAt: 100,
    activelySaved: true,
    step: 1,
    xml: null,
    summary: { a: 'x' },
    deleted: false,
    deletedOn: null,
    ...over,
  });
  const info = { state: 'added', keyCount: 2, roundIndex: 1, reassessmentCode: '2', roundCodes: [] } as never;
  const context = { info, units: new Set(['1', '2', '3']), copyHolders: new Map([['2', new Set(['jose'])]]) };
  const decision = (plot: string, over: Partial<QualityDecision> = {}): QualityDecision => ({ plot, decision: 'recheck', comment: 'look', decidedBy: 'coord', decidedAt: 200, ...over });

  it('everyone with a record of the plot, their own assessment, each submitted again or not', () => {
    const records = [row('2,1', 'maria'), row('2,2', 'jose'), row('1,1', 'maria'), row('3,1', 'ana', { deleted: true })];
    const decisions = [decision('2'), decision('1', { decision: 'first' }), decision('3')];
    expect(sentBackOf({ username: 'maria', decisions, records, context, outline: null })).toEqual([
      { plot: '2', comment: 'look', decidedAt: 200, decidedBy: 'coord', assessment: 'main', submittedAgain: false },
    ]);
    expect(sentBackOf({ username: 'jose', decisions, records, context, outline: null })).toMatchObject([{ plot: '2', assessment: 'check', submittedAgain: false }]);
    // A deleted record is no assessment of the plot.
    expect(sentBackOf({ username: 'ana', decisions, records, context, outline: null })).toEqual([]);
    // Submitted again after the decision (received and saved after it).
    const again = [...records.slice(1), row('2,1', 'maria', { modifiedOn: 300, receivedAt: 300 })];
    expect(sentBackOf({ username: 'maria', decisions, records: again, context, outline: null })[0].submittedAgain).toBe(true);
    // Saved after it but a draft: not submitted again.
    const draft = [...records.slice(1), row('2,1', 'maria', { modifiedOn: 300, receivedAt: 300, activelySaved: false })];
    expect(sentBackOf({ username: 'maria', decisions, records: draft, context, outline: null })[0].submittedAgain).toBe(false);
  });

  it('one file per plot file: the first one the person holds the plot in, else the first that has it', () => {
    const plots = [
      { plot: '1', comment: null, decidedAt: 1, decidedBy: null, assessment: 'main' as const, submittedAgain: false },
      { plot: '2', comment: null, decidedAt: 1, decidedBy: null, assessment: 'check' as const, submittedAgain: false },
      { plot: '3', comment: null, decidedAt: 1, decidedBy: null, assessment: 'main' as const, submittedAgain: true },
      { plot: '9', comment: null, decidedAt: 1, decidedBy: null, assessment: 'main' as const, submittedAgain: false },
    ];
    const files = [
      { id: 'a', filename: 'a.csv' },
      { id: 'b', filename: 'b.csv' },
    ];
    const units = new Map([
      ['a', ['1', '2', '3']],
      ['b', ['2', '3']],
    ]);
    const { plots: listed, files: out } = recheckFilesOf(plots, files, units, (file, plot) => file === 'b' && plot === '2');
    expect(out).toEqual([
      { id: recheckFileId('a'), filename: recheckFilename('a.csv'), sourceFileId: 'a', plots: new Set(['1']), checks: new Set() },
      { id: recheckFileId('b'), filename: recheckFilename('b.csv'), sourceFileId: 'b', plots: new Set(['2']), checks: new Set(['2']) },
    ]);
    expect(listed.map((p) => [p.plot, p.file])).toEqual([
      ['1', 'To check again – a.csv'],
      ['2', 'To check again – b.csv'],
      ['3', null],
      ['9', null],
    ]);
  });

  it('the file id is a UUID, the same on every call, and another for another plot file', () => {
    expect(recheckFileId('f1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(recheckFileId('f1')).toBe(recheckFileId('f1'));
    expect(recheckFileId('f2')).not.toBe(recheckFileId('f1'));
  });

  it('sentBackTo loads the plot context (and the outline) only when a plot of theirs may still be waiting', async () => {
    const store = new InMemoryStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const loads = { context: 0, outline: 0 };
    const deps = (waitingOnly: boolean) => ({
      waitingOnly,
      context: async () => {
        loads.context += 1;
        return { info: null, units: new Set(['1', '2']), copyHolders: new Map(), mainHolders: new Map(), fileUnits: new Map() };
      },
      outline: async () => {
        loads.outline += 1;
        return null;
      },
    });
    const user = { userId: 'u-maria', username: 'maria' };
    // No recheck decision: nothing read.
    expect(await sentBackTo(store, projectId, user, deps(true))).toEqual({ plots: [], files: [] });
    await store.putRecord(row('1', 'maria', { projectId, modifiedOn: 100, receivedAt: 100 }));
    await store.putRecord(row('2', 'maria', { projectId, modifiedOn: 100, receivedAt: 100 }));
    const decided = await store.setQualityDecision(projectId, '1', 'recheck', null, null, null);
    await store.setQualityDecision(projectId, '2', 'recheck', null, null, [{ operator: 'maria', hash: 1, full: 1 }]);
    // Waiting (records from before the decisions): the context is loaded.
    expect((await sentBackTo(store, projectId, user, deps(true))).plots.map((p) => [p.plot, p.submittedAgain])).toEqual([
      ['1', false],
      ['2', false],
    ]);
    expect(loads.context).toBe(1);
    // Both submitted again (received and saved after): neither the outline nor the context for the files.
    const later = decided.decidedAt + 1000;
    await store.putRecord(row('1', 'maria', { projectId, modifiedOn: later, receivedAt: later }));
    await store.putRecord(row('2', 'maria', { projectId, modifiedOn: later, receivedAt: later }));
    loads.context = 0;
    loads.outline = 0;
    expect(await sentBackTo(store, projectId, user, deps(true))).toEqual({ plots: [], files: [] });
    expect(loads).toEqual({ context: 0, outline: 0 });
    // Someone else's records only: nothing loaded either.
    expect(await sentBackTo(store, projectId, { userId: 'u-jose', username: 'jose' }, deps(true))).toEqual({ plots: [], files: [] });
    expect(loads).toEqual({ context: 0, outline: 0 });
    // My work and the person page want every plot sent back, submitted again too.
    expect((await sentBackTo(store, projectId, user, deps(false))).plots.map((p) => [p.plot, p.submittedAgain])).toEqual([
      ['1', true],
      ['2', true],
    ]);
  });
});

describe('"To check again" plot files in my-assignment', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let jose: { token: string; userId: string };
  let ana: { token: string; userId: string };

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string) => {
    const invite = await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string, userId: res.json().userId as string };
  };
  const myAssignment = async (token: string) => {
    const res = await call('GET', '/my-assignment', token);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().assignments as Entry[];
  };
  /** The "To check again" entry of a person, downloaded as Collect Earth does (the checksum checked). */
  const recheck = async (token: string) => {
    const entries = await myAssignment(token);
    const entry = entries.find((e) => e.filename.startsWith('To check again'));
    if (!entry) return null;
    const res = await ctx.app.inject({ method: 'GET', url: entry.downloadPath, headers: bearer(token) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-checksum-sha256']).toBe(entry.checksum);
    expect(sha256(res.rawPayload)).toBe(entry.checksum);
    return { entry, entries, body: res.body, raw: res.rawPayload, headers: res.headers };
  };
  /** The figures caught up with the records (a decision then keeps what it saw). */
  const fresh = async () => {
    for (let i = 0; i < 200; i++) {
      const res = await call('GET', '/quality/queue', owner.token);
      expect(res.statusCode, res.body).toBe(200);
      if (!res.json().stale) return res.json();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };
  const send = async (records: ReturnType<typeof envelope>[]) => {
    // Received after anything before it (a later millisecond).
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await batchRequest(ctx.app, pid, projectToken, records);
    expect(res.statusCode, res.body).toBe(200);
  };
  const t0 = Date.UTC(2026, 9, 1, 9);
  const summary = (landUse: string, round: string) => ({ [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: round });
  let fileId: string;

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const created = await createProject(ctx.app, 'Send back');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    maria = await join('maria');
    jose = await join('jose');
    ana = await join('ana');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  /** The round the server adds: maria holds 1-3, jose 4 and 2 as a copy (a check). */
  const addedRound = async () => {
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const csv = 'id;lat;lon;area\r\n1;-10;20;a\r\n2;-10.5;20.5;b\r\n3;-11;21;"x;y"\r\n4;-12;22;d\r\n';
    fileId = (await call('PUT', '/csv-files/North%20%C3%91and%C3%BA.csv', owner.token, csv, { 'content-type': 'text/csv' })).json().id;
    await ctx.store.setDivision(pid, fileId, { mode: 'manual' }, [
      { plotKey: '1', userId: maria.userId, overlap: false },
      { plotKey: '2', userId: maria.userId, overlap: false },
      { plotKey: '3', userId: maria.userId, overlap: false },
      { plotKey: '2', userId: jose.userId, overlap: true },
      { plotKey: '4', userId: jose.userId, overlap: false },
    ]);
    await send([
      envelope({ recordKey: '1,1', operator: 'maria', modifiedOn: t0, summary: summary('F', '1') }),
      envelope({ recordKey: '2,1', operator: 'maria', modifiedOn: t0, summary: summary('F', '1') }),
      envelope({ recordKey: '3,1', operator: 'maria', modifiedOn: t0, summary: summary('F', '1') }),
      envelope({ recordKey: '2,2', operator: 'jose', modifiedOn: t0, summary: summary('G', '2') }),
    ]);
    await fresh();
  };

  it('both people get their own plot back, with the round of their own record, in a file Collect Earth reads as their plots', async () => {
    await addedRound();
    // Nothing sent back yet: no extra file.
    expect((await myAssignment(maria.token)).map((e) => e.filename)).toEqual(['North Ñandú.csv']);
    const decided = await call('PUT', '/quality/decisions/2', owner.token, { decision: 'recheck', comment: 'Look at the trees' });
    expect(decided.statusCode, decided.body).toBe(200);

    const name = 'To check again – North Ñandú.csv';
    const m = (await recheck(maria.token))!;
    expect(m.entry).toEqual({
      csvFileId: recheckFileId(fileId),
      filename: name,
      checksum: sha256('id;round;lat;lon;area\r\n2;1;-10.5;20.5;b\r\n'),
      plotCount: 1,
      downloadPath: `/v1/projects/${pid}/csv-files/${recheckFileId(fileId)}/content?mine=1&v=${m.entry.checksum}`,
      downloadUrl: null,
    });
    // Listed after the person's other files (Collect Earth keeps the last match selected).
    expect(m.entries.map((e) => e.filename)).toEqual(['North Ñandú.csv', name]);
    expect(m.body).toBe('id;round;lat;lon;area\r\n2;1;-10.5;20.5;b\r\n');
    // Collect Earth reads the survey's keys (id, round) first: the key of maria's record.
    const keyCount = fileKeyCount(await ctx.store.getRoundInfo(pid)) + 1;
    expect(parsePlotFile(m.raw, keyCount).plotIds).toEqual(['2,1']);
    // The header can carry the name (beyond Latin-1).
    expect(m.headers['content-disposition']).toBe(`attachment; filename="To_check_again___North__and_.csv"; filename*=UTF-8''${encodeURIComponent(name)}`);

    // jose's check comes back as a check: round 2, the key of his record. Blind: the same name,
    // the same id, the same kind of entry, nothing of maria's.
    const j = (await recheck(jose.token))!;
    expect(j.entry).toMatchObject({ csvFileId: recheckFileId(fileId), filename: name, plotCount: 1 });
    expect(Object.keys(j.entry).sort()).toEqual(Object.keys(m.entry).sort());
    expect(j.body).toBe('id;round;lat;lon;area\r\n2;2;-10.5;20.5;b\r\n');
    expect(parsePlotFile(j.raw, keyCount).plotIds).toEqual(['2,2']);
    expect(JSON.stringify(j.entries)).not.toMatch(/maria|\bcheck\b(?! again)|cop(y|ies)|overlap/i);
    // Someone who made no record of it gets nothing; the file is no one else's to download.
    expect(await recheck(ana.token)).toBeNull();
    expect((await ctx.app.inject({ method: 'GET', url: m.entry.downloadPath, headers: bearer(ana.token) })).statusCode).toBe(404);
    // A coordinator (who made no record) gets 404 too: the file is per person.
    expect((await call('GET', `/csv-files/${recheckFileId(fileId)}/content`, owner.token)).statusCode).toBe(404);
    // Stable: the same id, name and checksum on every call.
    expect((await recheck(maria.token))!.entry).toEqual(m.entry);

    // A second plot sent back to maria: the same file, one plot more; the old checksum is refused.
    expect((await call('PUT', '/quality/decisions/3', owner.token, { decision: 'recheck' })).statusCode).toBe(200);
    const stale = await ctx.app.inject({ method: 'GET', url: m.entry.downloadPath, headers: bearer(maria.token) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('changed');
    const two = (await recheck(maria.token))!;
    expect(two.entry).toMatchObject({ csvFileId: recheckFileId(fileId), filename: name, plotCount: 2 });
    expect(two.body).toBe('id;round;lat;lon;area\r\n2;1;-10.5;20.5;b\r\n3;1;-11;21;"x;y"\r\n');
  });

  it('a plot leaves a person\'s file when they submit it again; the queue names who it is still waiting for', async () => {
    await addedRound();
    const decided = await call('PUT', '/quality/decisions/2', owner.token, { decision: 'recheck' });
    const decidedAt = decided.json().decidedAt as number;
    // The answers the decision saw, synced late: still waiting.
    await send([envelope({ recordKey: '2,1', operator: 'maria', modifiedOn: t0, summary: summary('F', '1') })]);
    expect(await recheck(maria.token)).not.toBeNull();
    // Saved again (going through the tabs) but not submitted: still waiting.
    await send([envelope({ recordKey: '2,1', operator: 'maria', modifiedOn: decidedAt + 1000, activelySaved: false, summary: summary('F', '1') })]);
    const listed = (await recheck(maria.token))!;
    expect(listed).not.toBeNull();
    // Submitted again: gone from maria's file (and the download), still in jose's.
    await send([envelope({ recordKey: '2,1', operator: 'maria', modifiedOn: decidedAt + 2000, summary: summary('F', '1') })]);
    const m = await myAssignment(maria.token);
    expect(m.map((e) => e.filename)).toEqual(['North Ñandú.csv']);
    expect((await call('GET', `/csv-files/${recheckFileId(fileId)}/content?mine=1`, maria.token)).statusCode).toBe(404);
    // The file listed a moment ago emptied before its download: 409 changed (Refresh), as any file that changed.
    const emptied = await ctx.app.inject({ method: 'GET', url: listed.entry.downloadPath, headers: bearer(maria.token) });
    expect(emptied.statusCode).toBe(409);
    expect(emptied.json().error).toBe('changed');
    // Someone who never had it (holding no plot of the plot file) still gets 404 with the same path.
    expect((await ctx.app.inject({ method: 'GET', url: listed.entry.downloadPath, headers: bearer(ana.token) })).statusCode).toBe(404);
    expect(await recheck(jose.token)).not.toBeNull();
    let queue = await fresh();
    expect(queue.items.find((i: { plot: string }) => i.plot === '2')).toMatchObject({ section: 'resubmitted', resubmitted: [{ operator: 'maria' }], waiting: ['jose'] });
    // jose submits again with other answers: gone for him too; the queue waits for nobody.
    await send([envelope({ recordKey: '2,2', operator: 'jose', modifiedOn: decidedAt + 3000, summary: summary('F', '2') })]);
    expect(await recheck(jose.token)).toBeNull();
    queue = await fresh();
    expect(queue.items.find((i: { plot: string }) => i.plot === '2')).toMatchObject({ section: 'resubmitted', waiting: [] });
    // Sent back once more (a new decision): back in both files.
    expect((await call('PUT', '/quality/decisions/2', owner.token, { decision: 'recheck' })).statusCode).toBe(200);
    expect(await recheck(maria.token)).not.toBeNull();
    expect(await recheck(jose.token)).not.toBeNull();
  });

  it('the queue waits only for people still in the project: someone removed or disabled is named apart and does not block', async () => {
    await addedRound();
    const decided = await call('PUT', '/quality/decisions/2', owner.token, { decision: 'recheck' });
    const decidedAt = decided.json().decidedAt as number;
    await send([envelope({ recordKey: '2,1', operator: 'maria', modifiedOn: decidedAt + 2000, summary: summary('F', '1') })]);
    expect((await fresh()).items.find((i: { plot: string }) => i.plot === '2')).toMatchObject({ waiting: ['jose'], left: [] });
    // jose disabled by the server owner: no longer waited for.
    expect(await ctx.store.disableUser(jose.userId, owner.userId)).toBe('ok');
    expect((await fresh()).items.find((i: { plot: string }) => i.plot === '2')).toMatchObject({ waiting: [], left: ['jose'] });
    // Enabled again and then removed from the project: the same.
    await ctx.store.enableUser(jose.userId);
    expect((await fresh()).items.find((i: { plot: string }) => i.plot === '2')).toMatchObject({ waiting: ['jose'], left: [] });
    await ctx.store.removeMember(pid, jose.userId);
    expect((await fresh()).items.find((i: { plot: string }) => i.plot === '2')).toMatchObject({ waiting: [], left: ['jose'] });
  });

  it('undoing or changing the decision takes the plots out of the files', async () => {
    await addedRound();
    await call('PUT', '/quality/decisions/2', owner.token, { decision: 'recheck' });
    expect(await recheck(jose.token)).not.toBeNull();
    expect((await call('DELETE', '/quality/decisions/2', owner.token)).statusCode).toBe(204);
    expect(await recheck(maria.token)).toBeNull();
    expect(await recheck(jose.token)).toBeNull();
    await call('PUT', '/quality/decisions/2', owner.token, { decision: 'recheck' });
    expect(await recheck(maria.token)).not.toBeNull();
    await call('PUT', '/quality/decisions/2', owner.token, { decision: 'first' });
    expect(await recheck(maria.token)).toBeNull();
    expect(await recheck(jose.token)).toBeNull();
  });

  it('a survey of its own round: the check comes back with the reassessment code, as the copy was served', async () => {
    await call('PUT', '/cep', owner.token, demoCep(), { 'content-type': 'application/zip' });
    const csv = 'id,round,lat,lon\n17,1,0,0\n18,1,1,1\n';
    fileId = (await call('PUT', '/csv-files/own.csv', owner.token, csv, { 'content-type': 'text/csv' })).json().id;
    await ctx.store.setDivision(pid, fileId, { mode: 'manual' }, [
      { plotKey: '17,1', userId: maria.userId, overlap: false },
      { plotKey: '18,1', userId: maria.userId, overlap: false },
      { plotKey: '17,1', userId: jose.userId, overlap: true },
    ]);
    await send([
      envelope({ recordKey: '17,1', operator: 'maria', modifiedOn: t0, summary: summary('F', '1') }),
      envelope({ recordKey: '17,2', operator: 'jose', modifiedOn: t0, summary: summary('G', '2') }),
    ]);
    await fresh();
    expect((await call('PUT', `/quality/decisions/${encodeURIComponent('17,1')}`, owner.token, { decision: 'recheck' })).statusCode).toBe(200);
    expect((await recheck(maria.token))!.body).toBe('id,round,lat,lon\n17,1,0,0\n');
    const j = (await recheck(jose.token))!;
    expect(j.body).toBe('id,round,lat,lon\n17,2,0,0\n');
    expect(parsePlotFile(j.raw, 2).plotIds).toEqual(['17,2']);
  });

  it('a whole file and no round column: the rows as uploaded; My work lists the same plots, never saying which are checks', async () => {
    // No project file: plots have an id only, the files are served as uploaded.
    const csv = 'id,lat,lon\n1,0,0\n2,1,1\n';
    fileId = (await call('PUT', '/csv-files/whole.csv', owner.token, csv, { 'content-type': 'text/csv' })).json().id;
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: fileId }] });
    const other = (await call('PUT', '/csv-files/checks.csv', owner.token, 'id,lat,lon\n2,1,1\n', { 'content-type': 'text/csv' })).json().id;
    await ctx.store.setDivision(pid, other, { mode: 'manual' }, [
      { plotKey: '2', userId: jose.userId, overlap: true },
      { plotKey: '2', userId: ana.userId, overlap: false },
    ]);
    await send([
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: t0, summary: { [LAND_USE]: 'F' } }),
      envelope({ recordKey: '2', operator: 'jose', modifiedOn: t0, summary: { [LAND_USE]: 'G' } }),
    ]);
    await call('PUT', '/quality/decisions/2', owner.token, { decision: 'recheck', comment: 'Trees?' });
    const m = (await recheck(maria.token))!;
    expect(m.entry.filename).toBe('To check again – whole.csv');
    expect(m.body).toBe('id,lat,lon\n2,1,1\n');
    // jose holds it in checks.csv: his file comes from there.
    const j = (await recheck(jose.token))!;
    expect(j.entry).toMatchObject({ csvFileId: recheckFileId(other), filename: 'To check again – checks.csv' });
    expect(j.body).toBe('id,lat,lon\n2,1,1\n');

    // My work: the same plot, the comment, the file it is in; nothing says it is jose's check.
    const work = await call('GET', '/my-work', jose.token);
    expect(work.statusCode, work.body).toBe(200);
    expect(work.json().quality.sentBack).toEqual([{ plot: '2', comment: 'Trees?', decidedAt: expect.any(Number), submittedAgain: false, file: 'To check again – checks.csv' }]);
    expect(JSON.stringify(work.json().quality.sentBack)).not.toMatch(/assessment|\bcheck\b(?! again)|cop(y|ies)|main/i);
    // The coordinator's page of maria: the same plot, and who decided.
    const page = await call('GET', `/people/${maria.userId}`, owner.token);
    expect(page.json().quality.sentBack).toEqual([{ plot: '2', comment: 'Trees?', decidedAt: expect.any(Number), decidedBy: 'owner', submittedAgain: false, file: 'To check again – whole.csv' }]);
    // Submitted again: still listed, said so, in no file.
    await send([envelope({ recordKey: '2', operator: 'jose', modifiedOn: Date.now() + 1000, summary: { [LAND_USE]: 'F' } })]);
    // Another time zone: not My work's answer of a moment ago.
    const after = await call('GET', '/my-work?tz=Europe/Madrid', jose.token);
    expect(after.json().quality.sentBack).toEqual([{ plot: '2', comment: 'Trees?', decidedAt: expect.any(Number), submittedAgain: true, file: null }]);
  });
});
