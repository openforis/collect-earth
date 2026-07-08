import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProject, makeContext, type TestContext } from './helpers.js';

async function createInvite(
  app: FastifyInstance,
  pid: string,
  adminToken: string,
  role: string,
  maxUses = 1,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/projects/${pid}/invites`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { role, maxUses },
  });
  return res.json().inviteToken as string;
}

function register(app: FastifyInstance, username: string, password: string, inviteToken: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password, inviteToken } });
}

describe('accounts, invites and join', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Bolivia NFI');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('previews an invite before registration', async () => {
    const token = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator');
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/join/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ projectName: 'Bolivia NFI', role: 'operator', valid: true });
  });

  it('registers via invite, logs in, and sees its own membership', async () => {
    const token = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator');
    const reg = await register(ctx.app, 'maria', 'hunter2pw', token);
    expect(reg.statusCode).toBe(201);
    expect(reg.json()).toMatchObject({ role: 'operator', projectId: project.projectId });

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'maria', password: 'hunter2pw' },
    });
    expect(login.statusCode).toBe(200);
    const sessionToken = login.json().token as string;

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(me.json().memberships).toEqual([
      { projectId: project.projectId, projectName: 'Bolivia NFI', role: 'operator' },
    ]);

    // A session token grants access to its project's scoped routes.
    const ping = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(ping.statusCode).toBe(200);
  });

  it('a session token gets 404 for a project it is not a member of', async () => {
    const other = await createProject(ctx.app, 'Other');
    const token = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator');
    await register(ctx.app, 'maria', 'hunter2pw', token);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'maria', password: 'hunter2pw' },
    });
    const sessionToken = login.json().token as string;

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${other.projectId}`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects bad password, duplicate username, and exhausted / invalid invites', async () => {
    const token = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator', 1);
    expect((await register(ctx.app, 'maria', 'hunter2pw', token)).statusCode).toBe(201);

    // invite maxUses=1 now exhausted
    const token2 = token; // same single-use token
    expect((await register(ctx.app, 'juan', 'pw12345678', token2)).statusCode).toBe(410);

    // duplicate username (fresh invite)
    const fresh = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator');
    expect((await register(ctx.app, 'maria', 'whatever12', fresh)).statusCode).toBe(409);

    // invalid invite token
    expect((await register(ctx.app, 'pedro', 'pw12345678', 'garbage')).statusCode).toBe(400);

    // wrong password
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'maria', password: 'wrongpass' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('an operator cannot create invites (403)', async () => {
    const token = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator');
    const reg = await register(ctx.app, 'maria', 'hunter2pw', token);
    const sessionToken = reg.json().token as string;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${project.projectId}/invites`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { role: 'operator' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to remove the last admin', async () => {
    // Bootstrap a real admin user from the project admin token.
    const adminInvite = await createInvite(ctx.app, project.projectId, project.adminToken, 'admin');
    const reg = await register(ctx.app, 'boss', 'adminpw123', adminInvite);
    const bossId = reg.json().userId as string;
    const sessionToken = reg.json().token as string;

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${project.projectId}/members/${bossId}`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('last_admin');
  });

  it('stores and serves the CEP zip to members', async () => {
    const zip = Buffer.from('PK pretend zip');
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { authorization: `Bearer ${project.adminToken}`, 'content-type': 'application/zip' },
      payload: zip,
    });
    expect(put.statusCode).toBe(200);

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { authorization: `Bearer ${project.projectToken}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toContain('application/zip');
    expect(get.rawPayload.equals(zip)).toBe(true);
  });
});
