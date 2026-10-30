// Every project has its token rows from creation until deletion: PostgresStore's
// eachProject (the AI usage page) finds the projects through project_tokens, so a
// project created without one would be left out. Each way of creating a project goes
// through store.createProject, which makes both tokens.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectResult } from '../src/store/store.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe('project tokens', () => {
  let ctx: TestContext;
  afterEach(async () => {
    await ctx.app.close();
  });

  async function expectTokens(created: CreateProjectResult, projectId: string): Promise<void> {
    expect(created.projectId).toBe(projectId);
    expect(await ctx.store.resolveToken(created.adminToken)).toMatchObject({ projectId, role: 'admin' });
    expect(await ctx.store.resolveToken(created.projectToken)).toMatchObject({ projectId, role: 'operator' });
  }

  it('are made for a project created with the admin key, a session, or on a dev server', async () => {
    ctx = await makeContext({ adminApiKey: 'k'.repeat(32) });
    const spy = vi.spyOn(ctx.store, 'createProject');
    const byKey = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: { 'x-admin-key': 'k'.repeat(32) }, payload: { name: 'A' } });
    expect(byKey.statusCode).toBe(201);
    await expectTokens(await spy.mock.results[0].value, byKey.json().projectId);

    const owner = await setupPlatformAdmin(ctx.app);
    const bySession = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'B' } });
    expect(bySession.statusCode).toBe(201);
    // The tokens are not returned to a session, but they exist.
    expect(bySession.json().adminToken).toBeUndefined();
    await expectTokens(await spy.mock.results[1].value, bySession.json().projectId);
    await ctx.app.close();

    ctx = await makeContext();
    const devSpy = vi.spyOn(ctx.store, 'createProject');
    const anonymous = await ctx.app.inject({ method: 'POST', url: '/v1/projects', payload: { name: 'C' } });
    expect(anonymous.statusCode).toBe(201);
    await expectTokens(await devSpy.mock.results[0].value, anonymous.json().projectId);
  });

  it('are gone only with the project', async () => {
    ctx = await makeContext();
    const created = await ctx.store.createProject({ name: 'D' });
    await ctx.store.deleteProject(created.projectId);
    expect(await ctx.store.resolveToken(created.adminToken)).toBeNull();
    expect(await ctx.store.resolveToken(created.projectToken)).toBeNull();
  });
});
