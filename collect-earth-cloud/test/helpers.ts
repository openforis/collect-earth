import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { CreateProjectResult } from '../src/store/store.js';
import type { RecordEnvelope } from '../src/types.js';

export interface TestContext {
  app: FastifyInstance;
  store: InMemoryStore;
}

export async function makeContext(): Promise<TestContext> {
  const store = new InMemoryStore();
  const app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'memory' } });
  return { app, store };
}

export async function createProject(app: FastifyInstance, name = 'Test project'): Promise<CreateProjectResult> {
  const res = await app.inject({ method: 'POST', url: '/v1/projects', payload: { name } });
  return res.json() as CreateProjectResult;
}

/** Posts a gzipped records:batch exactly the way the Java client does. */
export function batchRequest(app: FastifyInstance, pid: string, token: string, envelopes: Partial<RecordEnvelope>[]) {
  const body = gzipSync(Buffer.from(JSON.stringify({ records: envelopes }), 'utf8'));
  return app.inject({
    method: 'POST',
    url: `/v1/projects/${pid}/records:batch`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    },
    payload: body,
  });
}

export function envelope(overrides: Partial<RecordEnvelope> = {}): RecordEnvelope {
  return {
    recordKey: '1',
    surveyUri: 'http://example.org/survey',
    operator: 'maria',
    modifiedOn: 1000,
    activelySaved: true,
    step: 1,
    xml: '<record/>',
    summary: { key1: '1' },
    deleted: false,
    payloadVersion: 1,
    ...overrides,
  };
}
