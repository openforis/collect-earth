import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';

describe('compressed answers', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createProject>>;
  const csv = ['id,lat,lon', ...Array.from({ length: 400 }, (_, i) => `${i + 1},${(i / 100).toFixed(4)},${(i / 50).toFixed(4)}`)].join('\n');

  beforeEach(async () => {
    ctx = await makeContext();
    project = await createProject(ctx.app, 'Compressed');
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/cep`, headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() });
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('gzips a large JSON or CSV answer for a client that asks, the same bytes once decompressed', async () => {
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${project.projectId}/csv-files/plots.csv`, headers: { ...bearer(project.adminToken), 'content-type': 'text/csv' }, payload: csv });
    const file = `/v1/projects/${project.projectId}/csv-files/${up.json().id}/content`;
    const plain = await ctx.app.inject({ method: 'GET', url: file, headers: bearer(project.adminToken) });
    const zipped = await ctx.app.inject({ method: 'GET', url: file, headers: { ...bearer(project.adminToken), 'accept-encoding': 'gzip, deflate' } });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers.vary).toMatch(/Accept-Encoding/);
    expect(zipped.rawPayload.length).toBeLessThan(plain.rawPayload.length / 2);
    expect(gunzipSync(zipped.rawPayload).equals(plain.rawPayload)).toBe(true);
    // The checksum Collect Earth checks is the file's, whichever way it travels
    expect(plain.headers['x-checksum-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(zipped.headers['x-checksum-sha256']).toBe(plain.headers['x-checksum-sha256']);

    const people = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/csv-files`, headers: { ...bearer(project.adminToken), 'accept-encoding': 'gzip' } });
    expect(people.statusCode).toBe(200);
  });

  it('leaves small answers, zips and clients that do not ask as they are', async () => {
    const small = await ctx.app.inject({ method: 'GET', url: '/health', headers: { 'accept-encoding': 'gzip' } });
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(small.json()).toEqual({ status: 'ok' });
    const cep = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/cep`, headers: { ...bearer(project.adminToken), 'accept-encoding': 'gzip' } });
    expect(cep.statusCode).toBe(200);
    expect(cep.headers['content-encoding']).toBeUndefined();
  });
});
