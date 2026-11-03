import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../src/config.js';
import { buildServer, type BuildServerOptions } from '../src/server.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { CreateProjectResult } from '../src/store/store.js';
import type { RecordEnvelope } from '../src/types.js';

export interface TestContext {
  app: FastifyInstance;
  store: InMemoryStore;
}

export const TEST_SETUP_CODE = 'TEST-CODE-1234';

/**
 * In-memory server for a test. The rate limiter is off (0) and the dashboard is
 * not served unless a test asks for it, so neither makes other tests flaky.
 */
export async function makeContext(
  overrides: Partial<Config> = {},
  options: {
    webDir?: string | null;
    ai?: BuildServerOptions['ai'];
    mailer?: BuildServerOptions['mailer'];
    logger?: BuildServerOptions['logger'];
    mailLimits?: BuildServerOptions['mailLimits'];
    oidcKeys?: BuildServerOptions['oidcKeys'];
  } = {},
): Promise<TestContext> {
  const store = new InMemoryStore();
  const config: Config = {
    port: 0,
    host: '127.0.0.1',
    storeBackend: 'memory',
    setupCode: TEST_SETUP_CODE,
    rateLimitPerMinute: 0,
    // The figures are brought up to date at once, so a test does not wait 30 s for them.
    qualityMinIntervalMs: 0,
    // Pages always see the records just sent.
    stateStaleMs: 0,
    ...overrides,
  };
  const app = await buildServer({
    store,
    config,
    webDir: options.webDir ?? null,
    ...(options.ai ? { ai: options.ai } : {}),
    ...(options.mailer ? { mailer: options.mailer } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.mailLimits ? { mailLimits: options.mailLimits } : {}),
    ...(options.oidcKeys ? { oidcKeys: options.oidcKeys } : {}),
  });
  return { app, store };
}

/** Runs first-run setup and returns the platform admin's session. */
export async function setupPlatformAdmin(
  app: FastifyInstance,
  username = 'owner',
  password = 'owner-password',
): Promise<{ token: string; userId: string; username: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/setup',
    payload: { setupCode: TEST_SETUP_CODE, username, password },
  });
  if (res.statusCode !== 201) {
    throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  }
  return res.json();
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
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
