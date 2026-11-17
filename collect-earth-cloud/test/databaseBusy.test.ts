import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DatabaseBusyError } from '../src/store/busy.js';
import { idOnlyCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

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

  it('waits 10 s for a connection by default; PG_CONNECT_TIMEOUT_MS=0 waits for ever', () => {
    expect(loadConfig({}).dbConnectTimeoutMs).toBe(10_000);
    expect(loadConfig({ PG_CONNECT_TIMEOUT_MS: '2500' }).dbConnectTimeoutMs).toBe(2500);
    expect(loadConfig({ PG_CONNECT_TIMEOUT_MS: '0' }).dbConnectTimeoutMs).toBe(0);
    expect(loadConfig({ PG_STATEMENT_TIMEOUT_MS: '30000' }).dbStatementTimeoutMs).toBe(30_000);
  });
});
