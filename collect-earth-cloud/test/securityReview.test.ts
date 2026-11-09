import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// The low findings of the security review (2026-11): one test each.
describe('security review: sessions, accounts and members', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('a session ends once unused for its idle days', async () => {
    const owner = await setupPlatformAdmin(ctx.app);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(owner.token) })).statusCode).toBe(200);
    ctx.store.expireSession(owner.token);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(owner.token) })).statusCode).toBe(401);
  });
  /** An account in the project with `role`, signed in. */
  const member = async (projectId: string, username: string, role: 'admin' | 'reviewer' | 'operator') => {
    const user = await ctx.store.createUser({ username, passwordHash: 'x', email: null });
    await ctx.store.addMembership(projectId, user.id, role);
    return { userId: user.id, token: await ctx.store.createSession(user.id) };
  };

  it('a made-up invitation does not tell whether a username is taken', async () => {
    await setupPlatformAdmin(ctx.app, 'existing');
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'existing', password: 'password12', inviteToken: 'made-up' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_invite');
  });

  it('wrong passwords for one account from many addresses are stopped too', async () => {
    // rate limits on (the tests' context has them off), generous per address
    await ctx.app.close();
    ctx = await makeContext({ rateLimitPerMinute: 100_000 });
    await setupPlatformAdmin(ctx.app, 'target');
    const guess = (i: number) => ctx.app.inject({
      method: 'POST', url: '/v1/auth/login', remoteAddress: `198.51.100.${i % 250}`, headers: { 'x-forwarded-for': `203.0.${i >> 8}.${i % 256}` },
      payload: { username: 'target', password: `guess-${i}` },
    });
    let refused = 0;
    for (let i = 0; i < 110; i++) if ((await guess(i)).statusCode === 429) refused += 1;
    // 100 in 15 minutes from all addresses together, then refused, the right password too
    expect(refused).toBe(10);
    const right = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: '192.0.2.9', payload: { username: 'target', password: 'owner-password' } });
    expect(right.statusCode).toBe(429);
  }, 60_000); // 111 password checks (scrypt)

  it('two admins cannot leave a project with none: the store checks it again', async () => {
    const project = await createProject(ctx.app);
    const a = await member(project.projectId, 'adm-a', 'admin');
    const b = await member(project.projectId, 'adm-b', 'admin');
    // both pass the route's own count, then the store takes them one after the other
    expect(await ctx.store.setMemberRole(project.projectId, b.userId, 'operator')).toBe('ok');
    expect(await ctx.store.setMemberRole(project.projectId, a.userId, 'operator')).toBe('last_admin');
    expect(await ctx.store.removeMember(project.projectId, a.userId)).toBe('last_admin');
    expect(await ctx.store.countAdmins(project.projectId)).toBe(1);
  });

  it('assignments go to members of the project only, and a bad id is a 400', async () => {
    const project = await createProject(ctx.app);
    const admin = await member(project.projectId, 'coord', 'admin');
    const other = await createProject(ctx.app, 'Other');
    const stranger = await member(other.projectId, 'stranger', 'operator');
    const file = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/csv-files/plots.csv`, headers: { ...bearer(admin.token), 'content-type': 'text/csv' }, payload: 'id,lat,lon\n1,0,0\n' });
    expect(file.statusCode, file.body).toBe(201);
    const csvFileId = file.json().id as string;
    const put = (assignments: unknown) => ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/assignments`, headers: bearer(admin.token), payload: { assignments } });
    expect((await put([{ userId: stranger.userId, csvFileId }])).statusCode).toBe(400);
    expect((await put([{ userId: 'not-a-uuid', csvFileId }])).statusCode).toBe(400);
    expect((await put([{ userId: admin.userId, csvFileId: 'not-a-uuid' }])).statusCode).toBe(400);
    const list = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/assignments`, headers: bearer(admin.token) })).json();
    expect(JSON.stringify(list)).not.toContain('stranger');
    expect((await put([{ userId: admin.userId, csvFileId }])).statusCode).toBe(200);
  });
});
