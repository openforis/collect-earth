import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, createProject, makeContext, type TestContext } from './helpers.js';

/**
 * The §4b.8 tenancy gate: authenticated as an admin of project A, every
 * project-scoped endpoint aimed at project B must return 404 — a non-member must
 * not even be able to confirm that project B exists. New endpoints do not merge
 * without a case here.
 */
describe('cross-tenant isolation', () => {
  let ctx: TestContext;
  let a: Awaited<ReturnType<typeof createProject>>;
  let b: Awaited<ReturnType<typeof createProject>>;

  beforeEach(async () => {
    ctx = await makeContext();
    a = await createProject(ctx.app, 'Project A');
    b = await createProject(ctx.app, 'Project B');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("A's admin token can read A", async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${a.projectId}`,
      headers: { authorization: `Bearer ${a.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectId).toBe(a.projectId);
  });

  it("A's admin token gets 404 (not 403) when reading B", async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${b.projectId}`,
      headers: { authorization: `Bearer ${a.adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("A's admin token gets 404 when uploading a survey to B", async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${b.projectId}/survey`,
      headers: { authorization: `Bearer ${a.adminToken}` },
      payload: { surveyUri: 'x', idmlBase64: 'eA==' },
    });
    expect(res.statusCode).toBe(404);
  });

  it("A's admin token gets 404 when posting records to B", async () => {
    const res = await batchRequest(ctx.app, b.projectId, a.adminToken, [{ recordKey: '1', surveyUri: 'x' }]);
    expect(res.statusCode).toBe(404);
    // and nothing was written into B
    expect(await ctx.store.listRecords(b.projectId)).toHaveLength(0);
  });

  // §4b.8 gate for the Phase-A project-scoped endpoints: A's admin must get 404
  // against B for every one of them.
  it("A's admin token gets 404 on every Phase-A endpoint aimed at B", async () => {
    const auth = { authorization: `Bearer ${a.adminToken}` };
    const cases = [
      { method: 'POST' as const, url: `/v1/projects/${b.projectId}/invites`, payload: { role: 'operator' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/cep` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/cep`, payload: Buffer.from('zip'),
        headers: { ...auth, 'content-type': 'application/zip' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/members` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/members/someone`, payload: { role: 'operator' } },
      { method: 'DELETE' as const, url: `/v1/projects/${b.projectId}/members/someone` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/csv-files` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/csv-files/x.csv`, payload: Buffer.from('id\n1\n'),
        headers: { ...auth, 'content-type': 'text/csv' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/csv-files/someid/content` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/assignments`, payload: { assignments: [] } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/assignments` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/my-assignment` },
    ];
    for (const c of cases) {
      const res = await ctx.app.inject({
        method: c.method,
        url: c.url,
        headers: c.headers ?? auth,
        payload: c.payload,
      });
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(404);
    }
  });

  it('an unknown token is 401, an absent token is 401', async () => {
    const bad = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${a.projectId}`,
      headers: { authorization: 'Bearer nonsense' },
    });
    expect(bad.statusCode).toBe(401);

    const none = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${a.projectId}` });
    expect(none.statusCode).toBe(401);
  });

  it('an operator token cannot upload a survey (403 within its own project)', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${a.projectId}/survey`,
      headers: { authorization: `Bearer ${a.projectToken}` },
      payload: { surveyUri: 'x', idmlBase64: 'eA==' },
    });
    expect(res.statusCode).toBe(403);
  });
});
