import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProject, makeContext, type TestContext } from './helpers.js';

async function createInvite(app: FastifyInstance, pid: string, adminToken: string, role: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/projects/${pid}/invites`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { role, maxUses: 5 },
  });
  return res.json().inviteToken as string;
}

async function registerUser(
  app: FastifyInstance,
  pid: string,
  adminToken: string,
  role: string,
  username: string,
): Promise<{ userId: string; token: string }> {
  const invite = await createInvite(app, pid, adminToken, role);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { username, password: 'password12', inviteToken: invite },
  });
  return { userId: res.json().userId as string, token: res.json().token as string };
}

function uploadCsv(app: FastifyInstance, pid: string, adminToken: string, filename: string, content: string) {
  return app.inject({
    method: 'PUT',
    url: `/v1/projects/${pid}/csv-files/${filename}`,
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'text/csv' },
    payload: content,
  });
}

describe('CSV files and assignments', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Assignment project');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('uploads a CSV and reports checksum + plot count', async () => {
    const res = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'plots_a.csv',
      'id,lat,lon\n1,0,0\n2,1,1\n3,2,2\n');
    expect(res.statusCode).toBe(201);
    expect(res.json().filename).toBe('plots_a.csv');
    expect(res.json().plotCount).toBe(3);
    expect(res.json().checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assigns a CSV to an operator who then sees it in my-assignment and can download it', async () => {
    const maria = await registerUser(ctx.app, project.projectId, project.adminToken, 'operator', 'maria');
    const csv = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'north.csv', 'id,lat,lon\n1,0,0\n');
    const csvFileId = csv.json().id as string;

    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/assignments`,
      headers: { authorization: `Bearer ${project.adminToken}` },
      payload: { assignments: [{ userId: maria.userId, csvFileId }] },
    });
    expect(put.json()).toEqual({ ok: true, count: 1 });

    const mine = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/my-assignment`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(mine.json().assignments).toHaveLength(1);
    expect(mine.json().assignments[0]).toMatchObject({ csvFileId, filename: 'north.csv' });

    const download = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files/${csvFileId}/content`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['x-checksum-sha256']).toBe(csv.json().checksum);
    expect(download.body).toContain('id,lat,lon');
  });

  it('rejects a CSV upload with a path-traversal filename', async () => {
    // Some malicious names are rejected by the handler (400), others are collapsed by
    // URL normalisation before routing (404). Either way the security property holds:
    // the upload never succeeds, so no traversal filename is ever stored.
    for (const bad of ['..', '%2e%2e', 'a..b', 'x%2Fy', 'evil%00.csv']) {
      const res = await ctx.app.inject({
        method: 'PUT',
        url: `/v1/projects/${project.projectId}/csv-files/${bad}`,
        headers: { authorization: `Bearer ${project.adminToken}`, 'content-type': 'text/csv' },
        payload: 'id\n1\n',
      });
      expect([400, 404], bad).toContain(res.statusCode);
    }
    // handler-reachable case is specifically a 400
    const direct = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/csv-files/a..b`,
      headers: { authorization: `Bearer ${project.adminToken}`, 'content-type': 'text/csv' },
      payload: 'id\n1\n',
    });
    expect(direct.statusCode).toBe(400);
    // and nothing traversal-named got stored
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files`,
      headers: { authorization: `Bearer ${project.adminToken}` },
    });
    expect(list.json().csvFiles).toHaveLength(0);
  });

  it('an operator cannot download a CSV that is not assigned to them (404)', async () => {
    const maria = await registerUser(ctx.app, project.projectId, project.adminToken, 'operator', 'maria');
    const csv = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'secret.csv', 'id,lat,lon\n1,0,0\n');
    const csvFileId = csv.json().id as string;
    // no assignment made
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files/${csvFileId}/content`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('re-uploading a CSV by the same filename keeps one entry and updates the checksum', async () => {
    await uploadCsv(ctx.app, project.projectId, project.adminToken, 'plots.csv', 'id\n1\n');
    const second = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'plots.csv', 'id\n1\n2\n');
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/csv-files`,
      headers: { authorization: `Bearer ${project.adminToken}` },
    });
    expect(list.json().csvFiles).toHaveLength(1);
    expect(list.json().csvFiles[0].checksum).toBe(second.json().checksum);
    expect(list.json().csvFiles[0].plotCount).toBe(2);
  });

  it('replacing the assignment set removes prior assignments', async () => {
    const maria = await registerUser(ctx.app, project.projectId, project.adminToken, 'operator', 'maria');
    const a = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'a.csv', 'id\n1\n');
    const b = await uploadCsv(ctx.app, project.projectId, project.adminToken, 'b.csv', 'id\n1\n');

    const assign = (csvFileId: string) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/v1/projects/${project.projectId}/assignments`,
        headers: { authorization: `Bearer ${project.adminToken}` },
        payload: { assignments: [{ userId: maria.userId, csvFileId }] },
      });

    await assign(a.json().id);
    await assign(b.json().id); // replaces a with b
    const mine = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${project.projectId}/my-assignment`,
      headers: { authorization: `Bearer ${maria.token}` },
    });
    expect(mine.json().assignments).toHaveLength(1);
    expect(mine.json().assignments[0].filename).toBe('b.csv');
  });
});
