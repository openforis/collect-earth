import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe('project lifecycle: draft, active, closed, archived', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  const setStatus = (status: unknown, token = project.adminToken) =>
    ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/status`, headers: bearer(token), payload: { status } });
  const sync = () => batchRequest(ctx.app, project.projectId, project.projectToken, [envelope()]);

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Lifecycle');
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('starts active and says so on the ping', async () => {
    const ping = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}`, headers: bearer(project.projectToken) });
    expect(ping.json()).toMatchObject({ status: 'active' });
  });

  it('closes, reopens, archives and restores; refuses the other moves', async () => {
    expect((await setStatus('draft')).json()).toMatchObject({ error: 'bad_transition' });
    expect((await setStatus('archived')).statusCode).toBe(409);
    expect((await setStatus('closed')).json()).toEqual({ projectId: project.projectId, status: 'closed' });
    expect((await setStatus('active')).statusCode).toBe(200);
    await setStatus('closed');
    expect((await setStatus('archived')).statusCode).toBe(200);
    expect((await setStatus('active')).statusCode).toBe(409);
    expect((await setStatus('closed')).statusCode).toBe(200);
    expect((await setStatus('nonsense')).statusCode).toBe(400);
  });

  it('lets only coordinators change it, and logs each change', async () => {
    expect((await setStatus('closed', project.projectToken)).statusCode).toBe(403);
    await setStatus('closed');
    const log = await ctx.store.listAudit(project.projectId, { limit: 10 });
    expect(log[0]).toMatchObject({ action: 'settings.changed', details: { setting: 'status', from: 'active', status: 'closed' } });
  });

  it('a closed project refuses syncs and changes, and still serves reading and exports', async () => {
    expect((await sync()).statusCode).toBe(200);
    await setStatus('closed');
    const refused = await sync();
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'project_closed' });
    expect(typeof refused.json().reason).toBe('string');
    // A dashboard change (rename) is refused too.
    const rename = await ctx.app.inject({ method: 'PATCH', url: `/v1/projects/${project.projectId}`, headers: bearer(project.adminToken), payload: { name: 'x' } });
    expect(rename.json()).toMatchObject({ error: 'project_closed' });
    // Reading and the export work.
    const exported = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/export.csv`, headers: bearer(project.adminToken) });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain('maria');
    // Archived is as read-only; a reopened project syncs again.
    await setStatus('archived');
    expect((await sync()).json()).toMatchObject({ error: 'project_closed' });
    await setStatus('closed');
    await setStatus('active');
    expect((await sync()).statusCode).toBe(200);
  });

  it('a draft project refuses syncs until it is made active', async () => {
    await ctx.store.setProjectStatus(project.projectId, 'draft');
    const refused = await sync();
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'project_draft' });
    // The coordinator still sets it up.
    const rename = await ctx.app.inject({ method: 'PATCH', url: `/v1/projects/${project.projectId}`, headers: bearer(project.adminToken), payload: { name: 'Ready' } });
    expect(rename.statusCode).toBe(200);
    expect((await setStatus('active')).statusCode).toBe(200);
    expect((await sync()).statusCode).toBe(200);
  });

  it('lists each project with its status', async () => {
    const owner = await setupPlatformAdmin(ctx.app);
    const mine = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Mine' } });
    const pid = mine.json().projectId;
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/status`, headers: bearer(owner.token), payload: { status: 'closed' } });
    const list = await ctx.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(owner.token) });
    expect(list.json().projects).toEqual([{ projectId: pid, projectName: 'Mine', role: 'admin', status: 'closed' }]);
  });
});
