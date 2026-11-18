import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DatabaseBusyError } from '../src/store/busy.js';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';

// cloud.collectearth.org, 17 Nov 2026: a pool held by slow queries kept every request that needs the database
// waiting until the load stopped. A request now waits a bounded time and is answered 503 busy; and the project file,
// which every Collect Earth reads at its start, is read from the database once, not once per person.

describe('a busy database', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => ctx.app.close());

  it('answers 503 busy with Retry-After when no connection of the pool comes free in time', async () => {
    const p = await createProject(ctx.app, 'Busy');
    // as pg-pool says it, and as the store says it
    for (const failure of [new Error('timeout exceeded when trying to connect'), new DatabaseBusyError()]) {
      vi.spyOn(ctx.store, 'getProject').mockRejectedValueOnce(failure);
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}`, headers: bearer(p.adminToken) });
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('15');
      expect(res.json()).toMatchObject({ error: 'busy' });
    }
    // any other failure as before
    vi.spyOn(ctx.store, 'getProject').mockRejectedValueOnce(new Error('something else'));
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}`, headers: bearer(p.adminToken) })).statusCode).toBe(500);
  });

  it('reads the project file from the database once for many downloads, again once it changed', async () => {
    const p = await createProject(ctx.app, 'Rush');
    const upload = () => ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() });
    expect((await upload()).statusCode).toBeLessThan(300);
    const reads = vi.spyOn(ctx.store, 'getCep');
    const download = () => ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep`, headers: bearer(p.adminToken) });
    const first = await download();
    for (let i = 0; i < 5; i++) expect((await download()).rawPayload.equals(first.rawPayload)).toBe(true);
    expect(reads.mock.calls.filter(([pid]) => pid === p.projectId)).toHaveLength(1);
    expect((await upload()).statusCode).toBeLessThan(300);
    await download();
    expect(reads.mock.calls.filter(([pid]) => pid === p.projectId)).toHaveLength(2);
  });

  it('keeps a project file of megabytes built too (the IPCC demo survey, 8.6 MB): the database read once per project', async () => {
    const p = await createProject(ctx.app, 'Big survey');
    const big = readFileSync('../collect-earth/collect-earth-app/resources/demo_survey.cep');
    expect(big.length).toBeGreaterThan(8 * 1024 * 1024);
    expect((await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: big })).statusCode).toBeLessThan(300);
    const invite = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/invites`, headers: bearer(p.adminToken), payload: { role: 'operator', maxUses: 1 } });
    const collector = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: invite.json().inviteToken } })).json().token;
    const reads = vi.spyOn(ctx.store, 'getCep');
    const forCollector = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep`, headers: bearer(collector) });
    const forCoordinator = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep`, headers: bearer(p.adminToken) });
    for (let i = 0; i < 5; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep`, headers: bearer(collector) })).rawPayload.equals(forCollector.rawPayload)).toBe(true);
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep`, headers: bearer(p.adminToken) })).rawPayload.equals(forCoordinator.rawPayload)).toBe(true);
    }
    // once for each copy: the collectors' and the coordinators'
    expect(reads.mock.calls.filter(([pid]) => pid === p.projectId)).toHaveLength(2);
  });

  it('reads it once when many people join at the same moment, before the first read is done', async () => {
    const p = await createProject(ctx.app, 'Rush at nine');
    expect((await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() })).statusCode).toBeLessThan(300);
    const reads = vi.spyOn(ctx.store, 'getCep');
    const at = await Promise.all(Array.from({ length: 20 }, () => ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep`, headers: bearer(p.adminToken) })));
    expect(at.every((r) => r.statusCode === 200 && r.rawPayload.equals(at[0].rawPayload))).toBe(true);
    // 20 before: each read the file while the first was still reading it
    expect(reads.mock.calls.filter(([pid]) => pid === p.projectId)).toHaveLength(1);
  });

  it('reads each survey once when the coordinators of many mapathons follow their training in turn', async () => {
    // cloud.collectearth.org, 18 Nov 2026: 10 mapathons' training pages, polled in turn, missed an 8-project cache
    // of the survey outline at every visit, each miss reading the whole project file.
    const projects: Awaited<ReturnType<typeof createProject>>[] = [];
    for (let i = 0; i < 12; i++) {
      const p = await createProject(ctx.app, `Mapathon ${i}`);
      expect((await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() })).statusCode).toBeLessThan(300);
      projects.push(p);
    }
    const reads = vi.spyOn(ctx.store, 'getCep');
    const round = () => Promise.all(projects.flatMap((p) => [1, 2, 3].map(() => ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/training`, headers: bearer(p.adminToken) }))));
    for (const res of await round()) expect(res.statusCode).toBe(200);
    const first = reads.mock.calls.length;
    for (const p of projects) expect(reads.mock.calls.filter(([pid]) => pid === p.projectId).length).toBeLessThanOrEqual(2);
    for (let i = 0; i < 3; i++) await round();
    expect(reads.mock.calls.length).toBe(first);
    }, 60_000);

  it('waits 10 s for a connection by default; PG_CONNECT_TIMEOUT_MS=0 waits for ever', () => {
    expect(loadConfig({}).dbConnectTimeoutMs).toBe(10_000);
    expect(loadConfig({ PG_CONNECT_TIMEOUT_MS: '2500' }).dbConnectTimeoutMs).toBe(2500);
    expect(loadConfig({ PG_CONNECT_TIMEOUT_MS: '0' }).dbConnectTimeoutMs).toBe(0);
    expect(loadConfig({ PG_STATEMENT_TIMEOUT_MS: '30000' }).dbStatementTimeoutMs).toBe(30_000);
  });
});

describe('sync batches taken at once', () => {
  it('answers 503 busy to a batch beyond the limit before reading it, and takes batches again once one is done', async () => {
    const ctx = await makeContext({ recordsBatchConcurrency: 1 });
    try {
      const p = await createProject(ctx.app, 'Burst');
      // The first batch is held while it is written
      let letGo!: () => void;
      const held = new Promise<void>((resolve) => { letGo = resolve; });
      const status = ctx.store.getProjectStatus.bind(ctx.store);
      const spy = vi.spyOn(ctx.store, 'getProjectStatus').mockImplementationOnce(async (pid) => { await held; return status(pid); });
      const first = batchRequest(ctx.app, p.projectId, p.projectToken, [envelope({ recordKey: '1,1' })]);
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      const refused = await batchRequest(ctx.app, p.projectId, p.projectToken, [envelope({ recordKey: '2,1' })]);
      expect(refused.statusCode).toBe(503);
      expect(refused.headers['retry-after']).toBe('10');
      expect(refused.json()).toMatchObject({ error: 'busy' });
      letGo();
      expect((await first).statusCode).toBe(200);
      // its slot is free again
      expect((await batchRequest(ctx.app, p.projectId, p.projectToken, [envelope({ recordKey: '2,1' })])).statusCode).toBe(200);
      expect(loadConfig({ RECORDS_BATCH_CONCURRENCY: '0' }).recordsBatchConcurrency).toBe(0);
    } finally {
      await ctx.app.close();
    }
  });
});
