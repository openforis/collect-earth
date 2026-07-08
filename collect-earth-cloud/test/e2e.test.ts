import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/store/memory.js';

/**
 * End-to-end acceptance test over a REAL TCP socket (not fastify.inject), driving
 * the exact HTTP sequence the Java CloudApiClient performs in Phase 0:
 * provision -> upload survey (idml) -> gzipped records:batch -> re-send idempotency
 * -> deletion tombstone. This exercises the gunzip content-encoding path over a
 * genuine connection, which inject() bypasses.
 */
describe('Phase 0 end-to-end over HTTP', () => {
  let app: FastifyInstance;
  let store: InMemoryStore;
  let baseUrl: string;
  let projectId: string;
  let projectToken: string;
  let adminToken: string;

  beforeAll(async () => {
    store = new InMemoryStore();
    app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'memory' } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    await store.close();
  });

  async function postBatch(records: unknown[]): Promise<Response> {
    const body = gzipSync(Buffer.from(JSON.stringify({ records })));
    return fetch(`${baseUrl}/v1/projects/${projectId}/records:batch`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${projectToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body,
    });
  }

  it('provisions a project', async () => {
    const res = await fetch(`${baseUrl}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'E2E project' }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { projectId: string; projectToken: string; adminToken: string };
    projectId = json.projectId;
    projectToken = json.projectToken;
    adminToken = json.adminToken;
    expect(projectId).toBeTruthy();
  });

  it('accepts the survey definition (idml)', async () => {
    const res = await fetch(`${baseUrl}/v1/projects/${projectId}/survey`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        surveyUri: 'http://www.openforis.org/idm/collectearth',
        surveyName: 'e2e',
        idmlBase64: Buffer.from('<survey/>').toString('base64'),
      }),
    });
    expect(res.status).toBe(200);
  });

  it('uploads a gzipped records batch over the socket and stores it', async () => {
    const res = await postBatch([
      {
        recordKey: '10,20',
        surveyUri: 'http://www.openforis.org/idm/collectearth',
        operator: 'maria',
        modifiedOn: 1000,
        activelySaved: true,
        step: 1,
        xml: '<record id="10,20"/>',
        summary: { id: '10,20' },
        deleted: false,
        payloadVersion: 1,
      },
    ]);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: { status: string }[] };
    expect(json.results[0].status).toBe('stored');
    expect(await store.listRecords(projectId)).toHaveLength(1);
  });

  it('is idempotent on re-send (same modifiedOn) and rejects a stale older one', async () => {
    const same = await postBatch([
      { recordKey: '10,20', surveyUri: 'x', operator: 'maria', modifiedOn: 1000, activelySaved: true,
        step: 1, xml: '<record/>', summary: {}, deleted: false, payloadVersion: 1 },
    ]);
    expect(((await same.json()) as { results: { status: string }[] }).results[0].status).toBe('stored');

    const older = await postBatch([
      { recordKey: '10,20', surveyUri: 'x', operator: 'maria', modifiedOn: 500, activelySaved: true,
        step: 1, xml: '<old/>', summary: {}, deleted: false, payloadVersion: 1 },
    ]);
    expect(((await older.json()) as { results: { status: string }[] }).results[0].status).toBe('stale');
  });

  it('applies a deletion tombstone (soft delete)', async () => {
    const res = await postBatch([
      { recordKey: '10,20', surveyUri: 'x', operator: 'maria', modifiedOn: 5000, activelySaved: false,
        step: 1, xml: null, summary: {}, deleted: true, payloadVersion: 1 },
    ]);
    expect(((await res.json()) as { results: { status: string }[] }).results[0].status).toBe('stored');
    expect(await store.listRecords(projectId)).toHaveLength(0); // excluded by default
    expect(await store.listRecords(projectId, true)).toHaveLength(1); // still present, soft-deleted
  });
});
