import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';
import type { RecordEventInput } from '../src/types.js';

const DAY = 86_400_000;

describe('GET /progress and the progress settings', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let rita: { token: string; userId: string };
  let csvId: string;

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username, password: 'password12', inviteToken: invite.json().inviteToken },
    });
    return { userId: res.json().userId as string, token: res.json().token as string };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Progress' } })).json().projectId;
    maria = await join('maria', 'operator');
    rita = await join('rita', 'reviewer');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const csv = await call('PUT', '/csv-files/plots.csv', owner.token, 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n4,0,0\n', { 'content-type': 'text/csv' });
    csvId = csv.json().id;
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: csvId }] });
    const now = Date.now();
    await batchRequest(ctx.app, pid, maria.token, [
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: now - 2 * DAY, activelySaved: true }),
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: now - DAY, activelySaved: true }),
      envelope({ recordKey: '3', operator: 'maria', modifiedOn: now, activelySaved: false }),
    ]);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('a coordinator gets the totals, the days, the forecast and the attention cards', async () => {
    const res = await call('GET', '/progress?days=30&tz=Europe/Rome', owner.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timeZone).toBe('Europe/Rome');
    expect(body.totals).toEqual({ plots: 4, assigned: 4, notAssigned: 0, submitted: 2, started: 1, notStarted: 1 });
    expect(body.daily).toHaveLength(30);
    expect(body.daily.at(-1).cumulative).toBe(2);
    expect(body.daily.reduce((s: number, d: { submitted: number }) => s + d.submitted, 0)).toBe(2);
    // The first plot was submitted two days ago: the pace is over those three days.
    expect(body.forecast).toMatchObject({ target: 4, targetFrom: 'assigned', remaining: 2, paceDays: 3 });
    expect(body.forecast.pacePerDay).toBeCloseTo(2 / 3);
    expect(body.settings).toEqual({ deadline: null, targetPlots: null, quietDays: 3 });
    expect(Array.isArray(body.attention)).toBe(true);
  });

  it('a reviewer gets the figures without the cards; a collector is refused', async () => {
    const res = await call('GET', '/progress', rita.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().attention).toBeNull();
    expect(res.json().totals.submitted).toBe(2);
    expect((await call('GET', '/progress', maria.token)).statusCode).toBe(403);
  });

  it('an unknown time zone falls back to UTC; days are kept between 14 and 366', async () => {
    expect((await call('GET', '/progress?tz=Mars/Olympus', owner.token)).json().timeZone).toBe('UTC');
    expect((await call('GET', '/progress?tz=%2B05:30', owner.token)).json().timeZone).toBe('UTC');
    expect((await call('GET', '/progress?days=3', owner.token)).json().daily).toHaveLength(14);
    expect((await call('GET', '/progress?days=5000', owner.token)).json().daily).toHaveLength(366);
    expect((await call('GET', '/progress?days=abc', owner.token)).json().daily).toHaveLength(90);
  });

  it('settings: saved, validated, audited, and used by the forecast', async () => {
    const saved = await call('PUT', '/progress/settings', owner.token, { deadline: '2099-01-31', targetPlots: 3, quietDays: 5 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ deadline: '2099-01-31', targetPlots: 3, quietDays: 5 });
    expect((await call('GET', '/progress/settings', owner.token)).json()).toEqual({ deadline: '2099-01-31', targetPlots: 3, quietDays: 5 });
    expect((await call('GET', '/progress/settings', rita.token)).statusCode).toBe(403);
    const body = (await call('GET', '/progress', owner.token)).json();
    expect(body.settings).toEqual({ deadline: '2099-01-31', targetPlots: 3, quietDays: 5 });
    expect(body.forecast).toMatchObject({ target: 3, targetFrom: 'setting', remaining: 1, deadline: '2099-01-31' });
    const audit = await ctx.store.listAudit(pid, { limit: 10, action: 'settings.changed' });
    expect(audit.map((a) => a.details)).toEqual([{ setting: 'progress' }]);

    for (const body of ['x', [1], 'null']) {
      expect((await call('PUT', '/progress/settings', owner.token, body, { 'content-type': 'application/json' })).statusCode, String(body)).toBe(400);
    }
    for (const bad of [{ deadline: '2026-02-30' }, { deadline: 5 }, { targetPlots: 0 }, { targetPlots: 1.5 }, { quietDays: 0 }, { quietDays: '3' }]) {
      expect((await call('PUT', '/progress/settings', owner.token, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    // Empty: back to the defaults.
    expect((await call('PUT', '/progress/settings', owner.token, {})).json()).toEqual({ deadline: null, targetPlots: null, quietDays: 3 });
    expect((await call('PUT', '/progress/settings', rita.token, {})).statusCode).toBe(403);
  });

  it("the differences card comes from figures already at hand: it never waits for them nor starts them", async () => {
    const LAND_USE = 'collect_code_land_use_category';
    await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '4,1', operator: 'maria', summary: { [LAND_USE]: 'F' } })]);
    await batchRequest(ctx.app, pid, rita.token, [envelope({ recordKey: '4,2', operator: 'rita', summary: { [LAND_USE]: 'G' } })]);
    const kinds = async () => ((await call('GET', '/progress', owner.token)).json().attention as { kind: string; count: number }[]);
    expect((await kinds()).find((i) => i.kind === 'differencesWaiting')).toBeUndefined();
    const quality = await call('GET', '/quality', owner.token);
    expect(quality.json().plotsDiffering).toBe(1);
    expect((await kinds()).find((i) => i.kind === 'differencesWaiting')).toEqual({ kind: 'differencesWaiting', count: 1 });
  });

  it('cards: never downloaded, and a project file replaced since a download', async () => {
    const moreId = (await call('PUT', '/csv-files/more.csv', owner.token, 'id,lat,lon\n5,0,0\n6,0,0\n', { 'content-type': 'text/csv' })).json().id;
    const jose = await join('jose', 'operator');
    await call('PUT', '/assignments', owner.token, {
      assignments: [
        { userId: maria.userId, csvFileId: csvId },
        { userId: jose.userId, csvFileId: moreId },
      ],
    });
    // Activity is written coalesced (a member's later calls in the minute wait): set it here.
    await ctx.store.touchMemberActivity(pid, maria.userId, { lastCepDownloadAt: Date.now() - DAY, lastSyncAt: Date.now() });
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const body = (await call('GET', '/progress', owner.token)).json();
    const kinds = body.attention.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain('neverDownloaded');
    expect(body.attention.find((i: { kind: string }) => i.kind === 'neverDownloaded').people).toEqual([{ username: 'jose' }]);
    expect(body.attention.find((i: { kind: string }) => i.kind === 'oldProjectFile')).toMatchObject({ count: 1, people: [{ username: 'maria' }] });
  });
});

describe('the memory store: unsent delays', () => {
  it('the median wait per operator', async () => {
    const ctx = await makeContext();
    try {
      const { projectId } = await ctx.store.createProject({ name: 'p' });
      const event = (over: Partial<RecordEventInput>): RecordEventInput => ({
        projectId,
        recordKey: '1',
        operator: 'ana',
        modifiedOn: 0,
        receivedAt: 0,
        activelySaved: true,
        step: 1,
        deleted: false,
        change: 'submitted',
        summary: null,
        ...over,
      });
      const at = (iso: string) => Date.parse(iso);
      // Rome: 25 October 2026 has 25 hours (CEST -> CET at 03:00).
      for (const e of [
        event({ modifiedOn: at('2026-10-24T22:30:00Z'), receivedAt: at('2026-10-24T22:30:00Z') + 3 * DAY }), // 25th in Rome
        event({ modifiedOn: at('2026-10-25T22:30:00Z'), receivedAt: at('2026-10-25T22:30:00Z') + DAY }), // still the 25th
        event({ modifiedOn: at('2026-10-25T23:30:00Z'), receivedAt: at('2026-10-25T23:30:00Z') }), // the 26th
        event({ modifiedOn: at('2026-10-25T23:40:00Z'), change: 'resubmitted' }), // received before `since`: no wait counted
        event({ modifiedOn: at('2026-10-25T23:50:00Z'), operator: 'bo', change: 'deleted', receivedAt: at('2026-10-30T00:00:00Z') }),
      ]) {
        await ctx.store.appendRecordEvent(e);
      }
      const delays = await ctx.store.unsentDelays(projectId, at('2026-10-20T00:00:00Z'));
      expect(delays).toEqual([{ operator: 'ana', medianMs: DAY, uploads: 3 }]);
    } finally {
      await ctx.app.close();
    }
  });
});

describe('listRecordStates', () => {
  it("gives each record's first submission, kept through a resubmission; null for a draft", async () => {
    const ctx = await makeContext();
    try {
      const { projectId, projectToken } = await ctx.store.createProject({ name: 'p' });
      await batchRequest(ctx.app, projectId, projectToken, [envelope({ recordKey: '1', modifiedOn: 1000 }), envelope({ recordKey: '2', modifiedOn: 1500, activelySaved: false })]);
      await batchRequest(ctx.app, projectId, projectToken, [envelope({ recordKey: '1', modifiedOn: 2000, activelySaved: false })]);
      await batchRequest(ctx.app, projectId, projectToken, [envelope({ recordKey: '1', modifiedOn: 3000 })]);
      const states = (await ctx.store.listRecordStates(projectId)).sort((a, b) => (a.recordKey < b.recordKey ? -1 : 1));
      expect(states).toEqual([
        { recordKey: '1', operator: 'maria', activelySaved: true, deleted: false, modifiedOn: 3000, firstSubmittedOn: 1000 },
        { recordKey: '2', operator: 'maria', activelySaved: false, deleted: false, modifiedOn: 1500, firstSubmittedOn: null },
      ]);
    } finally {
      await ctx.app.close();
    }
  });
});
