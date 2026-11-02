import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

describe('Activity: the log, the weekly summary, the downloads and the bell (coordinators only)', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  let ben: { token: string; userId: string };
  let rita: { token: string; userId: string };
  let csvId: string;

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { userId: res.json().userId as string, token: res.json().token as string };
  };
  const t0 = Date.UTC(2026, 9, 26, 9); // Monday 26 October 2026 (week 44)
  const at = (minutes: number) => t0 + minutes * 60_000;
  const main = (plot: number, operator: string, minutes: number, landUse = 'F', submitted = true) =>
    envelope({ recordKey: `${plot},1`, operator, modifiedOn: at(minutes), activelySaved: submitted, summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '1' } });
  const check = (plot: number, operator: string, minutes: number, landUse: string) =>
    envelope({ recordKey: `${plot},2`, operator, modifiedOn: at(minutes), summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '2' } });
  /** The quality figures once they caught up with the records (only GET /quality works them out). */
  const figures = async () => {
    for (let i = 0; i < 200; i++) {
      const res = await call('GET', '/quality', owner.token);
      expect(res.statusCode, res.body).toBe(200);
      if (!res.json().stale) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };
  const log = async (query = '', token = owner.token) => {
    const res = await call('GET', `/activity${query}`, token);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };

  beforeEach(async ({ task }) => {
    // "[figures kept]": the figures are not worked out again within the test (stale ones are served).
    ctx = await makeContext(task.name.includes('[figures kept]') ? { qualityMinIntervalMs: 60_000 } : {});
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Activity' } })).json().projectId;
    maria = await join('maria', 'operator');
    ben = await join('ben', 'operator');
    rita = await join('rita', 'reviewer');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    const csv = await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 30 }, (_, i) => `${i + 1},0,0`)].join('\n'), { 'content-type': 'text/csv' });
    csvId = csv.json().id;
    await call('PUT', '/assignments', owner.token, { assignments: [{ userId: maria.userId, csvFileId: csvId }, { userId: ben.userId, csvFileId: csvId }] });
    // maria: plot 1 submitted (Monday), plot 2 a draft, then submitted (Tuesday); ben checks plot 1 with another answer.
    expect((await batchRequest(ctx.app, pid, maria.token, [main(1, 'maria', 0), main(2, 'maria', 10, 'F', false)])).statusCode).toBe(200);
    expect((await batchRequest(ctx.app, pid, maria.token, [main(2, 'maria', 24 * 60)])).statusCode).toBe(200);
    expect((await batchRequest(ctx.app, pid, ben.token, [check(1, 'ben', 30, 'C')])).statusCode).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('the log: what Collect Earth stored and what coordinators did, newest first, with names put to the ids', async () => {
    const body = await log();
    const records = body.items.filter((i: { type: string }) => i.type === 'record');
    expect(records.map((r: { person: string; change: string; name: string; plot: string; assessment: string; at: number }) => [r.person, r.change, r.name, r.plot, r.assessment, r.at])).toEqual([
      // The id the collector sees (the round the server added is hidden), and for coordinators whether it is a check.
      ['maria', 'submitted', '2', '2', 'main', at(24 * 60)],
      ['ben', 'submitted', '1', '1', 'check', at(30)],
      ['maria', 'created', '2', '2', 'main', at(10)],
      ['maria', 'submitted', '1', '1', 'main', at(0)],
    ]);
    const actions = body.items.filter((i: { type: string }) => i.type === 'audit');
    expect(actions.map((a: { action: string; person: string }) => [a.action, a.person])).toEqual([
      ['assignments.set', 'owner'],
      ['csv.uploaded', 'owner'],
      ['cep.replaced', 'owner'],
      ['invite.created', 'owner'],
      ['invite.created', 'owner'],
      ['invite.created', 'owner'],
    ]);
    // Coordinators' actions happened now; the records were saved earlier (their clock): actions first.
    expect(body.items[0].type).toBe('audit');
    expect(body.files).toEqual({ [csvId]: 'plots.csv' });
    expect(body.persons).toEqual(['ben', 'maria', 'owner', 'rita']);
    expect(body.next).toBeNull();
  });

  it('pages by cursor: every row once whatever the page size; a person, a kind and a date window', async () => {
    const all = (await log('?limit=200')).items.map((i: { id: string }) => i.id);
    for (const limit of [1, 2, 3, 5]) {
      const seen: string[] = [];
      let cursor: string | null = '';
      while (cursor !== null) {
        const page = await log(`?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(page.items.length).toBeLessThanOrEqual(limit);
        seen.push(...page.items.map((i: { id: string }) => i.id));
        cursor = page.next;
      }
      expect(seen, `limit ${limit}`).toEqual(all);
    }
    expect((await log('?person=maria')).items.map((i: { change: string }) => i.change)).toEqual(['submitted', 'created', 'submitted']);
    // The owner's own actions only (no records of theirs).
    expect((await log('?person=owner')).items.every((i: { type: string }) => i.type === 'audit')).toBe(true);
    expect((await log('?kind=draft')).items.map((i: { change: string }) => i.change)).toEqual(['created']);
    expect((await log('?kind=files')).items.map((i: { action: string }) => i.action)).toEqual(['assignments.set', 'csv.uploaded', 'cep.replaced']);
    expect((await log('?kind=records&person=nobody')).items).toEqual([]);
    expect((await log(`?kind=records&from=${at(5)}&to=${at(31)}`)).items.map((i: { at: number }) => i.at)).toEqual([at(30), at(10)]);
    for (const bad of ['?kind=nope', '?limit=0', '?limit=500', '?cursor=zz', '?cursor=1.x_s', '?from=yesterday', '?cursor=9000000000000000.1_s', '?cursor=s_-300000000000000.1', '?from=9000000000000000', '?to=-8000000000000000', `?person=${'x'.repeat(1001)}`]) {
      expect((await call('GET', `/activity${bad}`, owner.token)).statusCode, bad).toBe(400);
    }
  });

  it('decisions and people since removed: their names at read time, marked removed', async () => {
    await figures();
    expect((await call('PUT', '/quality/decisions/1', owner.token, { decision: 'check', comment: 'ok' })).statusCode).toBe(200);
    expect((await call('DELETE', `/members/${ben.userId}`, owner.token)).statusCode).toBe(204);
    const body = await log('?kind=coordinators');
    const removed = body.items.find((i: { action: string }) => i.action === 'member.removed');
    expect(removed.details.userId).toBe(ben.userId);
    expect(body.people[ben.userId]).toEqual({ name: 'ben', removed: true });
    const decided = body.items.find((i: { action: string }) => i.action === 'decision.set');
    expect(decided).toMatchObject({ person: 'owner', details: { plot: '1', decision: 'check' }, plotName: '1' });
    // ben's records stay in the log under his name.
    expect((await log('?person=ben')).items.map((i: { change: string }) => i.change)).toEqual(['submitted']);
  });

  it('coordinators only: reviewers and collectors get 403 on every page of it', async () => {
    for (const path of ['/activity', '/weekly', '/exports/people', '/exports/daily', '/attention']) {
      expect((await call('GET', path, rita.token)).statusCode, path).toBe(403);
      expect((await call('GET', path, maria.token)).statusCode, path).toBe(403);
    }
    expect((await call('POST', '/attention/read', rita.token, { all: true })).statusCode).toBe(403);
  });

  it('the weekly summary: the week in the viewer\'s zone, each person\'s week, from the figures at hand only', async () => {
    const res = await call('GET', '/weekly?week=2026-W44&tz=Europe/Rome', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    const w = res.json();
    expect(w).toMatchObject({ week: '2026-W44', start: '2026-10-26', end: '2026-11-01', timeZone: 'Europe/Rome' });
    expect(w.progress.days.slice(0, 2).map((d: { submitted: number; checks: number }) => [d.submitted, d.checks])).toEqual([
      [1, 1],
      [1, 0],
    ]);
    expect(w.progress).toMatchObject({ submitted: 2, checks: 1, before: 0, byEnd: 2 });
    expect(w.people.map((p: { username: string; submitted: number; checks: number }) => [p.username, p.submitted, p.checks]).slice(0, 2)).toEqual([
      ['maria', 2, 0],
      ['ben', 0, 1],
    ]);
    // Nobody opened the Quality tab: no figures, and this page did not work them out.
    expect(w.quality).toMatchObject({ available: false, flags: null, decided: { total: 0 } });
    expect((await call('GET', '/weekly?week=2026-W44', owner.token)).json().quality.available).toBe(false);
    await figures();
    const later = (await call('GET', '/weekly?week=2026-W44&tz=Europe/Rome', owner.token)).json();
    expect(later.quality.available).toBe(true);
    expect(later.quality.week).toMatchObject({ compared: 1, agreeing: 0 });
    expect(later.quality.flags).toMatchObject({ total: expect.any(Number) });
    // The current week when none is asked for; a week that is not one is refused.
    expect((await call('GET', '/weekly', owner.token)).json().current).toBe(true);
    expect((await call('GET', '/weekly?week=2026-W60', owner.token)).statusCode).toBe(400);
  });

  it('downloads: people, daily activity, decisions and differences, each audited with its kind', async () => {
    const people = await call('GET', '/exports/people?tz=UTC', owner.token);
    expect(people.statusCode).toBe(200);
    expect(people.json().rows.map((r: { username: string }) => r.username)).toEqual(['ben', 'maria', 'owner', 'rita']);
    const daily = (await call('GET', '/exports/daily?tz=UTC', owner.token)).json();
    expect(daily.rows).toEqual([
      { date: '2026-10-26', person: 'ben', plots: 0, checks: 1, submittedAgain: 0, drafts: 0, reopened: 0, deleted: 0 },
      { date: '2026-10-26', person: 'maria', plots: 1, checks: 0, submittedAgain: 0, drafts: 1, reopened: 0, deleted: 0 },
      { date: '2026-10-27', person: 'maria', plots: 1, checks: 0, submittedAgain: 0, drafts: 0, reopened: 0, deleted: 0 },
    ]);
    // Differences need the figures at hand: never worked out for a download.
    const none = await call('GET', '/exports/differences', owner.token);
    expect(none.statusCode).toBe(409);
    expect(none.json().error).toBe('no_figures');
    await figures();
    expect((await call('PUT', '/quality/decisions/1', owner.token, { decision: 'recheck', comment: '=cmd' })).statusCode).toBe(200);
    const diffs = (await call('GET', '/exports/differences', owner.token)).json();
    expect(diffs.rows).toEqual([{ plot: '1', name: '1', first: 'maria', check: 'ben', latest: true, decision: 'recheck', key: LAND_USE, firstAnswer: 'F', checkAnswer: 'C', status: 'differs' }]);
    expect(diffs.labels[LAND_USE]).toBeTruthy();
    const decisions = (await call('GET', '/exports/decisions', owner.token)).json();
    expect(decisions.rows).toEqual([{ plot: '1', name: '1', decision: 'recheck', comment: '=cmd', decidedBy: 'owner', decidedAt: expect.any(Number), byAssessor: false, bulk: false }]);
    expect((await call('GET', '/exports/answers', owner.token)).statusCode).toBe(404);
    const audited = await ctx.store.listAudit(pid, { limit: 10, action: 'export.downloaded' });
    expect(audited.map((a) => a.details)).toEqual([
      { kind: 'decisions', rows: 1 },
      { kind: 'differences', rows: 1 },
      { kind: 'daily', rows: 3 },
      { kind: 'people', rows: 4 },
    ]);
  });

  it('differences beyond the listed ones: compared with the margins the figures used; a pair changed or gone since says so [figures kept]', async () => {
    const csv = ['id,lat,lon', ...Array.from({ length: 520 }, (_, i) => `${i + 1},0,0`)].join('\n');
    await call('PUT', '/csv-files/plots.csv', owner.token, csv, { 'content-type': 'text/csv' });
    expect((await call('PUT', '/quality/settings', owner.token, { margins: { [FOREST]: 0 } })).statusCode).toBe(200);
    const num = (_key: string, plot: number, operator: string, forest: string, round: 1 | 2) =>
      envelope({ recordKey: `${plot},${round}`, operator, modifiedOn: at(plot), summary: { [LAND_USE]: 'F', [FOREST]: forest, collect_code_round: String(round) } });
    const firsts = Array.from({ length: 510 }, (_, i) => num('a', i + 1, 'maria', '50', 1));
    const checks = Array.from({ length: 510 }, (_, i) => num('b', i + 1, 'ben', '52', 2));
    for (const [token, list] of [[maria.token, firsts], [ben.token, checks]] as const) {
      await batchRequest(ctx.app, pid, token, list.slice(0, 500));
      await batchRequest(ctx.app, pid, token, list.slice(500));
    }
    // The figures with a margin of 0: 50 and 52 differ (each of the 510 plots, plot 1 and 2 too).
    for (let i = 0; i < 300; i++) {
      const res = await call('GET', '/quality', owner.token);
      if (!res.json().stale && res.json().plotsDiffering === 510) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // A wider margin since (the figures kept are those of 0), plot 505's check deleted, plot 507's corrected.
    expect((await call('PUT', '/quality/settings', owner.token, { margins: { [FOREST]: 50 } })).statusCode).toBe(200);
    await batchRequest(ctx.app, pid, ben.token, [envelope({ ...num('b', 505, 'ben', '52', 2), modifiedOn: at(9000), deleted: true })]);
    await batchRequest(ctx.app, pid, ben.token, [envelope({ ...num('b', 507, 'ben', '50', 2), modifiedOn: at(9000) })]);
    const body = (await call('GET', '/exports/differences', owner.token)).json();
    const of = (plot: string) => body.rows.filter((r: { plot: string }) => r.plot === plot);
    expect(of('509')).toEqual([{ plot: '509', name: '509', first: 'maria', check: 'ben', latest: true, decision: null, key: FOREST, firstAnswer: '50', checkAnswer: '52', status: 'differs' }]);
    expect(of('505')).toEqual([{ plot: '505', name: '505', first: 'maria', check: 'ben', latest: true, decision: null, key: null, firstAnswer: null, checkAnswer: null, status: 'gone' }]);
    expect(of('507')).toEqual([{ plot: '507', name: '507', first: 'maria', check: 'ben', latest: true, decision: null, key: null, firstAnswer: null, checkAnswer: null, status: 'changed' }]);
    expect(new Set(body.rows.map((r: { plot: string }) => r.plot)).size).toBe(510);
    expect(body.numbers).toContain(FOREST);
  });

  it('the bell: the attention items, read per coordinator until what they say changes', async () => {
    let bell = (await call('GET', '/attention', owner.token)).json();
    expect(bell.items.length).toBeGreaterThan(0);
    expect(bell.unread).toBe(bell.items.length);
    const first = bell.items[0];
    expect(first.key).toMatch(/^[a-zA-Z]+:[0-9a-f]{16}$/);
    bell = (await call('POST', '/attention/read', owner.token, { keys: [first.key, 'quiet:0000000000000000'] })).json();
    expect(bell.items.find((i: { key: string }) => i.key === first.key).read).toBe(true);
    expect(bell.unread).toBe(bell.items.length - 1);
    // Old keys are not kept: only items there now.
    expect(await ctx.store.listAttentionReads(pid, owner.userId)).toEqual([first.key]);
    // Another coordinator has their own reads.
    await ctx.store.addMembership(pid, rita.userId, 'admin');
    expect((await call('GET', '/attention', rita.token)).json().unread).toBe(bell.items.length);
    // A new plot file with plots given to nobody: a new item, unread.
    await call('PUT', '/csv-files/more.csv', owner.token, 'id,lat,lon\n100,0,0\n', { 'content-type': 'text/csv' });
    bell = (await call('GET', '/attention', owner.token)).json();
    const notAssigned = bell.items.find((i: { item: { kind: string } }) => i.item.kind === 'notAssigned');
    expect(notAssigned).toMatchObject({ read: false, item: { count: 1 } });
    bell = (await call('POST', '/attention/read', owner.token, { all: true })).json();
    expect(bell.unread).toBe(0);
    // Its count changes: unread again.
    await call('PUT', '/csv-files/more.csv', owner.token, 'id,lat,lon\n100,0,0\n101,0,0\n', { 'content-type': 'text/csv' });
    bell = (await call('GET', '/attention', owner.token)).json();
    expect(bell.items.find((i: { item: { kind: string } }) => i.item.kind === 'notAssigned')).toMatchObject({ read: false, item: { count: 2 } });
    expect(bell.unread).toBe(1);
    for (const body of [{}, { keys: [] }, { keys: [5] }, { keys: Array.from({ length: 51 }, (_, i) => `k${i}`) }]) {
      expect((await call('POST', '/attention/read', owner.token, body)).statusCode).toBe(400);
    }
    // Removed from the project: their reads go.
    await call('POST', '/attention/read', rita.token, { all: true });
    expect((await ctx.store.listAttentionReads(pid, rita.userId)).length).toBeGreaterThan(0);
    expect((await call('DELETE', `/members/${rita.userId}`, owner.token)).statusCode).toBe(204);
    expect(await ctx.store.listAttentionReads(pid, rita.userId)).toEqual([]);
  });
});
