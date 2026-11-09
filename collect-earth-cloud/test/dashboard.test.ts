import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OSM_TILES } from '../src/config.js';
import {
  batchRequest,
  bearer,
  createProject,
  envelope,
  makeContext,
  setupPlatformAdmin,
  TEST_SETUP_CODE,
  type TestContext,
} from './helpers.js';

async function invite(app: FastifyInstance, pid: string, token: string, body: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(token), payload: body });
}

function register(app: FastifyInstance, username: string, password: string, inviteToken: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password, inviteToken } });
}

function login(app: FastifyInstance, username: string, password: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });
}

function signup(app: FastifyInstance, username: string, password: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username, password } });
}

async function setSettings(app: FastifyInstance, adminToken: string, settings: Record<string, unknown>) {
  const res = await app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(adminToken), payload: settings });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('first-run setup and server info', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('reports needsSetup and the defaults until the platform admin exists', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/server-info' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ needsSetup: true, signupOpen: false, projectCreation: 'platform-admins' });
    expect(typeof res.json().version).toBe('string');
    // The map's base map: OpenStreetMap unless the server sets another (MAP_TILE_URL).
    expect(res.json().mapTiles).toEqual(OSM_TILES);
  });

  it('gives the map tiles the server sets', async () => {
    const tiles = { url: 'https://t.example.org/{z}/{x}/{y}.png', attribution: '© Example', attributionUrl: null, maxZoom: 17 };
    const other = await makeContext({ mapTiles: tiles });
    expect((await other.app.inject({ method: 'GET', url: '/v1/server-info' })).json().mapTiles).toEqual(tiles);
    await other.app.close();
  });

  it('rejects a wrong code, creates the admin with the right one, then refuses a second setup', async () => {
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/v1/setup',
      payload: { setupCode: 'NOPE-NOPE', username: 'owner', password: 'owner-password' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe('bad_setup_code');

    // Case, spaces and hyphens do not matter when typing the code.
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/v1/setup',
      payload: { setupCode: ` ${TEST_SETUP_CODE.toLowerCase().replace(/-/g, ' ')} `, username: 'owner', password: 'owner-password' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ username: 'owner' });
    const token = ok.json().token as string;

    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
    expect(me.json()).toMatchObject({ username: 'owner', isPlatformAdmin: true, memberships: [] });

    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/setup',
      payload: { setupCode: TEST_SETUP_CODE, username: 'other', password: 'other-password' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_set_up');

    const info = await ctx.app.inject({ method: 'GET', url: '/v1/server-info' });
    expect(info.json().needsSetup).toBe(false);
  });

  it('applies the username and password rules on setup', async () => {
    const shortName = await ctx.app.inject({
      method: 'POST',
      url: '/v1/setup',
      payload: { setupCode: TEST_SETUP_CODE, username: 'ab', password: 'owner-password' },
    });
    expect(shortName.json().error).toBe('bad_username');
    const shortPw = await ctx.app.inject({
      method: 'POST',
      url: '/v1/setup',
      payload: { setupCode: TEST_SETUP_CODE, username: 'owner', password: 'short' },
    });
    expect(shortPw.statusCode).toBe(400);
    expect(shortPw.json().error).toBe('weak_password');
  });

  it('generates a setup code when SETUP_CODE is unset (a guess does not work)', async () => {
    const other = await makeContext({ setupCode: undefined });
    try {
      const res = await other.app.inject({
        method: 'POST',
        url: '/v1/setup',
        payload: { setupCode: TEST_SETUP_CODE, username: 'owner', password: 'owner-password' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await other.app.close();
    }
  });
});

describe('sign-up and project creation modes', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('refuses sign-up while closed, allows it once opened, applies the rules', async () => {
    const closed = await signup(ctx.app, 'maria', 'maria-password');
    expect(closed.statusCode).toBe(403);
    expect(closed.json().error).toBe('signup_closed');

    await setSettings(ctx.app, owner.token, { signupOpen: true });
    const ok = await signup(ctx.app, 'maria', 'maria-password');
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ username: 'maria' });
    expect(typeof ok.json().token).toBe('string');

    expect((await signup(ctx.app, 'maria', 'maria-password')).json().error).toBe('username_taken');
    expect((await signup(ctx.app, 'a b', 'maria-password')).json().error).toBe('bad_username');
    expect((await signup(ctx.app, 'juan', '1234567')).json().error).toBe('weak_password');
  });

  it('session project creation: platform admin always, others only when projectCreation=anyone', async () => {
    const mine = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: bearer(owner.token),
      payload: { name: 'Owner project' },
    });
    expect(mine.statusCode).toBe(201);
    expect(mine.json()).toEqual({ projectId: expect.any(String), name: 'Owner project' });
    // The creator is the project's admin (and no Phase-0 tokens are handed out).
    const projects = await ctx.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(owner.token) });
    expect(projects.json().projects).toEqual([
      { projectId: mine.json().projectId, projectName: 'Owner project', role: 'admin', status: 'active' },
    ]);

    await setSettings(ctx.app, owner.token, { signupOpen: true });
    const maria = (await signup(ctx.app, 'maria', 'maria-password')).json().token as string;
    const refused = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(maria), payload: { name: 'x' } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('project_creation_restricted');

    await setSettings(ctx.app, owner.token, { projectCreation: 'anyone' });
    const allowed = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(maria), payload: { name: 'Maria' } });
    expect(allowed.statusCode).toBe(201);

    const badSession = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer('nonsense'), payload: {} });
    expect(badSession.statusCode).toBe(401);
  });

  it('x-admin-key and anonymous provisioning follow ADMIN_API_KEY and the store backend', async () => {
    // Memory store, no key: anonymous provisioning (tests/dev) returns the Phase-0 tokens.
    const anon = await ctx.app.inject({ method: 'POST', url: '/v1/projects', payload: { name: 'anon' } });
    expect(anon.statusCode).toBe(201);
    expect(anon.json()).toHaveProperty('adminToken');

    const keyed = await makeContext({ adminApiKey: 'secret-key' });
    try {
      expect((await keyed.app.inject({ method: 'POST', url: '/v1/projects', payload: {} })).statusCode).toBe(401);
      const wrong = await keyed.app.inject({ method: 'POST', url: '/v1/projects', headers: { 'x-admin-key': 'nope' }, payload: {} });
      expect(wrong.statusCode).toBe(401);
      const right = await keyed.app.inject({
        method: 'POST',
        url: '/v1/projects',
        headers: { 'x-admin-key': 'secret-key' },
        payload: { name: 'keyed' },
      });
      expect(right.statusCode).toBe(201);
      expect(right.json()).toHaveProperty('projectToken');
    } finally {
      await keyed.app.close();
    }

    // A persistent backend never provisions anonymously, even without a key.
    // (The memory store stands in for Postgres here: only the config flag matters.)
    const persistent = await makeContext({ storeBackend: 'postgres' });
    try {
      expect((await persistent.app.inject({ method: 'POST', url: '/v1/projects', payload: {} })).statusCode).toBe(401);
    } finally {
      await persistent.app.close();
    }
  });

  it('a platform admin is not a member: project routes of others answer 404', async () => {
    const p = await createProject(ctx.app, 'Someone else');
    for (const url of [`/v1/projects/${p.projectId}`, `/v1/projects/${p.projectId}/overview`, `/v1/projects/${p.projectId}/export.csv`]) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: bearer(owner.token) });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it('a project id that is not a UUID is not found (not a server error)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/projects/foo/overview', headers: bearer(owner.token) });
    expect(res.statusCode).toBe(404);
  });
});

describe('password change and reset', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    await setSettings(ctx.app, owner.token, { signupOpen: true });
    maria = (await signup(ctx.app, 'maria', 'maria-password')).json();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  async function issueReset(uid: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${uid}/password-reset`,
      headers: { ...bearer(owner.token), host: 'ce.example.org', 'x-forwarded-proto': 'https' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { resetUrl: string; expiresAt: number };
  }

  it('changes the password with the right current password only', async () => {
    const wrong = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/password',
      headers: bearer(maria.token),
      payload: { currentPassword: 'not-it', newPassword: 'new-password' },
    });
    expect(wrong.statusCode).toBe(401);
    const weak = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/password',
      headers: bearer(maria.token),
      payload: { currentPassword: 'maria-password', newPassword: 'short' },
    });
    expect(weak.json().error).toBe('weak_password');
    const ok = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/password',
      headers: bearer(maria.token),
      payload: { currentPassword: 'maria-password', newPassword: 'new-password' },
    });
    expect(ok.statusCode).toBe(204);
    expect((await login(ctx.app, 'maria', 'maria-password')).statusCode).toBe(401);
    expect((await login(ctx.app, 'maria', 'new-password')).statusCode).toBe(200);
  });

  it('resets with a single-use link and revokes every session of the user', async () => {
    const { resetUrl, expiresAt } = await issueReset(maria.userId);
    expect(resetUrl).toMatch(/^https:\/\/ce\.example\.org\/reset\/.+/);
    expect(expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    const token = resetUrl.split('/reset/')[1];

    const weak = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'short' } });
    expect(weak.statusCode).toBe(400);
    // The page checks the link as it opens: usable, and the check does not use it.
    const check = () => ctx.app.inject({ method: 'GET', url: `/v1/auth/reset/${encodeURIComponent(token)}` });
    expect((await check()).statusCode).toBe(200);
    expect((await check()).json()).toEqual({ valid: true });

    const ok = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'reset-password' } });
    expect(ok.statusCode).toBe(204);
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(maria.token) });
    expect(me.statusCode).toBe(401);
    expect((await login(ctx.app, 'maria', 'reset-password')).statusCode).toBe(200);

    const reused = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'another-password' } });
    expect(reused.statusCode).toBe(410);
    // Used: the page says so as it opens.
    const used = await check();
    expect(used.statusCode).toBe(410);
    expect(used.json().error).toBe('invalid_reset_token');
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/auth/reset/garbage' })).statusCode).toBe(410);
    const unknown = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token: 'garbage', newPassword: 'another-password' } });
    expect(unknown.statusCode).toBe(410);
  });

  it('a reset or a password change cancels the other reset links of the user', async () => {
    const first = (await issueReset(maria.userId)).resetUrl.split('/reset/')[1];
    const second = (await issueReset(maria.userId)).resetUrl.split('/reset/')[1];
    const ok = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token: first, newPassword: 'reset-password' } });
    expect(ok.statusCode).toBe(204);
    const other = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token: second, newPassword: 'taken-over' } });
    expect(other.statusCode).toBe(410);

    const third = (await issueReset(maria.userId)).resetUrl.split('/reset/')[1];
    const session = (await login(ctx.app, 'maria', 'reset-password')).json().token as string;
    const change = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/password',
      headers: bearer(session),
      payload: { currentPassword: 'reset-password', newPassword: 'changed-password' },
    });
    expect(change.statusCode).toBe(204);
    const afterChange = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token: third, newPassword: 'taken-over' } });
    expect(afterChange.statusCode).toBe(410);
  });

  it('an expired reset link answers 410', async () => {
    const token = await ctx.store.createPasswordReset(maria.userId, Date.now() - 1000);
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/auth/reset/${token}` })).statusCode).toBe(410);
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'reset-password' } });
    expect(res.statusCode).toBe(410);
    expect((await login(ctx.app, 'maria', 'maria-password')).statusCode).toBe(200);
  });

  it('the admin endpoints require a platform admin', async () => {
    const urls: { method: 'GET' | 'PUT' | 'POST'; url: string; payload?: object }[] = [
      { method: 'GET', url: '/v1/admin/settings' },
      { method: 'PUT', url: '/v1/admin/settings', payload: { signupOpen: false } },
      { method: 'GET', url: '/v1/admin/users' },
      { method: 'POST', url: `/v1/admin/users/${owner.userId}/password-reset` },
    ];
    for (const c of urls) {
      const none = await ctx.app.inject({ method: c.method, url: c.url, payload: c.payload });
      expect(none.statusCode, `${c.method} ${c.url} anonymous`).toBe(401);
      const user = await ctx.app.inject({ method: c.method, url: c.url, headers: bearer(maria.token), payload: c.payload });
      expect(user.statusCode, `${c.method} ${c.url} as a normal user`).toBe(403);
    }
    // A project admin token is not a session either.
    const p = await createProject(ctx.app);
    const projectToken = await ctx.app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(p.adminToken) });
    expect(projectToken.statusCode).toBe(401);
  });

  it('lists users with project counts only, validates settings, 404s an unknown user', async () => {
    const created = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'P' } });
    expect(created.statusCode).toBe(201);
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(owner.token) });
    expect(res.json()).toEqual({
      users: [
        { userId: maria.userId, username: 'maria', isPlatformAdmin: false, projects: 0, coordinatedProjects: 0, disabledAt: null, disabledBy: null, twoFactor: false },
        { userId: owner.userId, username: 'owner', isPlatformAdmin: true, projects: 1, coordinatedProjects: 1, disabledAt: null, disabledBy: null, twoFactor: false },
      ],
    });

    const bad = await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { projectCreation: 'everyone' } });
    expect(bad.statusCode).toBe(400);
    const read = await ctx.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: bearer(owner.token) });
    expect(read.json()).toEqual({
      signupOpen: true,
      projectCreation: 'platform-admins',
      maxProjectsPerUser: 0,
      maxProjectStorageMb: 0,
      termsUrl: null,
      contactEmail: null,
      serverName: null,
      aiEnabled: false,
      aiReportsPerDay: 5,
      aiFollowUpsPerDay: 30,
      aiMonthlyTokens: 2_000_000,
      twoFactorForCoordinators: false,
      announcement: null,
      announcementUntil: null,
      aiConfigured: false,
    });

    for (const uid of ['00000000-0000-0000-0000-000000000000', 'not-a-uuid']) {
      const missing = await ctx.app.inject({ method: 'POST', url: `/v1/admin/users/${uid}/password-reset`, headers: bearer(owner.token) });
      expect(missing.statusCode).toBe(404);
    }
  });
});

describe('invites, overview and export', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Bolivia NFI');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('makes an invite with the project admin token (no user behind it)', async () => {
    const res = await invite(ctx.app, project.projectId, project.adminToken, { role: 'operator' });
    expect(res.statusCode, res.body).toBe(201);
    // The store refuses a maker who is not a user, as the database does.
    await expect(
      ctx.store.createInvite({ projectId: project.projectId, role: 'operator', maxUses: 1, expiresAt: null, createdBy: project.projectId }),
    ).rejects.toThrow();
  });

  it('derives the join link from the request when no base URL is configured: its Host, not X-Forwarded-Host unless trusted', async () => {
    const headers = { ...bearer(project.adminToken), host: 'ce-abc.a.run.app', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example.net' };
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${project.projectId}/invites`, headers, payload: {} });
    // Cloud Run's own address (the Host it routed by); the client's X-Forwarded-Host is ignored.
    expect(res.json().joinUrl).toBe(`https://ce-abc.a.run.app/join/${res.json().inviteToken}`);
    expect(res.json().joinPath).toBe(`/join/${res.json().inviteToken}`);

    // Behind a proxy that sets X-Forwarded-Host itself (TRUST_FORWARDED_HOST=true).
    const proxied = await makeContext({ trustForwardedHost: true });
    try {
      const p = await createProject(proxied.app);
      const r = await proxied.app.inject({
        method: 'POST',
        url: `/v1/projects/${p.projectId}/invites`,
        headers: { ...bearer(p.adminToken), host: 'internal:8080', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'ce.example.org' },
        payload: {},
      });
      expect(r.json().joinUrl).toBe(`https://ce.example.org/join/${r.json().inviteToken}`);
    } finally {
      await proxied.app.close();
    }

    const render = await makeContext({ renderExternalUrl: 'https://ce.onrender.com/' });
    try {
      const p = await createProject(render.app);
      const r = await invite(render.app, p.projectId, p.adminToken);
      expect(r.json().joinUrl).toBe(`https://ce.onrender.com/join/${r.json().inviteToken}`);
    } finally {
      await render.app.close();
    }

    const configured = await makeContext({ publicBaseUrl: 'https://ce.fao.org', renderExternalUrl: 'https://ce.onrender.com' });
    try {
      const p = await createProject(configured.app);
      const r = await invite(configured.app, p.projectId, p.adminToken);
      expect(r.json().joinUrl).toBe(`https://ce.fao.org/join/${r.json().inviteToken}`);
    } finally {
      await configured.app.close();
    }
  });

  it('lists open invites without their tokens and revokes them', async () => {
    const created = await invite(ctx.app, project.projectId, project.adminToken, { role: 'operator', maxUses: 5, expiresInDays: 3 });
    const inviteToken = created.json().inviteToken as string;
    const used = (await invite(ctx.app, project.projectId, project.adminToken, { maxUses: 1 })).json().inviteToken as string;
    expect((await register(ctx.app, 'juan', 'password12', used)).statusCode).toBe(201); // used up: not listed

    const list = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/invites`, headers: bearer(project.adminToken) });
    expect(list.statusCode).toBe(200);
    const invites = list.json().invites as Record<string, unknown>[];
    expect(invites).toHaveLength(1);
    expect(invites[0]).toEqual({
      id: expect.any(String),
      role: 'operator',
      maxUses: 5,
      usedCount: 0,
      expiresAt: expect.any(Number),
      createdAt: expect.any(Number),
      forUsername: null,
    });
    expect(JSON.stringify(invites)).not.toContain(inviteToken);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${project.projectId}/invites/${invites[0].id}`,
      headers: bearer(project.adminToken),
    });
    expect(del.statusCode).toBe(204);
    const again = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${project.projectId}/invites/${invites[0].id}`,
      headers: bearer(project.adminToken),
    });
    expect(again.statusCode).toBe(404);

    // Revoked: the preview says not valid, register answers like an invalid invite.
    const preview = await ctx.app.inject({ method: 'GET', url: `/v1/join/${inviteToken}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().valid).toBe(false);
    const reg = await register(ctx.app, 'maria', 'hunter2pw', inviteToken);
    expect(reg.statusCode).toBe(400);
    expect(reg.json().error).toBe('invalid_invite');
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/invites`, headers: bearer(project.adminToken) })).json().invites).toEqual([]);
  });

  it('an operator cannot list or revoke invites', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/invites`, headers: bearer(project.projectToken) });
    expect(res.statusCode).toBe(403);
  });

  it('renames the project', async () => {
    const bad = await ctx.app.inject({ method: 'PATCH', url: `/v1/projects/${project.projectId}`, headers: bearer(project.adminToken), payload: { name: '  ' } });
    expect(bad.statusCode).toBe(400);
    const ok = await ctx.app.inject({ method: 'PATCH', url: `/v1/projects/${project.projectId}`, headers: bearer(project.adminToken), payload: { name: ' Bolivia 2027 ' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ projectId: project.projectId, name: 'Bolivia 2027' });
    expect((await ctx.store.getProject(project.projectId))?.name).toBe('Bolivia 2027');
    const op = await ctx.app.inject({ method: 'PATCH', url: `/v1/projects/${project.projectId}`, headers: bearer(project.projectToken), payload: { name: 'x' } });
    expect(op.statusCode).toBe(403);
  });

  it('counts the setup steps and the records per operator (deleted excluded)', async () => {
    const empty = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/overview`, headers: bearer(project.adminToken) });
    expect(empty.json()).toEqual({
      name: 'Bolivia NFI',
      cep: null,
      members: 0,
      csvFiles: 0,
      plots: 0,
      records: { total: 0, submitted: 0, byOperator: [] },
      storage: { usedBytes: 0, limitBytes: null },
    });

    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' },
      payload: Buffer.from('PK12345'),
    });
    for (const [name, body] of [['a.csv', 'id,x\n1,2\n3,4\n'], ['b.csv', 'id,x\n5,6\n']]) {
      await ctx.app.inject({
        method: 'PUT',
        url: `/v1/projects/${project.projectId}/csv-files/${name}`,
        headers: { ...bearer(project.adminToken), 'content-type': 'text/csv' },
        payload: Buffer.from(body),
      });
    }
    const inv = (await invite(ctx.app, project.projectId, project.adminToken)).json().inviteToken as string;
    await register(ctx.app, 'maria', 'password12', inv);
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: 1000, activelySaved: true }),
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: 3000, activelySaved: false }),
      envelope({ recordKey: '3', operator: 'maria', modifiedOn: 9000, deleted: true, xml: null }),
      envelope({ recordKey: '1', operator: 'juan', modifiedOn: 2000, activelySaved: true }),
    ]);

    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/overview`, headers: bearer(project.adminToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cep).toEqual({ bytes: 7, updatedAt: expect.any(Number) });
    expect(body).toMatchObject({ members: 1, csvFiles: 2, plots: 3 });
    expect(body.records).toEqual({
      total: 3,
      submitted: 2,
      byOperator: [
        { operator: 'juan', total: 1, submitted: 1, lastModifiedOn: 2000 },
        { operator: 'maria', total: 2, submitted: 1, lastModifiedOn: 3000 },
      ],
    });
  });

  it('exports the records as an Excel-friendly CSV', async () => {
    await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ recordKey: '2', operator: 'maria', modifiedOn: Date.UTC(2026, 9, 1), summary: { land_use: 'forest, dense', notes: 'said "hi"' } }),
      envelope({ recordKey: '1', operator: 'maria', modifiedOn: Date.UTC(2026, 9, 2), activelySaved: false, summary: { elevation: '1200', notes: 'línea 1\nlínea 2' } }),
      envelope({ recordKey: '3', operator: 'maria', modifiedOn: 5000, deleted: true, xml: null, summary: { ghost: 'x' } }),
    ]);
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/export.csv`, headers: bearer(project.adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Bolivia_NFI-data\.csv"/);
    expect(res.rawPayload.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);

    const text = res.rawPayload.subarray(3).toString('utf8');
    expect(text).toBe(
      [
        'record_key,plot,round,assessment,final,reference,operator,actively_saved,modified_on,elevation,land_use,notes',
        '1,1,1,main,,,maria,false,2026-10-02T00:00:00.000Z,1200,,"línea 1\nlínea 2"',
        '2,2,1,main,,,maria,true,2026-10-01T00:00:00.000Z,,"forest, dense","said ""hi"""',
        '',
      ].join('\r\n'),
    );
  });

  it('an operator cannot export or read the overview', async () => {
    for (const url of [`/v1/projects/${project.projectId}/export.csv`, `/v1/projects/${project.projectId}/overview`]) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: bearer(project.projectToken) });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

describe('desktop client contract', () => {
  it('/v1/auth/register still accepts a 1-character username, but a password of 8 characters only', async () => {
    const ctx = await makeContext();
    try {
      const project = await createProject(ctx.app);
      const token = (await invite(ctx.app, project.projectId, project.adminToken)).json().inviteToken as string;
      // the dashboard's password rule (security review, 2026-11), said with its reason, which Collect Earth shows
      const weak = await register(ctx.app, 'a', 'b', token);
      expect(weak.statusCode).toBe(400);
      expect(weak.json()).toMatchObject({ error: 'weak_password', reason: 'password must be at least 8 characters' });
      const res = await register(ctx.app, 'a', 'b-password', token);
      expect(res.statusCode).toBe(201);
      expect((await login(ctx.app, 'a', 'b-password')).statusCode).toBe(200);
    } finally {
      await ctx.app.close();
    }
  });
});

describe('rate limiting', () => {
  it('answers 429 rate_limited after 10 login attempts per minute from one IP', async () => {
    const ctx = await makeContext({ rateLimitPerMinute: 10 });
    try {
      // A different username each time, so the per-account failure limit stays out of the way
      let n = 0;
      const attempt = (ip: string) =>
        ctx.app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: ip, payload: { username: `x${n++}`, password: 'y' } });
      for (let i = 0; i < 10; i++) {
        expect((await attempt('10.0.0.1')).statusCode).toBe(401);
      }
      const limited = await attempt('10.0.0.1');
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error).toBe('rate_limited');
      // Another client, and another bucket for the same client, are unaffected.
      expect((await attempt('10.0.0.2')).statusCode).toBe(401);
      const setup = await ctx.app.inject({ method: 'POST', url: '/v1/setup', remoteAddress: '10.0.0.1', payload: {} });
      expect(setup.statusCode).toBe(403);
    } finally {
      await ctx.app.close();
    }
  });

  it('limits failed logins per account and IP, so others cannot lock the real user out', async () => {
    const ctx = await makeContext({ rateLimitPerMinute: 1000 });
    try {
      const owner = await setupPlatformAdmin(ctx.app);
      await setSettings(ctx.app, owner.token, { signupOpen: true });
      expect((await signup(ctx.app, 'maria', 'maria-password')).statusCode).toBe(201);
      const attempt = (ip: string, username: string, password = 'wrong') =>
        ctx.app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: ip, payload: { username, password } });
      for (let i = 0; i < 10; i++) {
        expect((await attempt('10.0.1.1', 'Maria')).statusCode).toBe(401);
      }
      // Blocked from that IP, even with the right password...
      expect((await attempt('10.0.1.1', 'maria', 'maria-password')).statusCode).toBe(429);
      expect((await attempt('10.0.1.1', 'jose')).statusCode).toBe(401);
      // ...but Maria herself, from elsewhere, still logs in.
      expect((await attempt('10.0.2.1', 'maria', 'maria-password')).statusCode).toBe(200);
    } finally {
      await ctx.app.close();
    }
  });

  it('uses x-forwarded-for as the client IP (behind a proxy)', async () => {
    const ctx = await makeContext({ rateLimitPerMinute: 1 });
    try {
      const attempt = (ip: string) =>
        ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', headers: { 'x-forwarded-for': ip }, payload: {} });
      expect((await attempt('203.0.113.1')).statusCode).toBe(403);
      expect((await attempt('203.0.113.1')).statusCode).toBe(429);
      expect((await attempt('203.0.113.2')).statusCode).toBe(403);
    } finally {
      await ctx.app.close();
    }
  });

  it('ignores the addresses a client writes into x-forwarded-for itself', async () => {
    const ctx = await makeContext({ rateLimitPerMinute: 1 });
    try {
      // The proxy appends the real client (203.0.113.1) after whatever the client sent.
      const attempt = (spoofed: string) =>
        ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', headers: { 'x-forwarded-for': `${spoofed}, 203.0.113.1` }, payload: {} });
      expect((await attempt('198.51.100.1')).statusCode).toBe(403);
      expect((await attempt('198.51.100.2')).statusCode).toBe(429);
    } finally {
      await ctx.app.close();
    }
  });
});

describe('dashboard static files', () => {
  let dir: string;
  let ctx: TestContext;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ce-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>CE</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    ctx = await makeContext({}, { webDir: dir });
  });
  afterEach(async () => {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const html = { accept: 'text/html,application/xhtml+xml' };

  it('serves index.html at / and the assets', async () => {
    const root = await ctx.app.inject({ method: 'GET', url: '/', headers: html });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('<title>CE</title>');
    const asset = await ctx.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe('console.log(1)');
  });

  it('keeps the hashed assets for good and sends the gzipped copy the build wrote to browsers that take it', async () => {
    const big = 'const analysis = 1;\n'.repeat(2000);
    writeFileSync(join(dir, 'assets', 'big.js'), big);
    writeFileSync(join(dir, 'assets', 'big.js.gz'), gzipSync(big));
    const gz = await ctx.app.inject({ method: 'GET', url: '/assets/big.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gz.statusCode).toBe(200);
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe(big);
    expect(gz.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const plain = await ctx.app.inject({ method: 'GET', url: '/assets/big.js' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe(big);
    // the page itself is asked for again each time (it names the assets of the latest build)
    const root = await ctx.app.inject({ method: 'GET', url: '/', headers: html });
    expect(root.headers['cache-control']).not.toContain('immutable');
  });

  it('returns index.html for client-side routes that accept HTML', async () => {
    for (const url of ['/join/abc123', '/setup', '/reset/xyz', '/projects/p1/people?tab=2']) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: html });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('<title>CE</title>');
    }
  });

  it("a progress link's page (/p/<token>): not indexed, no referrer, not cached", async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/p/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ', headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>CE</title>');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    // Other pages keep their own headers.
    expect((await ctx.app.inject({ method: 'GET', url: '/join/abc', headers: html })).headers['x-robots-tag']).toBeUndefined();
  });

  it("a mail's links (/unsubscribe/<token>, /confirm-email/<token>, Task 19): the same headers", async () => {
    for (const url of ['/unsubscribe/payload.sig', '/confirm-email/payload.sig']) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: html });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('<title>CE</title>');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('keeps JSON 404s for the API, non-HTML requests and other methods', async () => {
    const api = await ctx.app.inject({ method: 'GET', url: '/v1/nope', headers: html });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'not_found' });
    const json = await ctx.app.inject({ method: 'GET', url: '/join/abc', headers: { accept: 'application/json' } });
    expect(json.statusCode).toBe(404);
    const post = await ctx.app.inject({ method: 'POST', url: '/join/abc', headers: html, payload: {} });
    expect(post.statusCode).toBe(404);
    const health = await ctx.app.inject({ method: 'GET', url: '/health', headers: html });
    expect(health.json()).toEqual({ status: 'ok' });
  });

  it('without a built dashboard the server still starts and answers JSON 404', async () => {
    const bare = await makeContext({}, { webDir: join(dir, 'missing') });
    try {
      const res = await bare.app.inject({ method: 'GET', url: '/join/abc', headers: html });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    } finally {
      await bare.app.close();
    }
  });
});
