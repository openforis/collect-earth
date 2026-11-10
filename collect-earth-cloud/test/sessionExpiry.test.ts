import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_IDLE_MS, SESSION_TOUCH_MS, sessionIdleDays } from '../src/auth.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const DAY = 24 * 3_600_000;

describe('a sign-in unused for months', () => {
  let ctx: TestContext;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('stops working, while one in use is kept alive', async () => {
    ctx = await makeContext();
    const { token, userId } = await setupPlatformAdmin(ctx.app);
    const start = Date.now();
    expect(SESSION_IDLE_MS).toBe(90 * DAY);
    // used after 80 days: kept, and that use counts
    expect(await ctx.store.resolveSession(token, start + 80 * DAY)).toEqual({ userId });
    // 160 days after it was made, 80 after its last use: still there
    expect(await ctx.store.resolveSession(token, start + 160 * DAY)).toEqual({ userId });
    // then 91 days with no use: gone, also for a later use within the period
    expect(await ctx.store.resolveSession(token, start + 251 * DAY)).toBeNull();
    expect(await ctx.store.resolveSession(token, start + 252 * DAY)).toBeNull();
  });

  it('is written down at most once an hour, and the server refuses it once expired', async () => {
    ctx = await makeContext();
    const { token, userId } = await setupPlatformAdmin(ctx.app);
    const start = Date.now();
    // a use less than an hour after the last one does not count as one: the period runs from creation
    expect(await ctx.store.resolveSession(token, start + SESSION_TOUCH_MS - 1000)).toEqual({ userId });
    expect(await ctx.store.resolveSession(token, start + 90 * DAY + 1000)).toBeNull();
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
    expect(me.statusCode).toBe(401);
  });

  it('can be set from 1 day to 10 years', () => {
    expect(sessionIdleDays(undefined)).toBe(90);
    expect(sessionIdleDays('30')).toBe(30);
    expect(sessionIdleDays('0')).toBe(90);
    expect(sessionIdleDays('2.5')).toBe(90);
    expect(sessionIdleDays('5000')).toBe(90);
  });
});
