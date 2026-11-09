import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe('signing out everywhere', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  let pid: string;
  const register = async (name: string, role: 'operator' | 'admin') => {
    const inv = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role, maxUses: 1 } });
    return (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: name, password: 'password12', inviteToken: inv.json().inviteToken } })).json() as { token: string; userId: string };
  };
  const login = async (name: string) => (await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: name, password: 'password12' } })).json().token as string;
  const me = async (token: string) => (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode;

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Lost laptop')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("lets a coordinator end every session of a member, who stays in the project and logs in again", async () => {
    const coordinator = await register('cora', 'admin');
    const ana = await register('ana', 'operator');
    const laptop = await login('ana');
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/members/${ana.userId}/sign-out`, headers: bearer(coordinator.token) });
    expect(res.statusCode, res.body).toBe(204);
    expect(await me(ana.token)).toBe(401);
    expect(await me(laptop)).toBe(401);
    expect(await ctx.store.getMembership(pid, ana.userId)).not.toBeNull();
    expect(await me(await login('ana'))).toBe(200);
    // logged without the name
    const log = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/activity`, headers: bearer(coordinator.token) });
    expect(log.body).toContain('member.signed_out');
  });

  it("is for coordinators, for the project's members, and leaves the server's administrators to themselves", async () => {
    const coordinator = await register('cora', 'admin');
    const ana = await register('ana', 'operator');
    const bo = await register('bo', 'operator');
    expect((await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/members/${bo.userId}/sign-out`, headers: bearer(ana.token) })).statusCode).toBe(403);
    const other = (await createProject(ctx.app, 'Other')).projectId;
    await ctx.store.addMembership(other, owner.userId, 'admin');
    expect((await ctx.app.inject({ method: 'POST', url: `/v1/projects/${other}/members/${ana.userId}/sign-out`, headers: bearer(owner.token) })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/members/${owner.userId}/sign-out`, headers: bearer(coordinator.token) })).statusCode).toBe(403);
    expect(await me(owner.token)).toBe(200);
    // the server's administrator may
    expect((await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/members/${bo.userId}/sign-out`, headers: bearer(owner.token) })).statusCode).toBe(204);
  });

  it('lets anyone end their other sessions, keeping this one', async () => {
    const ana = await register('ana', 'operator');
    const laptop = await login('ana');
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout-others', headers: bearer(ana.token) });
    expect(res.statusCode).toBe(204);
    expect(await me(ana.token)).toBe(200);
    expect(await me(laptop)).toBe(401);
  });
});
