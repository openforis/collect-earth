import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';

describe('the review queue: GET /quality/queue, decisions by reviewers, POST /quality/decisions:bulk', () => {
  let ctx: TestContext;
  let pid: string;
  let projectToken: string;
  let owner: { token: string; userId: string };
  let rita: { token: string };
  let maria: { token: string };

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string };
  };
  /** The queue once the figures caught up with the records. */
  const fresh = async (path = '/quality/queue', token = owner.token) => {
    for (let i = 0; i < 200; i++) {
      const res = await call('GET', path, token);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      if (!body.stale) return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };
  const t0 = Date.UTC(2026, 9, 1, 9);
  const at = (seconds: number) => t0 + seconds * 1000;
  const main = (plot: number, operator: string, seconds: number, landUse = 'F') =>
    envelope({ recordKey: `${plot},1`, operator, modifiedOn: at(seconds), summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '1' } });
  const check = (plot: number, operator: string, landUse: string) =>
    envelope({ recordKey: `${plot},2`, operator, modifiedOn: at(5000), summary: { [LAND_USE]: landUse, [FOREST]: '50', collect_code_round: '2' } });

  beforeEach(async ({ task }) => {
    // "[figures kept]": the figures are not worked out again within the test (stale ones are served).
    ctx = await makeContext(task.name.includes('[figures kept]') ? { qualityMinIntervalMs: 60_000 } : {});
    owner = await setupPlatformAdmin(ctx.app);
    // A project with a project token (records under any operator's name), coordinated by owner.
    const created = await createProject(ctx.app, 'Queue');
    pid = created.projectId;
    projectToken = created.projectToken;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    rita = await join('rita', 'reviewer');
    maria = await join('maria', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 20 }, (_, i) => `${i + 1},${-10 - i / 10},${20 + i / 10}`)].join('\n'), { 'content-type': 'text/csv' });
    const records = [
      // 1: a difference, no reviewer. 2: the first is rita's (a reviewer). 3: the check is rita's.
      // 4: the check is the owner's (a coordinator). 5: agree.
      main(1, 'ana', 0),
      check(1, 'ben', 'G'),
      main(2, 'rita', 0),
      check(2, 'ben', 'G'),
      main(3, 'ana', 100),
      check(3, 'rita', 'G'),
      main(4, 'ana', 200),
      check(4, 'owner', 'C'),
      main(5, 'ana', 300),
      check(5, 'ben', 'F'),
      // 6: ana's first assessment 5 s after plot 5: very fast, no check.
      main(6, 'ana', 305),
      // 7: decided "both need another look" below, then submitted again.
      main(7, 'maria', 0),
    ];
    const res = await batchRequest(ctx.app, pid, projectToken, records);
    expect(res.statusCode, res.body).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('one queue: differences without a decision, then flags, then plots submitted again after "both need another look"; coordinators and reviewers, not collectors', async () => {
    await fresh();
    const decided = await call('PUT', '/quality/decisions/7', rita.token, { decision: 'recheck' });
    expect(decided.statusCode, decided.body).toBe(200);
    // maria looks again and submits it (the demo survey's land use is worked out from other answers: the time tells).
    const again = decided.json().decidedAt + 1000;
    // Received after the decision (a later millisecond).
    await new Promise((resolve) => setTimeout(resolve, 5));
    await batchRequest(ctx.app, pid, projectToken, [envelope({ ...main(7, 'maria', 0, 'G'), modifiedOn: again })]);
    const body = await fresh('/quality/queue', rita.token);
    expect(body.items.map((i: { plot: string; section: string }) => [i.plot, i.section])).toEqual([
      ['1', 'difference'],
      ['2', 'difference'],
      ['3', 'difference'],
      ['4', 'difference'],
      ['6', 'flag'],
      ['7', 'resubmitted'],
    ]);
    expect(body).toMatchObject({ total: 6, counts: { difference: 4, flag: 1, resubmitted: 1 }, people: ['ana', 'ben', 'maria', 'owner', 'rita'], flagsCapped: false });
    const one = body.items[0];
    expect(one).toEqual({
      plot: '1',
      section: 'difference',
      people: ['ana', 'ben'],
      differences: [{ plot: '1', first: { operator: 'ana', recordKey: '1,1' }, check: { operator: 'ben', recordKey: '1,2' }, fields: [{ key: LAND_USE, first: 'F', check: 'G' }] }],
      flags: [],
      resubmitted: [],
      decision: null,
    });
    expect(body.next).toBeNull();
    expect(body.items[4].flags).toEqual([{ kind: 'very_fast', plot: '6', operator: 'ana', at: at(305), details: { gapMs: 5000, previousPlot: '5' } }]);
    expect(body.items[5]).toMatchObject({ plot: '7', resubmitted: [{ plot: '7', operator: 'maria', at: again }], decision: { decision: 'recheck', decidedBy: 'rita' } });
    expect(body.items[5].decision).not.toHaveProperty('seen');
    expect(body.labels[LAND_USE]).toBe('Land Use 2025');
    expect(body.options[LAND_USE].length).toBeGreaterThan(0);
    // Filters.
    expect((await call('GET', '/quality/queue?person=owner', owner.token)).json().items.map((i: { plot: string }) => i.plot)).toEqual(['4']);
    expect((await call('GET', '/quality/queue?kind=very_fast', owner.token)).json().items.map((i: { plot: string }) => i.plot)).toEqual(['6']);
    expect((await call('GET', '/quality/queue?kind=resubmitted', owner.token)).json().items.map((i: { plot: string }) => i.plot)).toEqual(['7']);
    // The person menu names everyone, whatever the filter.
    expect((await call('GET', '/quality/queue?person=owner&kind=difference', owner.token)).json().people).toEqual(['ana', 'ben', 'maria', 'owner', 'rita']);
    expect((await call('GET', '/quality/queue?after=difference::4', owner.token)).json().items.map((i: { plot: string }) => i.plot)).toEqual(['6', '7']);
    for (const q of ['kind=slow', `person=${'x'.repeat(1001)}`, 'after=x', 'after=flag:abc:1']) {
      expect((await call('GET', `/quality/queue?${q}`, owner.token)).statusCode, q).toBe(400);
    }
    expect((await call('GET', '/quality/queue', maria.token)).statusCode).toBe(403);
    // A reviewer may also ask where the plots are (for the map links).
    const places = await call('POST', '/quality/places', rita.token, { plots: ['1'] });
    expect(places.statusCode, places.body).toBe(200);
    expect(places.json().places).toEqual([{ plot: '1', lat: -10, lon: 20, name: '1' }]);
    expect((await call('POST', '/quality/places', maria.token, { plots: ['1'] })).statusCode).toBe(403);
  });

  it('reviewers decide and undo, audited with who did it; the plot leaves the queue; collectors cannot', async () => {
    await fresh();
    const put = await call('PUT', '/quality/decisions/1', rita.token, { decision: 'check', comment: 'G is right' });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toMatchObject({ plot: '1', decision: 'check', comment: 'G is right', decidedBy: 'rita' });
    expect((await ctx.store.listQualityDecisions(pid))[0].seen).toEqual(expect.arrayContaining([{ operator: 'ana', hash: expect.any(Number) }]));
    const queue = (await call('GET', '/quality/queue', rita.token)).json();
    expect(queue.items.map((i: { plot: string }) => i.plot)).not.toContain('1');
    expect((await call('DELETE', '/quality/decisions/1', rita.token)).statusCode).toBe(204);
    expect((await call('PUT', '/quality/decisions/1', maria.token, { decision: 'first' })).statusCode).toBe(403);
    expect((await call('DELETE', '/quality/decisions/1', maria.token)).statusCode).toBe(403);
    const audit = await ctx.store.listAudit(pid, { limit: 10 });
    expect(audit.filter((e) => e.action.startsWith('decision.')).map((e) => [e.action, e.actor, e.details])).toEqual([
      ['decision.deleted', 'rita', { plot: '1' }],
      ['decision.set', 'rita', { plot: '1', decision: 'check' }],
    ]);
  });

  it('bulk: a dry run gives the count; the rule decides only plots without a decision, keeps what each saw, one audit entry; coordinators only', async () => {
    await fresh();
    const dry = await call('POST', '/quality/decisions:bulk?dryRun=1', owner.token, { rule: 'check_by_reviewer' });
    expect(dry.statusCode, dry.body).toBe(200);
    expect(dry.json()).toEqual({ rule: 'check_by_reviewer', decision: 'check', count: 2, plots: ['3', '4'], dryRun: true, batch: null });
    expect(await ctx.store.listQualityDecisions(pid)).toEqual([]);
    // Plot 4 decided meanwhile: kept.
    await call('PUT', '/quality/decisions/4', owner.token, { decision: 'first' });
    const done = await call('POST', '/quality/decisions:bulk', owner.token, { rule: 'check_by_reviewer' });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toEqual({ rule: 'check_by_reviewer', decision: 'check', count: 1, plots: ['3'], dryRun: false, batch: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const batch = done.json().batch as string;
    const decisions = new Map((await ctx.store.listQualityDecisions(pid)).map((d) => [d.plot, d]));
    expect(decisions.get('4')!.decision).toBe('first');
    expect(decisions.get('3')).toMatchObject({ decision: 'check', decidedBy: 'owner', comment: null, batch });
    // A decision made alone has no run, and one made again alone leaves its run.
    expect(decisions.get('4')!.batch).toBeNull();
    expect(decisions.get('3')!.seen).toHaveLength(2);
    const first = await call('POST', '/quality/decisions:bulk', owner.token, { rule: 'first_by_reviewer' });
    expect(first.json()).toMatchObject({ decision: 'first', count: 1, plots: ['2'] });
    const audit = await ctx.store.listAudit(pid, { limit: 10, action: 'decision.bulk' });
    expect(audit.map((e) => [e.actor, e.details])).toEqual([
      ['owner', { rule: 'first_by_reviewer', decision: 'first', count: 1, batch: first.json().batch }],
      ['owner', { rule: 'check_by_reviewer', decision: 'check', count: 1, batch }],
    ]);
    await call('PUT', '/quality/decisions/3', owner.token, { decision: 'first' });
    expect((await ctx.store.listQualityDecisions(pid)).find((d) => d.plot === '3')!.batch).toBeNull();
    // Nothing left to decide: no audit entry.
    expect((await call('POST', '/quality/decisions:bulk', owner.token, { rule: 'first_by_reviewer' })).json()).toMatchObject({ count: 0 });
    expect(await ctx.store.listAudit(pid, { limit: 10, action: 'decision.bulk' })).toHaveLength(2);
    for (const payload of [{}, { rule: 'all' }, null]) {
      expect((await call('POST', '/quality/decisions:bulk', owner.token, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await call('POST', '/quality/decisions:bulk?dryRun=1', rita.token, { rule: 'first_by_reviewer' })).statusCode).toBe(403);
    expect((await call('POST', '/quality/decisions:bulk', maria.token, { rule: 'first_by_reviewer' })).statusCode).toBe(403);
  });

  it('plots beyond the listed differences come with their answers, read at once when shown; one changed since the figures says so [figures kept]', async () => {
    const csv = ['id,lat,lon', ...Array.from({ length: 520 }, (_, i) => `${i + 1},0,0`)].join('\n');
    await call('PUT', '/csv-files/plots.csv', owner.token, csv, { 'content-type': 'text/csv' });
    const records = [];
    for (let i = 1; i <= 510; i++) records.push(main(i, 'ana', i * 100), check(i, 'ben', i % 2 ? 'G' : 'C'));
    await batchRequest(ctx.app, pid, projectToken, records.slice(0, 500));
    await batchRequest(ctx.app, pid, projectToken, records.slice(500));
    let body = await fresh('/quality/queue?kind=difference&after=difference::495');
    expect(body.counts.difference).toBe(510);
    expect(body.items.map((i: { plot: string }) => i.plot)).toEqual(Array.from({ length: 15 }, (_, i) => String(496 + i)));
    for (const item of body.items) {
      const plot = Number(item.plot);
      expect(item.differences, item.plot).toEqual([
        { plot: item.plot, first: { operator: 'ana', recordKey: `${plot},1` }, check: { operator: 'ben', recordKey: `${plot},2` }, fields: [{ key: LAND_USE, first: 'F', check: plot % 2 ? 'G' : 'C' }] },
      ]);
    }
    // ben corrects plot 505 to agree: the figures kept still list it, the answers read now do not differ.
    await batchRequest(ctx.app, pid, projectToken, [envelope({ ...check(505, 'ben', 'F'), modifiedOn: at(6000) })]);
    body = (await call('GET', '/quality/queue?kind=difference&after=difference::495', owner.token)).json();
    expect(body.stale).toBe(true);
    expect(body.items.find((i: { plot: string }) => i.plot === '505').differences[0]).toMatchObject({ fields: [], changed: true });
  });

  it('pages by cursor: plots decided meanwhile by someone else make no plot skipped', async () => {
    const csv = ['id,lat,lon', ...Array.from({ length: 120 }, (_, i) => `${i + 1},0,0`)].join('\n');
    await call('PUT', '/csv-files/plots.csv', owner.token, csv, { 'content-type': 'text/csv' });
    const records = [];
    for (let i = 8; i <= 110; i++) records.push(main(i, 'ana', i * 100), check(i, 'ben', 'G'));
    await batchRequest(ctx.app, pid, projectToken, records);
    const page1 = await fresh('/quality/queue?kind=difference');
    expect(page1.items).toHaveLength(100);
    expect(page1.next).toBe(`difference::${page1.items[99].plot}`);
    const lastSeen = page1.items[99].plot;
    // The owner works the same queue and decides the first ten plots meanwhile.
    for (const item of page1.items.slice(0, 10)) expect((await call('PUT', `/quality/decisions/${item.plot}`, owner.token, { decision: 'first' })).statusCode).toBe(200);
    const page2 = (await call('GET', `/quality/queue?kind=difference&after=${encodeURIComponent(page1.next)}`, rita.token)).json();
    const all = page1.items.map((i: { plot: string }) => i.plot).concat(page2.items.map((i: { plot: string }) => i.plot));
    expect(page2.items[0].plot).not.toBe(lastSeen);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(page1.total);
    expect(page2.next).toBeNull();
  });

  it('a reviewer may not decide a plot they assessed (409); a coordinator may, and the decision says so', async () => {
    await fresh();
    for (const plot of ['3', '2']) {
      const res = await call('PUT', `/quality/decisions/${plot}`, rita.token, { decision: 'first' });
      expect(res.statusCode, plot).toBe(409);
      expect(res.json()).toMatchObject({ error: 'own_plot', reason: expect.stringContaining('someone else decides it') });
    }
    expect(await ctx.store.listQualityDecisions(pid)).toEqual([]);
    const own = await call('PUT', '/quality/decisions/4', owner.token, { decision: 'check' });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ decidedBy: 'owner', byAssessor: true });
    expect((await call('PUT', '/quality/decisions/1', owner.token, { decision: 'check' })).json().byAssessor).toBe(false);
    expect((await call('GET', '/quality', owner.token)).json().decisions.map((d: { plot: string; byAssessor: boolean }) => [d.plot, d.byAssessor])).toEqual([
      ['1', false],
      ['4', true],
    ]);
    // Nor undo one: plot 3 decided by the owner, rita checked it.
    await call('PUT', '/quality/decisions/3', owner.token, { decision: 'first' });
    expect((await call('DELETE', '/quality/decisions/3', rita.token)).statusCode).toBe(409);
    expect((await call('DELETE', '/quality/decisions/1', rita.token)).statusCode).toBe(204);
  });
});
