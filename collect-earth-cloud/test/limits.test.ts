import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const MB = 1024 * 1024;

function signup(app: FastifyInstance, username: string, body: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username, password: `${username}-password`, ...body } });
}

function putSettings(app: FastifyInstance, token: string, settings: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(token), payload: settings });
}

async function setSettings(app: FastifyInstance, token: string, settings: Record<string, unknown>) {
  const res = await putSettings(app, token, settings);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

function newProject(app: FastifyInstance, token: string, name: string) {
  return app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(token), payload: { name } });
}

function putCep(app: FastifyInstance, pid: string, token: string, bytes: number) {
  return app.inject({
    method: 'PUT',
    url: `/v1/projects/${pid}/cep`,
    headers: { ...bearer(token), 'content-type': 'application/zip' },
    payload: Buffer.alloc(bytes, 1),
  });
}

function putCsv(app: FastifyInstance, pid: string, token: string, filename: string, bytes: number) {
  const header = 'id,lat,lon\n';
  return app.inject({
    method: 'PUT',
    url: `/v1/projects/${pid}/csv-files/${filename}`,
    headers: { ...bearer(token), 'content-type': 'text/csv' },
    payload: Buffer.from(header + 'x'.repeat(Math.max(0, bytes - header.length))),
  });
}

async function overview(app: FastifyInstance, pid: string, token: string) {
  const res = await app.inject({ method: 'GET', url: `/v1/projects/${pid}/overview`, headers: bearer(token) });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('server settings: limits, terms, contact, name', () => {
  let ctx: TestContext;
  let owner: { token: string };
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('validates every new setting', async () => {
    const bad: Record<string, unknown>[] = [
      { maxProjectsPerUser: -1 },
      { maxProjectsPerUser: 1.5 },
      { maxProjectsPerUser: '3' },
      { maxProjectStorageMb: -5 },
      { maxProjectStorageMb: null },
      { termsUrl: 'javascript:alert(1)' },
      { termsUrl: 'ftp://example.org/terms' },
      { termsUrl: 'not a url' },
      { contactEmail: 'nobody' },
      { contactEmail: 42 },
      { serverName: 'x'.repeat(501) },
    ];
    for (const payload of bad) {
      const res = await putSettings(ctx.app, owner.token, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error).toBe('bad_request');
    }
    // Nothing changed.
    const read = await ctx.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: bearer(owner.token) });
    expect(read.json()).toMatchObject({ maxProjectsPerUser: 0, maxProjectStorageMb: 0, termsUrl: null });
  });

  it('stores good values, clears text with an empty value, and shows terms/contact/name in server-info', async () => {
    const saved = await setSettings(ctx.app, owner.token, {
      maxProjectsPerUser: 3,
      maxProjectStorageMb: 200,
      termsUrl: 'https://example.org/terms',
      contactEmail: ' help@example.org ',
      serverName: 'FAO Collect Earth',
    });
    expect(saved).toMatchObject({
      maxProjectsPerUser: 3,
      maxProjectStorageMb: 200,
      termsUrl: 'https://example.org/terms',
      contactEmail: 'help@example.org',
      serverName: 'FAO Collect Earth',
    });
    const info = await ctx.app.inject({ method: 'GET', url: '/v1/server-info' });
    expect(info.json()).toMatchObject({
      termsUrl: 'https://example.org/terms',
      contactEmail: 'help@example.org',
      serverName: 'FAO Collect Earth',
    });

    const cleared = await setSettings(ctx.app, owner.token, { termsUrl: '', contactEmail: null, serverName: '  ' });
    expect(cleared).toMatchObject({ termsUrl: null, contactEmail: null, serverName: null, maxProjectsPerUser: 3 });
    const info2 = await ctx.app.inject({ method: 'GET', url: '/v1/server-info' });
    expect(info2.json()).toMatchObject({ termsUrl: null, contactEmail: null, serverName: null });
  });
});

describe('terms of use at sign-up', () => {
  let ctx: TestContext;
  let owner: { token: string };
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    await setSettings(ctx.app, owner.token, { signupOpen: true });
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('needs no acceptance while there are no terms', async () => {
    const res = await signup(ctx.app, 'maria');
    expect(res.statusCode).toBe(201);
    expect((await ctx.store.getUserByUsername('maria'))?.termsAcceptedAt).toBeNull();
  });

  it('refuses sign-up without acceptTerms: true when terms are set, and records the acceptance', async () => {
    await setSettings(ctx.app, owner.token, { termsUrl: 'https://example.org/terms' });
    for (const body of [{}, { acceptTerms: false }, { acceptTerms: 'yes' }]) {
      const res = await signup(ctx.app, 'maria', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error).toBe('terms_not_accepted');
    }
    expect(await ctx.store.getUserByUsername('maria')).toBeNull();

    const before = Date.now();
    const ok = await signup(ctx.app, 'maria', { acceptTerms: true });
    expect(ok.statusCode).toBe(201);
    expect((await ctx.store.getUserByUsername('maria'))?.termsAcceptedAt).toBeGreaterThanOrEqual(before);
  });

  it('does not change invite registration (the desktop client)', async () => {
    await setSettings(ctx.app, owner.token, { termsUrl: 'https://example.org/terms' });
    const p = await createProject(ctx.app);
    const inv = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/invites`, headers: bearer(p.adminToken), payload: {} });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username: 'juan', password: 'pw', inviteToken: inv.json().inviteToken },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('projects per account', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  let maria: { token: string; userId: string };
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    await setSettings(ctx.app, owner.token, { signupOpen: true, projectCreation: 'anyone', maxProjectsPerUser: 2 });
    maria = (await signup(ctx.app, 'maria')).json();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('refuses one project over the limit with 403 project_limit_reached and the limit', async () => {
    expect((await newProject(ctx.app, maria.token, 'One')).statusCode).toBe(201);
    expect((await newProject(ctx.app, maria.token, 'Two')).statusCode).toBe(201);
    const third = await newProject(ctx.app, maria.token, 'Three');
    expect(third.statusCode).toBe(403);
    expect(third.json()).toMatchObject({ error: 'project_limit_reached', limit: 2 });

    // 0 = no limit.
    await setSettings(ctx.app, owner.token, { maxProjectsPerUser: 0 });
    expect((await newProject(ctx.app, maria.token, 'Three')).statusCode).toBe(201);
  });

  it('counts only projects the user coordinates, and exempts platform admins', async () => {
    // Maria is a collector in someone else's project: that does not count.
    const other = await createProject(ctx.app, 'Other');
    await ctx.store.addMembership(other.projectId, maria.userId, 'operator');
    expect((await newProject(ctx.app, maria.token, 'One')).statusCode).toBe(201);
    expect((await newProject(ctx.app, maria.token, 'Two')).statusCode).toBe(201);
    expect((await newProject(ctx.app, maria.token, 'Three')).statusCode).toBe(403);

    for (const name of ['A', 'B', 'C']) {
      expect((await newProject(ctx.app, owner.token, name)).statusCode).toBe(201);
    }

    const users = await ctx.app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(owner.token) });
    const byName = Object.fromEntries(users.json().users.map((u: { username: string }) => [u.username, u]));
    expect(byName.maria).toMatchObject({ projects: 3, coordinatedProjects: 2 });
    expect(byName.owner).toMatchObject({ projects: 3, coordinatedProjects: 3 });
  });
});

describe('storage per project', () => {
  let ctx: TestContext;
  let owner: { token: string };
  let project: Awaited<ReturnType<typeof createProject>>;
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    project = await createProject(ctx.app, 'Storage');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('counts CEP, plot files and records (xml + summary) in the overview', async () => {
    await putCep(ctx.app, project.projectId, project.adminToken, 1000);
    await putCsv(ctx.app, project.projectId, project.adminToken, 'a.csv', 500);
    const env = envelope({ xml: '<record>abc</record>', summary: { id: '1' } });
    await batchRequest(ctx.app, project.projectId, project.projectToken, [env]);
    const expectedRecord = Buffer.byteLength(env.xml!) + Buffer.byteLength(JSON.stringify(env.summary));
    const body = await overview(ctx.app, project.projectId, project.adminToken);
    expect(body.storage).toEqual({ usedBytes: 1000 + 500 + expectedRecord, limitBytes: null });

    await setSettings(ctx.app, owner.token, { maxProjectStorageMb: 200 });
    expect((await overview(ctx.app, project.projectId, project.adminToken)).storage.limitBytes).toBe(200 * MB);
  });

  it('refuses coordinator uploads that would go over with 413 storage_limit_reached', async () => {
    await setSettings(ctx.app, owner.token, { maxProjectStorageMb: 1 });
    expect((await putCep(ctx.app, project.projectId, project.adminToken, 600 * 1024)).statusCode).toBe(200);

    const csv = await putCsv(ctx.app, project.projectId, project.adminToken, 'big.csv', 500 * 1024);
    expect(csv.statusCode).toBe(413);
    expect(csv.json()).toEqual({ error: 'storage_limit_reached', usedBytes: 600 * 1024, limitBytes: MB });
    expect(await ctx.store.listCsvFiles(project.projectId)).toHaveLength(0);

    // A new CEP replaces the old one: only the difference counts.
    expect((await putCep(ctx.app, project.projectId, project.adminToken, 900 * 1024)).statusCode).toBe(200);
    const tooBigCep = await putCep(ctx.app, project.projectId, project.adminToken, MB + 1);
    expect(tooBigCep.statusCode).toBe(413);
    expect(tooBigCep.json().error).toBe('storage_limit_reached');

    // Same for a plot file replaced by name.
    expect((await putCsv(ctx.app, project.projectId, project.adminToken, 'a.csv', 100 * 1024)).statusCode).toBe(201);
    expect((await putCsv(ctx.app, project.projectId, project.adminToken, 'a.csv', 120 * 1024)).statusCode).toBe(201);
    expect((await putCsv(ctx.app, project.projectId, project.adminToken, 'b.csv', 100 * 1024)).statusCode).toBe(413);
  });

  it("never refuses collectors' records; the overview shows the project is over", async () => {
    await setSettings(ctx.app, owner.token, { maxProjectStorageMb: 1 });
    await putCep(ctx.app, project.projectId, project.adminToken, MB - 10);
    const big = 'y'.repeat(200 * 1024);
    const res = await batchRequest(ctx.app, project.projectId, project.projectToken, [
      envelope({ recordKey: '1', xml: big }),
      envelope({ recordKey: '2', xml: big }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['stored', 'stored']);
    const { storage } = await overview(ctx.app, project.projectId, project.adminToken);
    expect(storage.limitBytes).toBe(MB);
    expect(storage.usedBytes).toBeGreaterThan(MB);
  });
});
