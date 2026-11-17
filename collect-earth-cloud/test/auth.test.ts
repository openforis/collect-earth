import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProject, makeContext, type TestContext, zipOfSize } from './helpers.js';

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
      { projectId: project.projectId, projectName: 'Bolivia NFI', role: 'operator', status: 'active' },
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

  it('someone with an account takes an invitation by logging in with it: the project joins theirs', async () => {
    const first = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator');
    expect((await register(ctx.app, 'maria', 'maria-password', first)).statusCode).toBe(201);
    const other = await createProject(ctx.app, 'Mexico Review');
    const login = (inviteToken: string, password = 'maria-password') =>
      ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maria', password, inviteToken } });

    // a wrong password says nothing of the link, and adds nothing
    const invite = await createInvite(ctx.app, other.projectId, other.adminToken, 'reviewer', 2);
    expect((await login(invite, 'wrong-password')).json()).toEqual({ error: 'invalid_credentials' });
    expect((await login('no-such-link')).json()).toEqual({ error: 'invalid_invite' });

    const res = await login(invite);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: 'maria', projectId: other.projectId, projectName: 'Mexico Review', role: 'reviewer' });
    const cep = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${other.projectId}/my-assignment`, headers: { authorization: `Bearer ${res.json().token}` } });
    expect(cep.statusCode).toBe(200);
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${res.json().token}` } });
    expect(me.json().memberships.map((m: { projectId: string; role: string }) => [m.projectId, m.role]).sort()).toEqual(
      [[project.projectId, 'operator'], [other.projectId, 'reviewer']].sort(),
    );

    // again, a member already: nothing used up, the role kept (a coordinator's link to bring a member the project file)
    const own = await createInvite(ctx.app, project.projectId, project.adminToken, 'admin', 1);
    expect((await login(own)).json()).toMatchObject({ projectId: project.projectId, role: 'operator' });
    expect((await login(own)).statusCode).toBe(200);
    // used up: refused, as register refuses
    const once = await createInvite(ctx.app, other.projectId, other.adminToken, 'operator', 1);
    expect((await register(ctx.app, 'juan', 'juan-password', once)).statusCode).toBe(201);
    const third = await createProject(ctx.app, 'Nepal');
    const gone = await createInvite(ctx.app, third.projectId, third.adminToken, 'operator', 1);
    expect((await register(ctx.app, 'ana', 'ana-password', gone)).statusCode).toBe(201);
    expect((await login(gone)).json()).toEqual({ error: 'invite_exhausted' });
  });

  it('someone signed in already takes an invitation with that session (/v1/auth/join), with no password', async () => {
    const first = await createInvite(ctx.app, project.projectId, project.adminToken, 'operator');
    const session = (await register(ctx.app, 'maria', 'maria-password', first)).json().token as string;
    const other = await createProject(ctx.app, 'Mexico Review');
    const join = (inviteToken: unknown, token: string | null = session) =>
      ctx.app.inject({ method: 'POST', url: '/v1/auth/join', headers: token ? { authorization: `Bearer ${token}` } : {}, payload: { inviteToken } });

    const invite = await createInvite(ctx.app, other.projectId, other.adminToken, 'reviewer', 1);
    // no session, an unknown one, or a project token: refused, and the link is not used
    expect((await join(invite, null)).statusCode).toBe(401);
    expect((await join(invite, 'not-a-session')).statusCode).toBe(401);
    expect((await join(invite, other.adminToken)).statusCode).toBe(401);
    expect((await join(undefined)).statusCode).toBe(400);
    expect((await join('no-such-link')).json()).toEqual({ error: 'invalid_invite' });

    // the session's account joins, whatever username a body might carry
    const res = await join(invite);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projectId: other.projectId, projectName: 'Mexico Review', role: 'reviewer' });
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${session}` } });
    expect(me.json().memberships.map((m: { projectId: string; role: string }) => [m.projectId, m.role]).sort()).toEqual(
      [[project.projectId, 'operator'], [other.projectId, 'reviewer']].sort(),
    );
    // a member already: the role kept and the link not used up again
    expect((await join(invite)).json()).toMatchObject({ projectId: other.projectId, role: 'reviewer' });

    // used up, revoked or expired: refused as login refuses
    const once = await createInvite(ctx.app, other.projectId, other.adminToken, 'operator', 1);
    expect((await register(ctx.app, 'juan', 'juan-password', once)).statusCode).toBe(201);
    const third = await createProject(ctx.app, 'Nepal');
    const gone = await createInvite(ctx.app, third.projectId, third.adminToken, 'operator', 1);
    expect((await register(ctx.app, 'ana', 'ana-password', gone)).statusCode).toBe(201);
    expect((await join(gone)).json()).toEqual({ error: 'invite_exhausted' });
    const admin = { authorization: `Bearer ${third.adminToken}` };
    const revoked = await createInvite(ctx.app, third.projectId, third.adminToken, 'operator', 5);
    const open = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${third.projectId}/invites`, headers: admin })).json().invites as { id: string; maxUses: number }[];
    await ctx.app.inject({ method: 'DELETE', url: `/v1/projects/${third.projectId}/invites/${open.find((i) => i.maxUses === 5)!.id}`, headers: admin });
    expect((await join(revoked)).json()).toEqual({ error: 'invalid_invite' });
    const expiring = (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${third.projectId}/invites`, headers: admin, payload: { role: 'operator', expiresInDays: 1 } })).json().inviteToken as string;
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 2 * 24 * 3_600_000;
      expect((await join(expiring)).json()).toEqual({ error: 'invite_exhausted' });
      // long unused, the session is gone: 401, and Collect Earth asks for the password again
      Date.now = () => realNow() + 400 * 24 * 3_600_000;
      expect((await join(expiring)).statusCode).toBe(401);
    } finally {
      Date.now = realNow;
    }

    // signed out: the session no longer joins
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: `Bearer ${session}` } });
    expect((await join(await createInvite(ctx.app, third.projectId, third.adminToken, 'operator'))).statusCode).toBe(401);
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
    const zip = zipOfSize(200);
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

    // what is no zip is no project file: refused, and the one stored stays
    const junk = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { authorization: `Bearer ${project.adminToken}`, 'content-type': 'application/zip' },
      payload: Buffer.from('PK\x03\x04 pretend zip'),
    });
    expect(junk.statusCode).toBe(422);
    expect(junk.json().error).toBe('not_a_project_file');
  });
});
