import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyLww } from '../src/lww.js';
import { activeSecondsOf, MAX_ACTIVE_SECONDS } from '../src/routes/records.js';
import { bandOf, MIN_TIMED_FOR_QUICK, quantile, timeSpent, type TimedRecord } from '../src/timeSpent.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const rec = (plot: string, operator: string, seconds: number | null, submittedAt = 1000): TimedRecord => ({ plot, operator, seconds, submittedAt });

describe('time spent: figures', () => {
  it('quantiles and bands', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([10], 0.5)).toBe(10);
    expect(quantile([10, 20], 0.5)).toBe(15);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect([0, 29, 30, 59, 60, 119, 120, 299, 300, 599, 600, 1199, 1200, 99_999].map(bandOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it('a plot under a quarter of the team median is quick, once enough plots are timed', () => {
    // 20 plots of 120 s by ana, and bo's 3 plots: 20 s, 29 s, 30 s. Median 120 s, limit 30 s.
    const records = [
      ...Array.from({ length: 20 }, (_, i) => rec(`a${i}`, 'ana', 120)),
      rec('b1', 'bo', 20, 5),
      rec('b2', 'bo', 29, 6),
      rec('b3', 'bo', 30, 7),
      rec('b4', 'bo', null),
    ];
    const t = timeSpent(records);
    expect(t).toMatchObject({ timed: 23, untimed: 1, medianSeconds: 120, quickBelowSeconds: 30, quickCount: 2, minTimed: MIN_TIMED_FOR_QUICK });
    expect(t.quick).toEqual([
      { plot: 'b1', operator: 'bo', seconds: 20, submittedAt: 5 },
      { plot: 'b2', operator: 'bo', seconds: 29, submittedAt: 6 },
    ]);
    const bo = t.people.find((p) => p.username === 'bo')!;
    expect(bo).toMatchObject({ timed: 3, untimed: 1, medianSeconds: 29, quick: 2, totalSeconds: 79 });
    expect(bo.bands).toEqual([2, 1, 0, 0, 0, 0, 0]);
    expect(t.people.find((p) => p.username === 'ana')).toMatchObject({ timed: 20, medianSeconds: 120, q1Seconds: 120, q3Seconds: 120, quick: 0 });
    expect(t.bands).toEqual([2, 1, 0, 20, 0, 0, 0]);
    // One person: their row and quick plots, the limit still the team's.
    const one = timeSpent(records, { person: 'bo' });
    expect(one.people.map((p) => p.username)).toEqual(['bo']);
    expect(one.quickCount).toBe(2);
    expect(one.quickBelowSeconds).toBe(30);
  });

  it('with too few timed plots nothing is called quick', () => {
    const t = timeSpent([rec('1', 'ana', 300), rec('2', 'ana', 5), rec('3', 'bo', null)]);
    expect(t).toMatchObject({ timed: 2, untimed: 1, quickBelowSeconds: null, quickCount: 0, quick: [] });
    expect(timeSpent([])).toMatchObject({ timed: 0, medianSeconds: null, people: [] });
  });

  it('the time sent with a record: whole seconds, a week at most, else not known', () => {
    expect(activeSecondsOf(12.6)).toBe(13);
    expect(activeSecondsOf(0)).toBe(0);
    expect(activeSecondsOf(-1)).toBeNull();
    expect(activeSecondsOf(MAX_ACTIVE_SECONDS + 1)).toBeNull();
    expect(activeSecondsOf('60')).toBeNull();
    expect(activeSecondsOf(undefined)).toBeNull();
    expect(activeSecondsOf(Number.NaN)).toBeNull();
  });

  it('a save carries its time; a deletion keeps the one before', () => {
    const saved = applyLww(envelope({ modifiedOn: 1000, activeSeconds: 95 }), null, 2000).row;
    expect(saved.activeSeconds).toBe(95);
    expect(applyLww(envelope({ modifiedOn: 3000, deleted: true, xml: null }), saved, 4000).row.activeSeconds).toBe(95);
    expect(applyLww(envelope({ modifiedOn: 3000 }), saved, 4000).row.activeSeconds).toBeNull();
  });
});

describe('time spent: route', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  const people: Record<string, { token: string; userId: string }> = {};
  const call = (path: string, token: string) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}${path}`, headers: bearer(token) });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role, maxUses: 1 } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    people[username] = { token: res.json().token as string, userId: res.json().userId as string };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Times')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    await join('ana', 'operator');
    await join('rev', 'reviewer');
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const csv = `id,lat,lon\n${ids.map((i) => `${i},-10,${20 + i}`).join('\n')}\n`;
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/north.csv`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: csv });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('coordinators see each person\'s time and the quick plots; reviewers and collectors do not', async () => {
    const envelopes = [
      // 22 submitted plots of 200 s, one of 10 s, a draft and a plot in no file (neither counts), one with no time
      ...Array.from({ length: 22 }, (_, i) => envelope({ recordKey: String(i + 1), operator: 'ana', modifiedOn: 1000 + i, activeSeconds: 200 })),
      envelope({ recordKey: '23', operator: 'ana', modifiedOn: 5000, activeSeconds: 10 }),
      envelope({ recordKey: '24', operator: 'ana', modifiedOn: 5000, activelySaved: false, activeSeconds: 1 }),
      envelope({ recordKey: '999', operator: 'ana', modifiedOn: 5000, activeSeconds: 1 }),
      envelope({ recordKey: '25', operator: 'ana', modifiedOn: 5000 }),
    ];
    const res = await batchRequest(ctx.app, pid, people.ana.token, envelopes);
    expect(res.statusCode, res.body).toBe(200);

    expect((await call('/time-spent', people.ana.token)).statusCode).toBe(403);
    expect((await call('/time-spent', people.rev.token)).statusCode).toBe(403);
    const t = (await call('/time-spent', owner.token)).json();
    expect(t).toMatchObject({ timed: 23, untimed: 1, medianSeconds: 200, quickBelowSeconds: 50, quickCount: 1 });
    expect(t.quick).toEqual([{ plot: '23', operator: 'ana', seconds: 10, submittedAt: expect.any(Number) }]);
    expect(t.people).toEqual([expect.objectContaining({ username: 'ana', timed: 23, untimed: 1, quick: 1 })]);
    expect((await call('/time-spent?person=nobody', owner.token)).json().people).toEqual([]);
  });
});
