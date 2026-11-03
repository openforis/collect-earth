import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';
import type { RecordEnvelope } from '../src/types.js';

const DESKTOP = 'CollectEarth/1.22.0 (Windows 11; Java 23)';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';

describe('activity data written by the routes', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let jose: { token: string; userId: string };

  const call = (method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string) => {
    const invite = await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 1 });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, password: 'password12', inviteToken: invite.json().inviteToken },
    });
    return { userId: res.json().userId as string, token: res.json().token as string };
  };
  const sync = (token: string, envelopes: Partial<RecordEnvelope>[]) => batchRequest(ctx.app, pid, token, envelopes);
  const events = () => ctx.store.listRecordEvents(pid, { from: 0, to: 1e13, limit: 100 });
  const audit = async () => (await ctx.store.listAudit(pid, { limit: 100 })).reverse();

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Activity' } })).json()
      .projectId;
    maria = await join('maria');
    jose = await join('jose');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('record events', () => {
    // As Collect Earth sends them: every save has a new modifiedOn (Collect's
    // RecordManager.save sets it to now); autosaves are activelySaved false, also onto a
    // submitted plot; Submit and validate is activelySaved true.
    it('a plot answered, submitted, edited and submitted again: each save with what it changed', async () => {
      await sync(maria.token, [envelope({ recordKey: '1', modifiedOn: 1000, activelySaved: false, summary: { a: 'x' } })]);
      await sync(maria.token, [envelope({ recordKey: '1', modifiedOn: 2000, activelySaved: false, summary: { a: 'y' } })]);
      await sync(maria.token, [envelope({ recordKey: '1', modifiedOn: 3000, activelySaved: true, summary: { a: 'y' } })]);
      await sync(maria.token, [envelope({ recordKey: '1', modifiedOn: 4000, activelySaved: false, summary: { a: 'z' } })]);
      await sync(maria.token, [envelope({ recordKey: '1', modifiedOn: 5000, activelySaved: true, summary: { a: 'z' } })]);
      await sync(maria.token, [envelope({ recordKey: '1', modifiedOn: 6000, deleted: true })]);
      await sync(maria.token, [envelope({ recordKey: '2', modifiedOn: 7000, activelySaved: true, summary: { a: 'w' } })]);
      const list = (await events()).reverse();
      expect(list.map((e) => [e.recordKey, e.change, e.modifiedOn])).toEqual([
        ['1', 'created', 1000],
        ['1', 'updated', 2000],
        ['1', 'submitted', 3000],
        ['1', 'unsubmitted', 4000],
        ['1', 'resubmitted', 5000],
        ['1', 'deleted', 6000],
        ['2', 'submitted', 7000],
      ]);
      expect(list.map((e) => e.summary)).toEqual([null, null, { a: 'y' }, null, { a: 'z' }, null, { a: 'w' }]);
      expect(list.every((e) => e.operator === 'maria' && e.projectId === pid && e.receivedAt > 0)).toBe(true);
      expect(list[2]).toMatchObject({ activelySaved: true, step: 1, deleted: false });
    });

    it('logs nothing for a stale upload or the same save sent again; the same time with other answers is stored and logged', async () => {
      await sync(maria.token, [envelope({ modifiedOn: 2000, activelySaved: false, summary: { a: '1' } })]);
      const stale = await sync(maria.token, [envelope({ modifiedOn: 1000 })]);
      expect(stale.json().results[0].status).toBe('stale');
      const again = await sync(maria.token, [envelope({ modifiedOn: 2000, activelySaved: false, summary: { a: '1' } })]);
      expect(again.json().results[0].status).toBe('stored');
      const other = await sync(maria.token, [envelope({ modifiedOn: 2000, activelySaved: false, summary: { a: '2' } })]);
      expect(other.json().results[0].status).toBe('stored');
      expect((await ctx.store.getRecord(pid, '1', 'maria'))!.summary).toEqual({ a: '2' });
      expect((await events()).map((e) => e.change)).toEqual(['updated', 'created']);
    });

    it('a record whose store write fails is answered error, and the next one in the batch still goes', async () => {
      const real = ctx.store.putRecordWithEvent.bind(ctx.store);
      ctx.store.putRecordWithEvent = async (p, key, op, apply) => {
        if (key === 'bad') throw new Error('db down');
        return real(p, key, op, apply);
      };
      const res = await sync(maria.token, [envelope({ recordKey: 'bad' }), envelope({ recordKey: 'good' })]);
      expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['error', 'stored']);
      expect((await events()).map((e) => e.recordKey)).toEqual(['good']);
    });

    it("logs a project token's uploads under the operator they name", async () => {
      const project = await ctx.store.createProject({ name: 'Phase 0' });
      await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope({ operator: 'pedro' })]);
      const list = await ctx.store.listRecordEvents(project.projectId, { from: 0, to: 1e13, limit: 10 });
      expect(list.map((e) => [e.operator, e.change])).toEqual([['pedro', 'submitted']]);
    });
  });

  describe('member activity', () => {
    it('the routes Collect Earth calls record syncs, downloads and its User-Agent; any call counts as seen', async () => {
      await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
      const csv = await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n2,0,0\n', { 'content-type': 'text/csv' });
      await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: csv.json().id }] });
      const ua = { 'user-agent': DESKTOP };
      expect((await call('GET', '/cep', maria.token, undefined, ua)).statusCode).toBe(200);
      expect((await call('GET', '/my-assignment', maria.token, undefined, ua)).statusCode).toBe(200);
      expect((await call('GET', `/csv-files/${csv.json().id}/content`, maria.token, undefined, ua)).statusCode).toBe(200);
      const body = { records: [envelope({ recordKey: '1' }), envelope({ recordKey: '2' })] };
      const { gzipSync } = await import('node:zlib');
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/v1/projects/${pid}/records:batch`,
        headers: { ...bearer(maria.token), ...ua, 'content-type': 'application/json', 'content-encoding': 'gzip' },
        payload: gzipSync(Buffer.from(JSON.stringify(body))),
      });
      expect(res.statusCode).toBe(200);
      // The dashboard, in a browser: seen, but the desktop's User-Agent stays.
      await call('GET', '/my-quality', maria.token, undefined, { 'user-agent': BROWSER });
      await ctx.app.activity.flush();

      const activity = await ctx.store.listMemberActivity(pid);
      const mine = activity.find((a) => a.userId === maria.userId)!;
      expect(mine).toMatchObject({ syncsCount: 1, recordsReceived: 2, clientAgent: DESKTOP });
      for (const k of ['lastSeenAt', 'lastSyncAt', 'lastPlotsDownloadAt', 'lastCepDownloadAt'] as const) {
        expect(mine[k]).toBeGreaterThan(0);
      }
      // The owner's dashboard calls count as seen, with no download, sync or agent.
      expect(activity.find((a) => a.userId === owner.userId)).toMatchObject({
        lastSyncAt: null,
        lastCepDownloadAt: null,
        syncsCount: 0,
        clientAgent: null,
      });
      // jose made no call to the project after joining.
      expect(activity.find((a) => a.userId === jose.userId)).toBeUndefined();
    });

    it("a download from the dashboard's browser keeps Collect Earth's User-Agent (only Collect Earth's agents are kept)", async () => {
      await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
      const csv = await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n', { 'content-type': 'text/csv' });
      await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: csv.json().id }] });
      const ua = { 'user-agent': 'CollectEarth/1.24.3 cloud-sync' };
      expect((await call('GET', '/my-assignment', maria.token, undefined, ua)).statusCode).toBe(200);
      await ctx.app.activity.flush();
      // maria, then the owner, download the plot file and the CEP from the dashboard.
      for (const token of [maria.token, owner.token]) {
        const browser = { 'user-agent': BROWSER };
        expect((await call('GET', `/csv-files/${csv.json().id}/content`, token, undefined, browser)).statusCode).toBe(200);
        expect((await call('GET', '/cep', token, undefined, browser)).statusCode).toBe(200);
      }
      await ctx.app.activity.flush();
      const activity = await ctx.store.listMemberActivity(pid);
      expect(activity.find((a) => a.userId === maria.userId)).toMatchObject({ clientAgent: 'CollectEarth/1.24.3 cloud-sync' });
      expect(activity.find((a) => a.userId === owner.userId)).toMatchObject({ clientAgent: null });
      // A CEP downloaded in a browser is no project file in Collect Earth: only Collect Earth's downloads count (the old-file card).
      expect(activity.find((a) => a.userId === owner.userId)!.lastCepDownloadAt).toBeNull();

      // The agent of the releases before the version was sent is kept too.
      expect((await call('GET', '/my-assignment', maria.token, undefined, { 'user-agent': 'CollectEarth-cloud-sync' })).statusCode).toBe(200);
      await ctx.app.activity.flush();
      expect((await ctx.store.listMemberActivity(pid)).find((a) => a.userId === maria.userId)).toMatchObject({
        clientAgent: 'CollectEarth-cloud-sync',
      });
    });

    it("a member's first call of the minute is written before the answer is sent (no flush, no timer)", async () => {
      const res = await batchRequest(ctx.app, pid, maria.token, [envelope()]);
      expect(res.statusCode).toBe(200);
      expect((await ctx.store.listMemberActivity(pid)).find((a) => a.userId === maria.userId)).toMatchObject({
        syncsCount: 1,
        recordsReceived: 1,
      });
    });

    it('counts only the records stored, and a project token is nobody', async () => {
      await sync(maria.token, [envelope({ modifiedOn: 2000 })]);
      await sync(maria.token, [envelope({ modifiedOn: 1000 }), envelope({ recordKey: '9' })]);
      await ctx.app.activity.flush();
      expect((await ctx.store.listMemberActivity(pid)).find((a) => a.userId === maria.userId)).toMatchObject({
        syncsCount: 2,
        recordsReceived: 2,
      });

      const project = await ctx.store.createProject({ name: 'Phase 0' });
      await batchRequest(ctx.app, project.projectId, project.projectToken, [envelope()]);
      await ctx.app.activity.flush();
      expect(await ctx.store.listMemberActivity(project.projectId)).toEqual([]);
    });
  });

  describe('the audit log', () => {
    it('keeps an entry per coordinator action, by whom, with ids and counts only', async () => {
      const invite = await call('POST', '/invites', owner.token, { role: 'reviewer', maxUses: 3 });
      const [open] = (await call('GET', '/invites', owner.token)).json().invites;
      expect((await call('DELETE', `/invites/${open.id}`, owner.token)).statusCode).toBe(204);
      expect(invite.statusCode).toBe(201);
      expect((await call('PUT', `/members/${jose.userId}`, owner.token, { role: 'reviewer' })).statusCode).toBe(200);
      expect((await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' })).statusCode).toBe(200);
      const csv = await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n', { 'content-type': 'text/csv' });
      const fileId = csv.json().id as string;
      expect((await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: fileId }] })).statusCode).toBe(200);
      expect((await call('PUT', `/csv-files/${fileId}/distribution`, owner.token, { mode: 'even', people: [maria.userId, jose.userId] })).statusCode).toBe(200);
      expect((await call('POST', `/csv-files/${fileId}/move-unfinished`, owner.token, { fromUserId: maria.userId, toUserId: jose.userId })).statusCode).toBe(200);
      expect((await call('PUT', '/quality/decisions/1', owner.token, { decision: 'check', comment: 'the check is right' })).statusCode).toBe(200);
      expect((await call('DELETE', '/quality/decisions/1', owner.token)).statusCode).toBe(204);
      expect((await call('PUT', '/quality/settings', owner.token, { margins: {} })).statusCode).toBe(200);
      expect((await call('PUT', '/ai', owner.token, { enabled: false })).statusCode).toBe(200);
      expect((await call('PATCH', '', owner.token, { name: 'Renamed' })).statusCode).toBe(200);
      expect((await call('GET', '/export.csv', owner.token)).statusCode).toBe(200);
      expect((await call('DELETE', `/members/${jose.userId}`, owner.token)).statusCode).toBe(204);
      expect((await call('PUT', '/survey', owner.token, { surveyUri: 'http://x', idmlBase64: 'eA==' })).statusCode).toBe(200);

      const log = await audit();
      // The two invites made in beforeEach to let maria and jose join come first.
      expect(log.slice(2).map((e) => [e.action, e.details])).toEqual([
        ['invite.created', { inviteId: open.id, role: 'reviewer', maxUses: 3 }],
        ['invite.revoked', { inviteId: open.id }],
        ['member.role', { userId: jose.userId, role: 'reviewer' }],
        ['cep.replaced', { bytes: idOnlyCep().length }],
        ['csv.uploaded', { csvFileId: fileId, plots: 3 }],
        ['assignments.set', { count: 1 }],
        ['division.applied', { csvFileId: fileId, mode: 'even', people: 2, plots: 3 }],
        ['plots.moved', { csvFileId: fileId, fromUserId: maria.userId, toUserId: jose.userId, moved: expect.any(Number) }],
        ['decision.set', { plot: '1', decision: 'check' }],
        ['decision.deleted', { plot: '1' }],
        ['settings.changed', { setting: 'quality' }],
        ['settings.changed', { setting: 'ai', enabled: false }],
        ['settings.changed', { setting: 'name' }],
        ['export.downloaded', { records: 0 }],
        ['member.removed', { userId: jose.userId }],
        ['survey.replaced', { bytes: 1 }],
      ]);
      expect(log.every((e) => e.actorUserId === owner.userId && e.actor === 'owner')).toBe(true);
      // Never an answer or a comment.
      expect(JSON.stringify(log)).not.toContain('the check is right');
    });

    it('writes nothing for a dry run or a refused request', async () => {
      const csv = await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n', { 'content-type': 'text/csv' });
      const before = (await audit()).length;
      await call('PUT', `/csv-files/${csv.json().id}/distribution`, owner.token, { mode: 'even', people: [maria.userId], dryRun: true });
      await call('PUT', '/quality/decisions/p', owner.token, { decision: 'nonsense' });
      await call('DELETE', '/quality/decisions/never-decided', owner.token);
      await call('PATCH', '', maria.token, { name: 'Mine now' });
      expect((await audit()).length).toBe(before);
    });

    it('a project token acts as nobody', async () => {
      const project = await ctx.store.createProject({ name: 'Phase 0' });
      await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/projects/${project.projectId}`,
        headers: bearer(project.adminToken),
        payload: { name: 'Renamed' },
      });
      expect((await ctx.store.listAudit(project.projectId, { limit: 10 })).map((e) => [e.action, e.actorUserId])).toEqual([
        ['settings.changed', null],
      ]);
    });
  });
});
