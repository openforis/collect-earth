import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildOverview, isoWeekLabel, isoWeekStart } from '../src/serverPanel.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const DAY = 86_400_000;

function login(app: FastifyInstance, username: string, password: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });
}

function overview(app: FastifyInstance, token: string) {
  return app.inject({ method: 'GET', url: '/v1/admin/overview', headers: bearer(token) });
}

/** A project of the owner's with maria as a collector, and maria's session. */
async function projectWithCollector(app: FastifyInstance, ownerToken: string, name: string, username = 'maria') {
  const created = await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name } });
  expect(created.statusCode).toBe(201);
  const pid = created.json().projectId as string;
  const inv = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(ownerToken), payload: { role: 'operator' } });
  const inviteToken = inv.json().inviteToken as string;
  const reg = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: `${username}-password`, inviteToken } });
  expect(reg.statusCode).toBe(201);
  return { pid, user: reg.json() as { token: string; userId: string } };
}

describe("the server owner's panel", () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await ctx.app.close();
  });

  it('is for platform admins only', async () => {
    const { user } = await projectWithCollector(ctx.app, owner.token, 'P');
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/admin/overview' })).statusCode).toBe(401);
    expect((await overview(ctx.app, user.token)).statusCode).toBe(403);
    expect((await overview(ctx.app, owner.token)).statusCode).toBe(200);
  });

  it('gives totals only: no project name, no username, no answer, no file name', async () => {
    const { pid, user } = await projectWithCollector(ctx.app, owner.token, 'Secret Forest Project');
    const sent = await batchRequest(ctx.app, pid, user.token, [
      envelope({ recordKey: '17', operator: 'maria', summary: { land_use: 'Forest-XYZ' }, xml: '<record><land_use>Forest-XYZ</land_use></record>' }),
      envelope({ recordKey: '18', operator: 'maria', summary: { land_use: 'Forest-XYZ' } }),
    ]);
    expect(sent.statusCode).toBe(200);
    const res = await overview(ctx.app, owner.token);
    const body = res.body;
    for (const secret of ['Secret Forest', 'maria', 'owner', 'Forest-XYZ', 'land_use', '<record']) {
      expect(body).not.toContain(secret);
    }
    const o = res.json();
    // A project appears by its id and size only (§4b).
    expect(o.projects.largest).toEqual([{ projectId: pid, storageBytes: expect.any(Number) }]);
    expect(Object.keys(o.projects.largest[0]).sort()).toEqual(['projectId', 'storageBytes']);
    expect(o.projects).toMatchObject({ total: 1, active: 1 });
    expect(o.projects.storageBytes).toBe(o.projects.largest[0].storageBytes);
    expect(o.records.received).toBe(2);
  });

  it('counts accounts, sign-ups by week, active accounts and projects, records per day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Wednesday of ISO week 2026-W45.
    const now = Date.UTC(2026, 10, 4, 12);
    // A server of its own, set up 60 days before (week 2026-W36).
    await ctx.app.close();
    vi.setSystemTime(now - 60 * DAY);
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    vi.setSystemTime(now - 40 * DAY);
    await projectWithCollector(ctx.app, owner.token, 'Old', 'ana');
    vi.setSystemTime(now);
    const { pid, user } = await projectWithCollector(ctx.app, owner.token, 'New', 'maria');
    await batchRequest(ctx.app, pid, user.token, [envelope({ recordKey: '1' }), envelope({ recordKey: '2' })]);
    const o = (await overview(ctx.app, owner.token)).json();

    expect(o.users).toMatchObject({ total: 3, disabled: 0, platformAdmins: 1 });
    // ana registered 40 days ago (a session then) and was not seen since; owner and maria were.
    expect(o.users.active).toBe(2);
    expect(o.users.signupsByWeek).toHaveLength(12);
    const weeks = Object.fromEntries(o.users.signupsByWeek.map((w: { week: string; count: number }) => [w.week, w.count]));
    expect(weeks['2026-W45']).toBe(1); // maria
    expect(weeks['2026-W36']).toBe(1); // owner
    expect(weeks['2026-W39']).toBe(1); // ana, on Friday 25 September
    expect(o.users.signupsByWeek.at(-1).week).toBe('2026-W45');

    expect(o.projects).toMatchObject({ total: 2, active: 1 });
    expect(o.records.receivedByDay).toHaveLength(30);
    expect(o.records.receivedByDay.at(-1)).toEqual({ day: Date.UTC(2026, 10, 4), count: 2 });
    expect(o.records.received).toBe(2);
  });

  it('keeps the overview for a minute per instance (its time says how old), fresh after a disable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // A server made under the fake clock (it keeps the clock it was built with).
    await ctx.app.close();
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    const t0 = Date.now();
    const first = (await overview(ctx.app, owner.token)).json();
    await projectWithCollector(ctx.app, owner.token, 'Another');
    vi.setSystemTime(t0 + 30_000);
    const cached = (await overview(ctx.app, owner.token)).json();
    expect(cached.asOf).toBe(first.asOf);
    expect(cached.projects.total).toBe(0);
    vi.setSystemTime(t0 + 61_000);
    const fresh = (await overview(ctx.app, owner.token)).json();
    expect(fresh.asOf).toBe(t0 + 61_000);
    expect(fresh.projects.total).toBe(1);
    // Disabling or enabling an account drops the kept one.
    const maria = (await ctx.store.getUserByUsername('maria'))!;
    await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${maria.id}/disable`, headers: bearer(owner.token) });
    expect((await overview(ctx.app, owner.token)).json().users.disabled).toBe(1);
  });

  it('is behind the rate limiter', async () => {
    const limited = await makeContext({ rateLimitPerMinute: 2 });
    try {
      const admin = await setupPlatformAdmin(limited.app);
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await overview(limited.app, admin.token)).statusCode);
      expect(codes).toEqual([200, 200, 429]);
    } finally {
      await limited.app.close();
    }
  });

  it('says what the database and the server are', async () => {
    const o = (await overview(ctx.app, owner.token)).json();
    expect(o.database).toEqual({ backend: 'memory', sizeBytes: null, version: null, migrations: null });
    expect(typeof o.server.version).toBe('string');
    expect(o.server.startedAt).toBeLessThanOrEqual(Date.now());
  });

  it('counts failed logins by hour', async () => {
    await login(ctx.app, 'owner', 'wrong-password');
    await login(ctx.app, 'nobody', 'wrong-password');
    await login(ctx.app, 'owner', 'owner-password');
    const o = (await overview(ctx.app, owner.token)).json();
    expect(o.security.totals).toEqual({ failedLogins: 2, rateLimited: 0 });
    expect(o.security.hours).toHaveLength(1);
    expect(o.security.hours[0]).toMatchObject({ failedLogins: 2, rateLimited: 0 });
  });

  it('counts the requests the rate limiter refuses', async () => {
    const limited = await makeContext({ rateLimitPerMinute: 2 });
    try {
      const admin = await setupPlatformAdmin(limited.app);
      for (let i = 0; i < 4; i++) {
        await login(limited.app, 'owner', 'wrong-password');
      }
      const o = (await overview(limited.app, admin.token)).json();
      // Two logins went through (wrong: failed), two were refused before the password was looked at.
      expect(o.security.totals).toEqual({ failedLogins: 2, rateLimited: 2 });
    } finally {
      await limited.app.close();
    }
  });
});

describe('disabling an account', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  let pid: string;
  let maria: { token: string; userId: string };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    ({ pid, user: maria } = await projectWithCollector(ctx.app, owner.token, 'P'));
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  const disable = (uid: string, token = owner.token) =>
    ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${uid}/disable`, headers: bearer(token) });
  const enable = (uid: string, token = owner.token) =>
    ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${uid}/enable`, headers: bearer(token) });

  it('ends its sessions and stops it logging in until enabled again', async () => {
    const before = await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '1' })]);
    expect(before.statusCode).toBe(200);
    const res = await disable(maria.userId);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ userId: maria.userId, username: 'maria', disabledAt: expect.any(Number), disabledBy: 'owner' });

    // Collect Earth's next sync and the dashboard: the session is gone.
    expect((await batchRequest(ctx.app, pid, maria.token, [envelope({ recordKey: '2' })])).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(maria.token) })).statusCode).toBe(401);
    // The right password says why; a wrong one says nothing more than before.
    const refused = await login(ctx.app, 'maria', 'maria-password');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('account_disabled');
    expect(refused.json().reason).toMatch(/disabled/);
    expect((await login(ctx.app, 'maria', 'not-it')).json().error).toBe('invalid_credentials');
    // The name stays taken; no reset link for it while disabled.
    const reset = await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${maria.userId}/password-reset`, headers: bearer(owner.token) });
    expect(reset.statusCode).toBe(409);
    expect(reset.json().error).toBe('account_disabled');

    const users = (await ctx.app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(owner.token) })).json().users;
    expect(users.find((u: { username: string }) => u.username === 'maria')).toMatchObject({ disabledBy: 'owner' });
    expect((await overview(ctx.app, owner.token)).json().users.disabled).toBe(1);

    // Disabling twice keeps the first time; enabling lets it log in again.
    expect((await disable(maria.userId)).json().user.disabledAt).toBe(res.json().user.disabledAt);
    const back = await enable(maria.userId);
    expect(back.statusCode).toBe(200);
    expect(back.json().user).toMatchObject({ disabledAt: null, disabledBy: null });
    const again = await login(ctx.app, 'maria', 'maria-password');
    expect(again.statusCode).toBe(200);
    expect((await batchRequest(ctx.app, pid, again.json().token, [envelope({ recordKey: '2' })])).statusCode).toBe(200);
  });

  it('refuses disabling yourself, an unknown account, and anyone but a platform admin asking', async () => {
    expect((await disable(owner.userId)).json().error).toBe('own_account');
    expect((await disable(owner.userId)).statusCode).toBe(409);
    expect((await disable('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    expect((await disable('not-a-uuid')).statusCode).toBe(404);
    expect((await enable('not-a-uuid')).statusCode).toBe(404);
    expect((await disable(owner.userId, maria.token)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${maria.userId}/disable` })).statusCode).toBe(401);
  });

  it('two admins deleting their accounts at once: one goes, the last enabled one stays', async () => {
    (await ctx.store.getUserById(maria.userId))!.isPlatformAdmin = true;
    const del = (token: string, password: string) =>
      ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(token), payload: { password } });
    const [a, b] = await Promise.all([del(owner.token, 'owner-password'), del(maria.token, 'maria-password')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([204, 409]);
    expect(await ctx.store.countPlatformAdmins()).toBe(1);
    // The store refuses it whoever calls, and leaves the account as it was.
    const left = (await ctx.store.listUsers()).find((u) => u.isPlatformAdmin)!;
    expect(await ctx.store.deleteUser(left.userId)).toBe('last_platform_admin');
    expect(await ctx.store.getUserById(left.userId)).not.toBeNull();
  });

  it('makes no reset link for a disabled account, in the store too', async () => {
    await disable(maria.userId);
    expect(await ctx.store.createPasswordReset(maria.userId, Date.now() + 60_000)).toBeNull();
    await enable(maria.userId);
    expect(typeof (await ctx.store.createPasswordReset(maria.userId, Date.now() + 60_000))).toBe('string');
  });

  it("marks a disabled member in the project's member list and People tab, and does not count them as active", async () => {
    await disable(maria.userId);
    const members = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/members`, headers: bearer(owner.token) })).json().members;
    expect(members.find((m: { username: string }) => m.username === 'maria')).toMatchObject({ disabled: true });
    expect(members.find((m: { username: string }) => m.username === 'owner')).toMatchObject({ disabled: false });
    const people = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/people`, headers: bearer(owner.token) })).json().people;
    expect(people.find((p: { username: string }) => p.username === 'maria').status).toEqual({ kind: 'disabled' });
    // maria was seen in the project today, but a disabled account is not active.
    expect((await overview(ctx.app, owner.token)).json().users.active).toBe(1);
  });

  it('disables another platform admin but never the last one', async () => {
    // A second platform admin (made in the store: no route promotes an account).
    const second = await ctx.store.getUserById(maria.userId);
    second!.isPlatformAdmin = true;
    expect(await ctx.store.countPlatformAdmins()).toBe(2);
    expect((await disable(maria.userId)).statusCode).toBe(200);
    expect(await ctx.store.countPlatformAdmins()).toBe(1);
    // A disabled admin's session no longer passes requirePlatformAdmin.
    expect((await disable(owner.userId, maria.token)).statusCode).toBe(401);
    // The store refuses the last enabled platform admin, whoever asks.
    expect(await ctx.store.disableUser(owner.userId, maria.userId)).toBe('last_platform_admin');
    expect((await login(ctx.app, 'owner', 'owner-password')).statusCode).toBe(200);
    // Deleting your account as the last enabled platform admin is refused too.
    const deletion = await ctx.app.inject({ method: 'GET', url: '/v1/me/deletion', headers: bearer(owner.token) });
    expect(deletion.json().lastPlatformAdmin).toBe(true);
  });
});

describe('the migrations figure', () => {
  it('gives the newest first-run time of the recorded migrations and the missing files', () => {
    const o = buildOverview({
      now: Date.UTC(2026, 10, 4),
      stats: { users: 0, disabledUsers: 0, platformAdmins: 0, activeUsers: 0, signupsByDay: [], projects: [], receivedByDay: [] },
      health: { sizeBytes: 1, version: '16.4', migrations: [{ name: '001_init.sql', firstAppliedAt: 5 }, { name: '002_accounts.sql', firstAppliedAt: 9 }] },
      backend: 'postgres',
      shippedMigrations: ['001_init.sql', '002_accounts.sql', '003_assignments.sql'],
      version: 'v',
      startedAt: 0,
      security: { since: 0, totals: { failedLogins: 0, rateLimited: 0 }, hours: [], lateDraws: 0, lastLateDrawAt: null },
    });
    expect(o.database.migrations).toEqual({ applied: 2, shipped: 3, latest: '002_accounts.sql', newestAppliedAt: 9, missing: ['003_assignments.sql'] });
  });
});

describe('ISO weeks (UTC)', () => {
  it('names weeks by the year of their Thursday', () => {
    expect(isoWeekLabel(Date.UTC(2026, 0, 1))).toBe('2026-W01'); // a Thursday
    expect(isoWeekLabel(Date.UTC(2027, 0, 1))).toBe('2026-W53'); // a Friday
    expect(isoWeekLabel(Date.UTC(2024, 11, 30))).toBe('2025-W01'); // a Monday
    expect(isoWeekLabel(Date.UTC(2026, 10, 8, 23, 59))).toBe('2026-W45'); // Sunday night
    expect(isoWeekStart(Date.UTC(2026, 10, 8, 23, 59))).toBe(Date.UTC(2026, 10, 2));
  });
});
