import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { InMemoryStore } from '../src/store/memory.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

function signup(app: FastifyInstance, username: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username, password: `${username}-password` } });
}

function login(app: FastifyInstance, username: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password: `${username}-password` } });
}

function deleteProject(app: FastifyInstance, pid: string, token: string, confirmName?: unknown) {
  return app.inject({ method: 'DELETE', url: `/v1/projects/${pid}`, headers: bearer(token), payload: { confirmName } });
}

function deleteMe(app: FastifyInstance, token: string, password: unknown) {
  return app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(token), payload: { password } });
}

async function invite(app: FastifyInstance, pid: string, token: string, role = 'operator') {
  const res = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(token), payload: { role, maxUses: 5 } });
  expect(res.statusCode).toBe(201);
  return res.json().inviteToken as string;
}

function register(app: FastifyInstance, username: string, inviteToken: string) {
  return app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: `${username}-password`, inviteToken } });
}

type Session = { token: string; userId: string };

describe('deleting a project', () => {
  let ctx: TestContext;
  let owner: Session;
  let coord: Session;
  let pid: string;
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/settings',
      headers: bearer(owner.token),
      payload: { signupOpen: true, projectCreation: 'anyone' },
    });
    coord = (await signup(ctx.app, 'coord')).json();
    const created = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coord.token), payload: { name: 'Bolivia NFI' } });
    pid = created.json().projectId;
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('refuses a wrong or missing name with 400 confirm_mismatch and keeps everything', async () => {
    for (const name of [undefined, '', 'bolivia nfi', 'Other', 42]) {
      const res = await deleteProject(ctx.app, pid, coord.token, name);
      expect(res.statusCode, String(name)).toBe(400);
      expect(res.json().error).toBe('confirm_mismatch');
    }
    expect(await ctx.store.getProject(pid)).not.toBeNull();
  });

  it('is for coordinators only: a collector gets 403, a stranger and the platform admin 404', async () => {
    const collector = (await register(ctx.app, 'juan', await invite(ctx.app, pid, coord.token))).json();
    expect((await deleteProject(ctx.app, pid, collector.token, 'Bolivia NFI')).statusCode).toBe(403);
    const stranger = (await signup(ctx.app, 'stranger')).json();
    expect((await deleteProject(ctx.app, pid, stranger.token, 'Bolivia NFI')).statusCode).toBe(404);
    expect((await deleteProject(ctx.app, pid, owner.token, 'Bolivia NFI')).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/v1/projects/${pid}`, payload: { confirmName: 'Bolivia NFI' } })).statusCode).toBe(401);
    expect(await ctx.store.getProject(pid)).not.toBeNull();
  });

  it('deletes the project and all its data; its links, tokens and members no longer work', async () => {
    const collector = (await register(ctx.app, 'juan', await invite(ctx.app, pid, coord.token))).json();
    const openInvite = await invite(ctx.app, pid, coord.token);
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/cep`,
      headers: { ...bearer(coord.token), 'content-type': 'application/zip' },
      payload: Buffer.from('zipzip'),
    });
    const csv = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/plots.csv`,
      headers: { ...bearer(coord.token), 'content-type': 'text/csv' },
      payload: Buffer.from('id,lat,lon\n1,0,0\n'),
    });
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/assignments`,
      headers: bearer(coord.token),
      payload: { assignments: [{ userId: collector.userId, csvFileId: csv.json().id }] },
    });
    expect((await batchRequest(ctx.app, pid, collector.token, [envelope()])).statusCode).toBe(200);

    const res = await deleteProject(ctx.app, pid, coord.token, ' Bolivia NFI ');
    expect(res.statusCode).toBe(204);

    expect(await ctx.store.getProject(pid)).toBeNull();
    expect(await ctx.store.listRecords(pid, true)).toEqual([]);
    expect(await ctx.store.getCep(pid)).toBeNull();
    expect(await ctx.store.listCsvFiles(pid)).toEqual([]);
    expect(await ctx.store.listMembers(pid)).toEqual([]);
    expect(await ctx.store.listInvites(pid, Date.now())).toEqual([]);
    expect(await ctx.store.getProjectStorage(pid)).toEqual({ cepBytes: 0, csvBytesByFilename: {}, recordBytes: 0 });

    // The people are still there, but the project is gone for them.
    for (const s of [coord, collector]) {
      const mine = await ctx.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(s.token) });
      expect(mine.json().projects).toEqual([]);
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}`, headers: bearer(s.token) })).statusCode).toBe(404);
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/cep`, headers: bearer(s.token) })).statusCode).toBe(404);
    }
    expect((await batchRequest(ctx.app, pid, collector.token, [envelope()])).statusCode).toBe(404);

    // The invite link is dead.
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/join/${openInvite}` })).statusCode).toBe(404);
    const reg = await register(ctx.app, 'late', openInvite);
    expect(reg.statusCode).toBe(400);
    expect(reg.json().error).toBe('invalid_invite');
  });

  it('kills the Phase-0 project tokens', async () => {
    const p = await createProject(ctx.app, 'Phase zero');
    expect((await deleteProject(ctx.app, p.projectId, p.adminToken, 'Phase zero')).statusCode).toBe(204);
    for (const token of [p.adminToken, p.projectToken]) {
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}`, headers: bearer(token) });
      expect(res.statusCode).toBe(401);
      expect((await batchRequest(ctx.app, p.projectId, token, [envelope()])).statusCode).toBe(401);
    }
  });

  it('leaves other projects alone', async () => {
    const other = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coord.token), payload: { name: 'Peru' } });
    const otherId = other.json().projectId as string;
    await batchRequest(ctx.app, otherId, coord.token, [envelope()]);
    expect((await deleteProject(ctx.app, pid, coord.token, 'Bolivia NFI')).statusCode).toBe(204);
    expect(await ctx.store.getProject(otherId)).not.toBeNull();
    expect(await ctx.store.listRecords(otherId)).toHaveLength(1);
    expect(await ctx.store.getMembership(otherId, coord.userId)).toEqual({ projectId: otherId, role: 'admin' });
  });
});

describe('deleting my account', () => {
  let ctx: TestContext;
  let owner: Session;
  let coord: Session;
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/settings',
      headers: bearer(owner.token),
      payload: { signupOpen: true, projectCreation: 'anyone' },
    });
    coord = (await signup(ctx.app, 'coord')).json();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  async function project(token: string, name: string): Promise<string> {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(token), payload: { name } });
    expect(res.statusCode).toBe(201);
    return res.json().projectId as string;
  }

  function preview(token: string) {
    return ctx.app.inject({ method: 'GET', url: '/v1/me/deletion', headers: bearer(token) });
  }

  it('needs a session and the right password', async () => {
    expect((await ctx.app.inject({ method: 'DELETE', url: '/v1/me', payload: { password: 'x' } })).statusCode).toBe(401);
    for (const password of [undefined, '', 'wrong-password']) {
      const res = await deleteMe(ctx.app, coord.token, password);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('invalid_credentials');
    }
    expect(await ctx.store.getUserById(coord.userId)).not.toBeNull();
  });

  it('refuses the last platform admin with 409 last_platform_admin', async () => {
    expect((await preview(owner.token)).json()).toEqual({ soleCoordinator: [], deletedWithAccount: [], lastPlatformAdmin: true });
    const res = await deleteMe(ctx.app, owner.token, 'owner-password');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('last_platform_admin');
    expect(await ctx.store.getUserById(owner.userId)).not.toBeNull();
  });

  it('refuses the only coordinator of a project with other people, listing those projects', async () => {
    const pid = await project(coord.token, 'Bolivia NFI');
    const juan = (await register(ctx.app, 'juan', await invite(ctx.app, pid, coord.token))).json();
    expect((await preview(coord.token)).json()).toEqual({
      soleCoordinator: [{ projectId: pid, name: 'Bolivia NFI' }],
      deletedWithAccount: [],
      lastPlatformAdmin: false,
    });
    const res = await deleteMe(ctx.app, coord.token, 'coord-password');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'sole_coordinator', projects: [{ projectId: pid, name: 'Bolivia NFI' }] });
    expect(await ctx.store.getUserById(coord.userId)).not.toBeNull();

    // Handing the project over (a second coordinator) lets the account go; the
    // project, its people and the records stay.
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/members/${juan.userId}`, headers: bearer(coord.token), payload: { role: 'admin' } });
    await batchRequest(ctx.app, pid, coord.token, [envelope({ operator: 'coord' })]);
    expect((await deleteMe(ctx.app, coord.token, 'coord-password')).statusCode).toBe(204);
    expect(await ctx.store.getProject(pid)).not.toBeNull();
    expect(await ctx.store.listMembers(pid)).toEqual([{ userId: juan.userId, username: 'juan', role: 'admin', disabled: false }]);
    expect((await ctx.store.listRecords(pid)).map((r) => r.operator)).toEqual(['coord']);
  });

  it('deletes projects where I am the only member with the account; leaves the others', async () => {
    const alone = await project(coord.token, 'Just me');
    const theirs = await project(owner.token, 'Owner project');
    // A collector in someone else's project: leaving does not touch it.
    await ctx.store.addMembership(theirs, coord.userId, 'operator');
    expect((await preview(coord.token)).json()).toEqual({
      soleCoordinator: [],
      deletedWithAccount: [{ projectId: alone, name: 'Just me' }],
      lastPlatformAdmin: false,
    });

    const res = await deleteMe(ctx.app, coord.token, 'coord-password');
    expect(res.statusCode).toBe(204);
    expect(await ctx.store.getProject(alone)).toBeNull();
    expect(await ctx.store.getProject(theirs)).not.toBeNull();
    expect(await ctx.store.getMembership(theirs, coord.userId)).toBeNull();

    // The account is gone: sessions die, login fails, the name is free again.
    expect(await ctx.store.getUserById(coord.userId)).toBeNull();
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(coord.token) })).statusCode).toBe(401);
    expect((await login(ctx.app, 'coord')).statusCode).toBe(401);
    expect((await signup(ctx.app, 'coord')).statusCode).toBe(201);
  });

  it("removes a collector's assignments but keeps their records", async () => {
    const pid = await project(coord.token, 'Bolivia NFI');
    const juan = (await register(ctx.app, 'juan', await invite(ctx.app, pid, coord.token))).json();
    const csv = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/csv-files/plots.csv`,
      headers: { ...bearer(coord.token), 'content-type': 'text/csv' },
      payload: Buffer.from('id,lat,lon\n1,0,0\n'),
    });
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${pid}/assignments`,
      headers: bearer(coord.token),
      payload: { assignments: [{ userId: juan.userId, csvFileId: csv.json().id }] },
    });
    await batchRequest(ctx.app, pid, juan.token, [envelope({ operator: 'juan' })]);

    expect((await deleteMe(ctx.app, juan.token, 'juan-password')).statusCode).toBe(204);
    expect(await ctx.store.listAssignments(pid)).toEqual([]);
    expect(await ctx.store.listRecords(pid)).toHaveLength(1);
    expect(await ctx.store.listMembers(pid)).toEqual([{ userId: coord.userId, username: 'coord', role: 'admin', disabled: false }]);
    // Their records keep the name, so it is not given out again: a new juan would see
    // the old one's quality figures as his.
    const again = await signup(ctx.app, 'juan');
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('username_taken');
  });
});

describe('the memory store: two platform admins disabling each other at once', () => {
  it('one is disabled, the other is refused as the last platform admin (counted and written with no await between)', async () => {
    const store = new InMemoryStore();
    const a = (await store.createFirstPlatformAdmin({ username: 'a', passwordHash: 'x' }))!;
    const b = await store.createUser({ username: 'b', passwordHash: 'x', email: null });
    b.isPlatformAdmin = true;
    const results = await Promise.all([store.disableUser(a.id, b.id), store.disableUser(b.id, a.id)]);
    expect(results.sort()).toEqual(['last_platform_admin', 'ok']);
    expect([a, b].filter((u) => u.disabledAt === null)).toHaveLength(1);
  });
});
