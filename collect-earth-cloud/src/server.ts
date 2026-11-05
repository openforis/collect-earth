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
import { requestSerializer } from './logRedact.js';
import { mailerFrom, type Mailer } from './mail.js';
import type { KeySource } from './oidc.js';
import { ServerCounters } from './serverCounters.js';
import type { Store } from './store/store.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerAdminRoutes } from './routes/admin.js';
import { telemetry } from './telemetry.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAssignmentRoutes, setServedCacheMb } from './routes/assignments.js';
import { setParsedCacheMb } from './plotFileCache.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { ProjectStateCache } from './projectState.js';
import { registerPeopleRoutes } from './routes/people.js';
import { registerTimeSpentRoutes } from './routes/timeSpent.js';
import { registerAnalysisRoutes } from './routes/analysis.js';
import { PlotPlaceReader } from './routes/plotPlaces.js';
import { PlotIndexCache, registerPlotSearchRoutes } from './routes/plotSearch.js';
import { registerPlotsGeoRoutes } from './routes/plotsGeo.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerPublicProgressRoutes } from './routes/publicProgress.js';
import { registerCollectBackupRoutes } from './routes/collectBackup.js';
import { registerMailRoutes, type AccountMailHooks } from './routes/mail.js';
import { registerQualityRoutes } from './routes/quality.js';
import { registerRecordRoutes } from './routes/records.js';
import { registerTrainingRoutes } from './routes/training.js';
import { referenceSyncer, registerReferenceRoutes } from './routes/reference.js';
import { registerSamplingRoutes } from './routes/sampling.js';
import { SamplingService } from './samplingService.js';
import { disableLocalOffRoutes, registerLocalRoutes, type LocalSetup } from './local.js';
import { InMemoryStore } from './store/memory.js';

export interface BuildServerOptions {
  store: Store;
  config: Config;
  /** true: log to stdout; an object: where and from which level (tests read the lines). Addresses are logged with their tokens redacted. */
  logger?: boolean | { stream?: NodeJS.WritableStream; level?: string };
  /**
   * Directory of the built dashboard (index.html + assets) served at `/`.
   * Defaults to `web/dist` of this package; null disables static serving. A
   * directory that does not exist is skipped (API-only server).
   */
  webDir?: string | null;
  /** For tests: the AI assistant's client (null = none) instead of the configured one, and the clock of its limits. */
  ai?: { client?: AiClient | null; now?: () => number; runs?: Partial<AiRunServiceOptions> };
  /** For tests: the mail transport (mail.ts's TestMailer) instead of SMTP or the log. */
  mailer?: Mailer;
  /** For tests: a lower cap on confirmation mails per instance and hour. */
  mailLimits?: { perInstanceHour?: number };
  /** For tests: Google's keys for the weekly job's OIDC token. */
  oidcKeys?: KeySource;
  /** The local mode's account and project (src/local.ts, startLocal): required with config.localMode. */
  local?: LocalSetup;
}

/** How long the development fake (AI_FAKE=1) waits before each answer, so the panel's progress shows. */
const FAKE_AI_DELAY_MS = 700;

/** The AI client of this server: the development fake, Gemini on Vertex AI, or none. */
function aiClientOf(config: Config): AiClient | null {
  if (config.localMode) {
    return null;
  }
  if (config.aiFake) {
    return createFakeClient({ delayMs: FAKE_AI_DELAY_MS });
  }
  return createGeminiClient(config) ?? null;
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WEB_DIR = join(PACKAGE_ROOT, 'web', 'dist');
const VERSION = readVersion();

// Set by the bundle's build (scripts/build-local.mjs), which has no package.json beside it.
declare const __COLLECT_EARTH_CLOUD_VERSION__: string | undefined;
/** When this process started (the server owner's panel). */
const STARTED_AT = Date.now();
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
    // A token in an address (progress links, invitations, reset pages, backup downloads) is never
    // written to the server's log (src/logRedact.ts).
    logger: options.logger
      ? { ...(typeof options.logger === 'object' ? options.logger : {}), serializers: { req: requestSerializer } }
      : false,
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

  // The local mode (src/local.ts): before any route, so the routes about other people or the
  // server are seen as they are added and answer 404.
  const local = config.localMode ? localSetupOf(options) : null;
  if (local) {
    disableLocalOffRoutes(app);
  }

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

  // Failed logins and refused requests by hour since this process started (the server owner's panel).
  const counters = new ServerCounters();
  const limiter = new RateLimiter(config.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE, Date.now, {
    onRefused: () => counters.count('rateLimited'),
  });
  const loginFailures = new RateLimiter(config.rateLimitPerMinute === 0 ? 0 : LOGIN_FAILURES_PER_MINUTE);
  const setupCode = config.setupCode ?? generateSetupCode();

  // Members' activity (member_activity), coalesced; written when the app closes too.
  registerActivity(app, new ActivityRecorder(store, { onError: (err) => app.log.error({ err }, 'member activity write failed') }));

  // The mail routes, registered later, put their confirmation sender and the password notice here.
  const accountMail: AccountMailHooks = {};
  // Email (Task 19): SMTP only when SMTP_URL is set, else nothing is sent (the log transport).
  const mailer = options.mailer ?? mailerFrom(config, app.log);
  await registerAuthRoutes(app, store, limiter, loginFailures, counters, accountMail);
  const now = options.ai?.now ?? Date.now;
  // Error reports and usage events, when the server is started with TELEMETRY=1 (src/telemetry.ts).
  if (config.telemetry) await telemetry.configure(config.telemetry, VERSION, app.log);
  app.addHook('onError', async (request, _reply, error) => {
    // A plain error thrown by a handler has no status yet (the reply's is still 200): it is a 500.
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      telemetry.captureError(error, { route: request.routeOptions?.url ?? 'unknown', method: request.method, project: request.membership?.projectId });
    }
  });
  await registerAdminRoutes(app, store, config, limiter, {
    setupCode,
    version: VERSION,
    now,
    counters,
    startedAt: STARTED_AT,
    accountMail,
    // "Forgot your password?" mails its link only where mail really goes out.
    selfServiceReset: mailer.delivers && !config.localMode,
  });
  await registerProjectRoutes(app, store, config);
  await registerCollectBackupRoutes(app, store, config, limiter, now);
  await registerPlatformRoutes(app, store, config);
  const quality = new QualityService(store, new QualityWorker({ maxOldGenerationSizeMb: config.qualityWorkerMaxMb }), {
    minIntervalMs: config.qualityMinIntervalMs,
  });
  // The Progress and People pages' project state, worked out once per project and kept.
  const states = new ProjectStateCache(store, { staleMs: config.stateStaleMs, ...(config.projectStatesKept ? { maxProjects: config.projectStatesKept } : {}) });
  // The plot files' caches are the process's: sized from the config when it says (DEPLOY.md, "Memory").
  if (config.parsedCacheMb) setParsedCacheMb(config.parsedCacheMb);
  if (config.servedCacheMb) setServedCacheMb(config.servedCacheMb);
  // The automatic check sampling: drawn after first submissions and before a plot list, at most once per 10 min.
  const sampling = new SamplingService(store, states, { intervalMs: config.samplingIntervalMs, inlineMs: config.samplingInlineMs, now, onLate: () => counters.lateDraw() });
  // Where plots are and what the project file says of them, shared by the quality routes, plot
  // search, the map and order 'nearby' of a division (Task 15).
  const places = new PlotPlaceReader(store);
  // The plots sent back for another look compare answers as the figures do (by the survey's
  // outline) and resolve records with the project state's plot context.
  await registerAssignmentRoutes(app, store, config, { outline: (projectId, log) => quality.outline(projectId, log), states, sampling, places });
  // The plot index of plot search, also what tells a decision's plot exists.
  const indexes = new PlotIndexCache(store, places);
  await registerQualityRoutes(app, store, quality, places, indexes);
  await registerPlotSearchRoutes(app, store, quality, places, indexes);
  await registerProgressRoutes(app, store, quality, states, now);
  await registerPeopleRoutes(app, store, quality, states, now);
  await registerTimeSpentRoutes(app, store, states);
  await registerAnalysisRoutes(app, store, states);
  await registerPlotsGeoRoutes(app, store, quality, states, places, config.mapBuildsKept ? { maxBuilds: config.mapBuildsKept } : {});
  await registerActivityRoutes(app, store, quality, states, places, now);
  // No check sampling in the local mode: there is no one else to check.
  await registerRecordRoutes(app, store, local ? undefined : sampling);
  await registerSamplingRoutes(app, store, sampling);
  await registerReferenceRoutes(app, store, quality, states, now);
  await registerTrainingRoutes(app, store, { outline: (projectId, log) => quality.outline(projectId, log), now });
  // Read-only progress links for funders (Task 18): the public page reads the Progress tab's figures.
  await registerPublicProgressRoutes(app, store, config, limiter, states, now);
  // Email digests (Task 19), confirmation links, "Forgot your password?" and the account's security notices.
  await registerMailRoutes(app, store, config, limiter, { mailer, quality, states, now, limits: options.mailLimits, oidcKeys: options.oidcKeys, accountMail });
  // Role changes, removals and disabled accounts keep the reference copies right (Task 14).
  app.decorate('referenceSync', referenceSyncer(store, states, now));
  const runs = new AiRunService(store, quality, app.log, {
    client: options.ai?.client !== undefined ? options.ai.client : aiClientOf(config),
    model: config.aiFake ? 'fake' : (config.aiModel ?? DEFAULT_AI_MODEL),
    now,
    ...options.ai?.runs,
  });
  app.decorate('aiRuns', runs);
  await registerAiRoutes(app, store, config, { runs });

  if (local) {
    await registerLocalRoutes(app, store as InMemoryStore, local);
  }

  await registerDashboard(app, options.webDir === undefined ? (config.webDir ?? DEFAULT_WEB_DIR) : options.webDir);

  // Until the first platform admin exists, say how to finish setup. A generated
  // code is only ever shown here, so it is printed once per boot.
  app.addHook('onReady', async () => {
    if (local) {
      // No setup in the local mode: its one account was made at start.
      return;
    }
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
      if (path.startsWith('/p/') || path.startsWith('/unsubscribe/') || path.startsWith('/confirm-email/')) {
        // A progress link's page (Task 18), and the pages a mail's links open (Task 19): the token
        // is in the address, so it is not indexed, not sent on as a referrer, and not kept by a cache.
        return reply
          .header('cache-control', 'no-store')
          .header('x-robots-tag', 'noindex, nofollow')
          .header('referrer-policy', 'no-referrer')
          .sendFile('index.html');
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}

/** The local mode's setup, checked: the memory store, and startLocal's account and project. */
function localSetupOf(options: BuildServerOptions): LocalSetup {
  if (!(options.store instanceof InMemoryStore)) {
    throw new Error('LOCAL_MODE=1 runs on the memory store only');
  }
  if (!options.local) {
    throw new Error('LOCAL_MODE=1 needs the local account and project (startLocal) before the server is built');
  }
  return options.local;
}

function readVersion(): string {
  if (typeof __COLLECT_EARTH_CLOUD_VERSION__ === 'string') {
    return __COLLECT_EARTH_CLOUD_VERSION__;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
