import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe("the server owner's announcement banner", () => {
  let ctx: TestContext;
  let owner: string;
  let user: string;
  const put = (payload: Record<string, unknown>, token = owner) => ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(token), payload });
  const me = async (token = user) => (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).json().announcement;

  beforeEach(async () => {
    ctx = await makeContext();
    owner = (await setupPlatformAdmin(ctx.app)).token;
    await put({ signupOpen: true });
    user = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username: 'ana', password: 'password12' } })).json().token;
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('is shown to every signed-in person until it expires or is cleared', async () => {
    expect(await me()).toBeNull();
    const until = Date.now() + 3_600_000;
    const res = await put({ announcement: '  Maintenance on Sunday 8-10 UTC  ', announcementUntil: until });
    expect(res.json()).toMatchObject({ announcement: 'Maintenance on Sunday 8-10 UTC', announcementUntil: until });
    expect(await me()).toEqual({ text: 'Maintenance on Sunday 8-10 UTC', until });
    expect(await me(owner)).toEqual({ text: 'Maintenance on Sunday 8-10 UTC', until });
    // No expiry: until cleared.
    await put({ announcementUntil: null });
    expect(await me()).toEqual({ text: 'Maintenance on Sunday 8-10 UTC', until: null });
    await put({ announcementUntil: Date.now() - 1000 });
    expect(await me()).toBeNull();
    await put({ announcement: null, announcementUntil: null });
    expect(await me()).toBeNull();
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: bearer(owner) })).json()).toMatchObject({ announcement: null, announcementUntil: null });
  });

  it('only the server owner sets it, plain and short', async () => {
    expect((await put({ announcement: 'hi' }, user)).statusCode).toBe(403);
    expect((await put({ announcement: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await put({ announcementUntil: 'tomorrow' })).statusCode).toBe(400);
    expect((await put({ announcement: 42 })).statusCode).toBe(400);
  });
});
