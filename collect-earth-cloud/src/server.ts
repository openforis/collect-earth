import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { generateSetupCode } from './accountRules.js';
import { ActivityRecorder, registerActivity } from './activity.js';
import type { AiClient } from './ai/client.js';
import { createFakeClient } from './ai/fake.js';
import { createGeminiClient } from './ai/gemini.js';
import { AiRunService, type AiRunServiceOptions } from './ai/service.js';
import { DEFAULT_AI_MODEL, type Config } from './config.js';
import { QualityService, QualityWorker } from './qualityService.js';
import { RateLimiter } from './rateLimit.js';
import type { Store } from './store/store.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAssignmentRoutes } from './routes/assignments.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerQualityRoutes } from './routes/quality.js';
import { registerRecordRoutes } from './routes/records.js';

export interface BuildServerOptions {
  store: Store;
  config: Config;
  logger?: boolean;
  /**
   * Directory of the built dashboard (index.html + assets) served at `/`.
   * Defaults to `web/dist` of this package; null disables static serving. A
   * directory that does not exist is skipped (API-only server).
   */
  webDir?: string | null;
  /** For tests: the AI assistant's client (null = none) instead of the configured one, and the clock of its limits. */
  ai?: { client?: AiClient | null; now?: () => number; runs?: Partial<AiRunServiceOptions> };
}

/** How long the development fake (AI_FAKE=1) waits before each answer, so the panel's progress shows. */
const FAKE_AI_DELAY_MS = 700;

/** The AI client of this server: the development fake, Gemini on Vertex AI, or none. */
function aiClientOf(config: Config): AiClient | null {
  if (config.aiFake) {
    return createFakeClient({ delayMs: FAKE_AI_DELAY_MS });
  }
  return createGeminiClient(config) ?? null;
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WEB_DIR = join(PACKAGE_ROOT, 'web', 'dist');
const VERSION = readVersion();
// Per client IP. A training room joins from one office IP, so this is generous;
// password guessing is held back per account by LOGIN_FAILURES_PER_MINUTE instead.
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const LOGIN_FAILURES_PER_MINUTE = 10;

/**
 * Builds the Fastify app around a Store. Kept free of process/network side effects
 * so tests can drive it with fastify.inject() and an in-memory store.
 */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { store, config } = options;
  const app = Fastify({
    logger: options.logger ?? false,
    // Record XML batches are small KBs each but a project sync can carry 50; allow headroom.
    bodyLimit: 32 * 1024 * 1024,
    // A plot id is a path parameter of the quality decisions (up to 1000 characters,
    // up to 9000 once URL-encoded as three-byte UTF-8); Fastify's default stops at 100.
    // find-my-way measures the decoded parameter, so this leaves room either way.
    maxParamLength: 9000,
    // Behind Cloud Run / Caddy: take the client IP (rate limiting) and the public
    // proto/host (derived join and reset links) from x-forwarded-*. Only the hops our
    // own proxies add are trusted; `true` would let a client pick its IP.
    trustProxy: config.trustProxyHops ?? 1,
  });

  // The Java client gzips the records:batch body (Content-Encoding: gzip). Fastify
  // does not decompress request bodies by default, so swap in a gunzip stream
  // before the JSON parser runs. Other requests pass through untouched.
  app.addHook('preParsing', async (request, _reply, payload) => {
    const encoding = request.headers['content-encoding'];
    if (encoding && encoding.toLowerCase() === 'gzip') {
      // Decompressed length differs from Content-Length; drop both headers so the
      // body parser reads the inflated stream to EOF instead of rejecting a size
      // mismatch (Fastify returns 400 before the route's preHandler otherwise).
      delete request.headers['content-encoding'];
      delete request.headers['content-length'];
      return payload.pipe(createGunzip());
    }
    return payload;
  });

  // CEP uploads are raw zip bodies; buffer them so route handlers receive
  // request.body as a Buffer.
  const bufferBody = (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void): void =>
    done(null, body);
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, bufferBody);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, bufferBody);
  app.addContentTypeParser('text/csv', { parseAs: 'buffer' }, bufferBody);

  app.get('/health', async () => ({ status: 'ok' }));

  const limiter = new RateLimiter(config.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE);
  const loginFailures = new RateLimiter(config.rateLimitPerMinute === 0 ? 0 : LOGIN_FAILURES_PER_MINUTE);
  const setupCode = config.setupCode ?? generateSetupCode();

  // Members' activity (member_activity), coalesced; written when the app closes too.
  registerActivity(app, new ActivityRecorder(store, { onError: (err) => app.log.error({ err }, 'member activity write failed') }));

  await registerAuthRoutes(app, store, limiter, loginFailures);
  const now = options.ai?.now ?? Date.now;
  await registerAdminRoutes(app, store, config, limiter, { setupCode, version: VERSION, now });
  await registerProjectRoutes(app, store, config);
  await registerPlatformRoutes(app, store, config);
  await registerAssignmentRoutes(app, store, config);
  const quality = new QualityService(store, new QualityWorker({ maxOldGenerationSizeMb: config.qualityWorkerMaxMb }), {
    minIntervalMs: config.qualityMinIntervalMs,
  });
  await registerQualityRoutes(app, store, quality);
  await registerProgressRoutes(app, store, quality, now);
  await registerRecordRoutes(app, store);
  const runs = new AiRunService(store, quality, app.log, {
    client: options.ai?.client !== undefined ? options.ai.client : aiClientOf(config),
    model: config.aiFake ? 'fake' : (config.aiModel ?? DEFAULT_AI_MODEL),
    now,
    ...options.ai?.runs,
  });
  app.decorate('aiRuns', runs);
  await registerAiRoutes(app, store, config, { runs });

  await registerDashboard(app, options.webDir === undefined ? DEFAULT_WEB_DIR : options.webDir);

  // Until the first platform admin exists, say how to finish setup. A generated
  // code is only ever shown here, so it is printed once per boot.
  app.addHook('onReady', async () => {
    try {
      if (await store.hasPlatformAdmin()) {
        return;
      }
      app.log.warn(
        config.setupCode
          ? 'Server not set up yet: open the dashboard and enter the SETUP_CODE from the environment'
          : `Setup code: ${setupCode} (needed once, on the dashboard's first page)`,
      );
    } catch (err) {
      app.log.error({ err }, 'could not check whether first-run setup is needed');
    }
  });

  return app;
}

/**
 * Serves the built dashboard and makes client-side routes load it: any GET that
 * is not the API (/v1/...) or /health and accepts HTML gets index.html, so
 * /join/<token>, /setup, /reset/<token>, /projects/... work on a direct visit or
 * reload. Everything else that matches no route is a JSON 404, as before.
 */
async function registerDashboard(app: FastifyInstance, webDir: string | null): Promise<void> {
  const serveSpa = webDir !== null && existsSync(join(webDir, 'index.html'));
  if (serveSpa) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/', index: 'index.html' });
  }
  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0];
    const isApi = path === '/v1' || path.startsWith('/v1/') || path === '/health';
    const wantsHtml = (request.headers.accept ?? '').includes('text/html');
    if (serveSpa && request.method === 'GET' && !isApi && wantsHtml) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
