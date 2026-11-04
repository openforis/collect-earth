import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';
/** Required in the demo survey without condition. */
const REQUIRED = 'collect_code_land_use_subcategory';

describe('GET /quality/flags, the threshold, and the person page', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let rita: { token: string };
  let maria: { token: string };
  let ana: { token: string };

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string };
  };
  /** The flags once the figures caught up with the records (a stale answer is given while they are worked out). */
  const fresh = async (path: string) => {
    for (let i = 0; i < 200; i++) {
      const body = (await call('GET', path, owner.token)).json();
      if (!body.stale) return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the figures stayed stale');
  };
  const t0 = Date.UTC(2026, 9, 1, 9);
  const at = (seconds: number) => t0 + seconds * 1000;

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Flags' } })).json().projectId;
    rita = await join('rita', 'reviewer');
    maria = await join('maria', 'operator');
    ana = await join('ana', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 10 }, (_, i) => `${i + 1},0,0`)].join('\n'), { 'content-type': 'text/csv' });
    // ana: plot 1 at 0 s, 2 at 10 s (very fast), 3 at 30 s (20 s: not at 15, fast at 25), 4 at 100 s with the required answer blank.
    const records = [
      envelope({ recordKey: '1', operator: 'ana', modifiedOn: at(0), summary: { [LAND_USE]: 'F', [REQUIRED]: 'FN' } }),
      envelope({ recordKey: '2', operator: 'ana', modifiedOn: at(10), summary: { [LAND_USE]: 'C', [REQUIRED]: 'CA' } }),
      envelope({ recordKey: '3', operator: 'ana', modifiedOn: at(30), summary: { [LAND_USE]: 'G', [REQUIRED]: 'GG' } }),
      // As Collect Earth sends an empty question: null.
      envelope({ recordKey: '4', operator: 'ana', modifiedOn: at(100), summary: { [LAND_USE]: 'F', [REQUIRED]: null } as never }),
      // A record without the question at all (a survey without it, or stored before nulls were kept): not counted.
      envelope({ recordKey: '5', operator: 'ana', modifiedOn: at(200), summary: { [LAND_USE]: 'F' } }),
    ];
    const res = await batchRequest(ctx.app, pid, ana.token, records);
    expect(res.statusCode, res.body).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('the flags with their counts, by person and kind', async () => {
    const res = await call('GET', '/quality/flags', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ fastSeconds: 15, plots: 5, stale: false, total: 2 });
    expect(typeof body.computedAt).toBe('number');
    expect(body.counts).toEqual({ very_fast: 1, same_as_before: 0, required_empty: 1, edited_after_decision: 0, two_main: 0, no_plot: 0 });
    expect(body.flags).toEqual([
      { kind: 'required_empty', plot: '4', operator: 'ana', at: at(100), details: { questions: [{ key: REQUIRED, label: expect.any(String) }] } },
      { kind: 'very_fast', plot: '2', operator: 'ana', at: at(10), details: { gapMs: 10_000, previousPlot: '1' } },
    ]);
    expect(body.people).toEqual([{ username: 'ana', counts: expect.objectContaining({ very_fast: 1, required_empty: 1 }), total: 2 }]);
    expect(body.requiredQuestions).toBeGreaterThan(0);
    const fast = (await call('GET', '/quality/flags?kind=very_fast&person=ana', owner.token)).json();
    expect(fast.flags.map((f: { plot: string }) => f.plot)).toEqual(['2']);
    expect((await call('GET', '/quality/flags?person=nobody', owner.token)).json().flags).toEqual([]);
    for (const q of ['kind=slow', `person=${'x'.repeat(1001)}`]) {
      expect((await call('GET', `/quality/flags?${q}`, owner.token)).statusCode, q).toBe(400);
    }
  });

  it('the threshold is a project setting, audited, applied without working the figures out again', async () => {
    const computedAt = (await call('GET', '/quality/flags', owner.token)).json().computedAt;
    const put = await call('PUT', '/quality/settings', owner.token, { fastSeconds: 25 });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toEqual({ margins: {}, fastSeconds: 25 });
    const body = (await call('GET', '/quality/flags', owner.token)).json();
    expect(body.fastSeconds).toBe(25);
    expect(body.flags.filter((f: { kind: string }) => f.kind === 'very_fast').map((f: { plot: string }) => f.plot)).toEqual(['3', '2']);
    expect(body.stale).toBe(false);
    expect(body.computedAt).toBe(computedAt);
    // The margins stay as they were, and the threshold stays when the margins are saved.
    expect((await call('PUT', '/quality/settings', owner.token, { margins: {} })).json()).toEqual({ margins: {}, fastSeconds: 25 });
    expect((await call('GET', '/quality', owner.token)).json().settings).toEqual({ margins: {}, fastSeconds: 25 });
    const audit = await ctx.store.listAudit(pid, { limit: 10, action: 'settings.changed' });
    expect(audit.map((e) => e.details)).toEqual([{ setting: 'quality' }, { setting: 'quality' }]);
    for (const fastSeconds of [0, 121, 2.5, '15', null]) {
      const res = await call('PUT', '/quality/settings', owner.token, { fastSeconds });
      expect(res.statusCode, JSON.stringify(fastSeconds)).toBe(400);
    }
    expect((await call('PUT', '/quality/settings', rita.token, { fastSeconds: 30 })).statusCode).toBe(403);
    // A margins save and a threshold save at the same time: both stay.
    await Promise.all([
      call('PUT', '/quality/settings', owner.token, { margins: { collect_integer_forest_percentage: 5 } }),
      call('PUT', '/quality/settings', owner.token, { fastSeconds: 40 }),
    ]);
    expect((await call('GET', '/quality', owner.token)).json().settings).toEqual({ margins: { collect_integer_forest_percentage: 5 }, fastSeconds: 40 });
  });

  it('edited after a decision: from the decisions as they are now', async () => {
    await call('GET', '/quality/flags', owner.token);
    const decided = await call('PUT', '/quality/decisions/3', owner.token, { decision: 'first' });
    expect(decided.statusCode, decided.body).toBe(200);
    const decidedAt = decided.json().decidedAt as number;
    await batchRequest(ctx.app, pid, ana.token, [envelope({ recordKey: '3', operator: 'ana', modifiedOn: decidedAt + 1000, summary: { [LAND_USE]: 'C', [REQUIRED]: 'CA' } })]);
    const body = await fresh('/quality/flags?kind=edited_after_decision');
    expect(body.flags).toEqual([{ kind: 'edited_after_decision', plot: '3', operator: 'ana', at: decidedAt + 1000, details: { decision: 'first', decidedAt } }]);
  });

  it('edited after a decision: a plot only opened and gone through again (saved, same answers) is not', async () => {
    await call('GET', '/quality/flags', owner.token);
    const decided = await call('PUT', '/quality/decisions/2', owner.token, { decision: 'check' });
    expect(decided.statusCode, decided.body).toBe(200);
    // What it saw stays on the server.
    expect('seen' in decided.json()).toBe(false);
    expect((await ctx.store.listQualityDecisions(pid))[0].seen).toEqual([{ operator: 'ana', hash: expect.any(Number), full: expect.any(Number) }]);
    expect((await call('GET', '/quality', owner.token)).json().decisions[0]).not.toHaveProperty('seen');
    const decidedAt = decided.json().decidedAt as number;
    await batchRequest(ctx.app, pid, ana.token, [
      envelope({ recordKey: '2', operator: 'ana', modifiedOn: decidedAt + 1000, activelySaved: false, summary: { [LAND_USE]: 'C', [REQUIRED]: 'CA' } }),
    ]);
    const body = await fresh('/quality/flags?kind=edited_after_decision');
    expect(body.flags).toEqual([]);
  });

  it('coordinators and reviewers see them; collectors do not, nor in My work', async () => {
    expect((await call('GET', '/quality/flags', rita.token)).statusCode).toBe(200);
    // No flags per person for a reviewer (Decision 10), as for the answers per person.
    const byPerson = await call('GET', '/quality/flags?person=ana', rita.token);
    expect(byPerson.statusCode).toBe(403);
    expect(byPerson.json()).toEqual({ error: 'forbidden', reason: 'only coordinators see the flags per person' });
    expect((await call('GET', '/quality/flags?kind=very_fast', rita.token)).statusCode).toBe(200);
    expect((await call('GET', '/quality/flags', maria.token)).statusCode).toBe(403);
    expect((await call('GET', '/quality/flags', ana.token)).statusCode).toBe(403);
    await call('GET', '/quality/flags', owner.token);
    const mine = await call('GET', '/my-work', ana.token);
    expect(mine.statusCode).toBe(200);
    expect(mine.body).not.toMatch(/"flags"|very_fast|required_empty/);
    expect((await call('GET', '/my-quality', ana.token)).body).not.toMatch(/"flags"|very_fast|required_empty|problemsByPerson/);
  });

  it('the person page counts them from the figures at hand, never working them out', async () => {
    const members = await ctx.store.listMembers(pid);
    const anaId = members.find((m) => m.username === 'ana')!.userId;
    const before = (await call('GET', `/people/${anaId}`, owner.token)).json();
    expect(before.quality.flags).toBeNull();
    expect(before.quality.available).toBe(false);
    await call('GET', '/quality/flags', owner.token);
    const after = (await call('GET', `/people/${anaId}`, owner.token)).json();
    expect(after.quality.flags).toEqual({ very_fast: 1, same_as_before: 0, required_empty: 1, edited_after_decision: 0, two_main: 0, no_plot: 0 });
    // The page's speed counts "very fast" as the flags do: the same plots, order and threshold.
    expect(after.speed.veryFast).toBe(1);
    await call('PUT', '/quality/settings', owner.token, { fastSeconds: 25 });
    const at25 = (await call('GET', `/people/${anaId}`, owner.token)).json();
    expect(at25.quality.flags.very_fast).toBe(2);
    expect(at25.speed.veryFast).toBe(2);
  });
});
