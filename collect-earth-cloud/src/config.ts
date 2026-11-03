import { isMailFrom, parseSmtpUrl } from './mail.js';

export interface Config {
  port: number;
  host: string;
  storeBackend: 'memory' | 'postgres';
  databaseUrl?: string;
  /**
   * The owner's connection (MIGRATION_DATABASE_URL), used only to apply the migrations.
   * When set, DATABASE_URL names a separate app role, which the migrations create if
   * missing and grant table rights to, so Row-Level Security binds the server.
   */
  migrationDatabaseUrl?: string;
  /** When set, POST /v1/projects requires header `x-admin-key` to match. */
  adminApiKey?: string;
  /**
   * LINK_SECRET: signs the Collect Earth backup's download links (backupLink.ts). Optional: without
   * it the links are signed with a key worked out from DATABASE_URL, which every instance shares.
   */
  linkSecret?: string;
  /** Public base URL (e.g. https://ce-cloud.example.org) for building invite/join links. */
  publicBaseUrl?: string;
  /** When true (and postgres), apply pending SQL migrations on boot before listening. */
  migrateOnBoot?: boolean;
  /** Render's own public URL (RENDER_EXTERNAL_URL): the fallback base for links when PUBLIC_BASE_URL is unset. */
  renderExternalUrl?: string;
  /**
   * First-run setup code (SETUP_CODE). When unset, buildServer generates a random
   * one and logs it at boot while the server still has no platform admin.
   */
  setupCode?: string;
  /**
   * Requests per minute per client IP on login/signup/setup/reset/register.
   * Undefined = the default (60); 0 disables the limiters (tests).
   */
  rateLimitPerMinute?: number;
  /**
   * Proxies in front of the server that append to x-forwarded-for (TRUST_PROXY_HOPS,
   * default 1). The client IP is taken that many entries from the right, so an
   * address the client writes itself never counts.
   */
  trustProxyHops?: number;
  /** The quality worker's heap in MB (QUALITY_WORKER_MAX_MB); undefined = the default (256). */
  qualityWorkerMaxMb?: number;
  /**
   * The memory caches (Task 22 review, B6), sized for a 512 MiB instance by default; raise them
   * with the instance's memory (DEPLOY.md, "Memory"). Undefined = the default.
   * - parsedCacheMb: parsed plot files (PARSED_FILES_CACHE_MB, default 96);
   * - servedCacheMb: the plot files built for people (SERVED_FILES_CACHE_MB, default 32);
   * - mapBuildsKept: maps kept for their next pages (MAP_BUILDS_KEPT, default 4);
   * - projectStatesKept: projects whose state the Progress and People pages keep (PROJECT_STATES_KEPT, default 3).
   */
  parsedCacheMb?: number;
  servedCacheMb?: number;
  mapBuildsKept?: number;
  projectStatesKept?: number;
  /**
   * The shortest time between two computations of a project's quality figures, in ms;
   * undefined = MIN_COMPUTE_INTERVAL_MS (30 s). Not read from the environment: tests set 0.
   */
  qualityMinIntervalMs?: number;
  /**
   * How long the Progress and People pages may serve a project's state whose records
   * changed, while a newer one is built, in ms; undefined = STATE_STALE_MS (30 s). Not
   * read from the environment: tests set 0.
   */
  stateStaleMs?: number;
  /**
   * The shortest time between two automatic check draws of a project, in ms; undefined =
   * SAMPLING_INTERVAL_MS (10 min). Not read from the environment: tests set it.
   */
  samplingIntervalMs?: number;
  /** How long a request waits for an automatic check draw; undefined = SAMPLING_INLINE_MS (5 s). Tests set it. */
  samplingInlineMs?: number;
  /**
   * A Vertex AI API key for the AI assistant (AI_VERTEX_API_KEY). A secret: it is
   * never sent in a response nor written to the log.
   */
  aiVertexApiKey?: string;
  /** The Google Cloud project for Vertex AI when the server logs in as its service account (AI_VERTEX_PROJECT). */
  aiVertexProject?: string;
  /** The Vertex AI location (AI_VERTEX_REGION); undefined = `global`. */
  aiVertexRegion?: string;
  /** The Gemini model id on Vertex AI (AI_MODEL); undefined = DEFAULT_AI_MODEL. */
  aiModel?: string;
  /** True when the assistant can reach Vertex AI: an API key, or a project (and region). */
  aiConfigured?: boolean;
  /**
   * Development only (AI_FAKE=1): the assistant answers with a scripted fake that calls
   * the real tools and writes a report from their results, so the dashboard's panel can
   * be tried without Vertex AI. Accepted only with the memory store; it makes
   * `aiConfigured` true and is used instead of Vertex even when a key is set.
   */
  aiFake?: boolean;
  /**
   * The map of progress's base map (MAP_TILE_URL, MAP_TILE_ATTRIBUTION, MAP_TILE_ATTRIBUTION_URL,
   * MAP_TILE_MAX_ZOOM); undefined = OSM_TILES. Sent to the dashboard in server-info.
   */
  mapTiles?: MapTiles;
  /**
   * Email (Task 19, Decision 5): SMTP_URL (`smtps://user:password@host:465`, or `smtp://…:587` with
   * STARTTLS required; checked by parseSmtpUrl) and MAIL_FROM, required with it. Without SMTP_URL no
   * mail is sent: the log transport writes a summary to the log. A secret: never sent nor logged.
   */
  smtpUrl?: string;
  mailFrom?: string;
  /** DIGEST_SECRET: what the weekly job sends in `x-digest-secret` (POST /v1/internal/digest); unset: that way is off. */
  digestSecret?: string;
  /**
   * DIGEST_OIDC_AUDIENCE and DIGEST_OIDC_EMAIL: the weekly job may instead come with Cloud Scheduler's
   * OIDC token (Authorization: Bearer), signed by Google for this audience and this service account.
   */
  digestOidc?: { audience: string; email: string };
  /**
   * TRUST_FORWARDED_HOST: links derived from a request (no PUBLIC_BASE_URL) use X-Forwarded-Host. Only
   * behind a proxy that sets it: a client can write it itself (Cloud Run passes it on). Default false.
   */
  trustForwardedHost?: boolean;
}

/** The shortest DIGEST_SECRET accepted. */
export const MIN_DIGEST_SECRET_LENGTH = 32;

/** A base map's tiles, as Leaflet asks for them: `{z}/{x}/{y}` (and optionally `{s}`, `{r}`) in the URL. */
export interface MapTiles {
  url: string;
  /** Shown on the map, as the tile source asks (plain text). */
  attribution: string;
  /** Where the attribution links to; null for none. */
  attributionUrl: string | null;
  maxZoom: number;
}

/**
 * OpenStreetMap's own tiles: no key, with the attribution its tile usage policy asks for
 * (operations.osmfoundation.org/policies/tiles). Fine for a project's coordinators; heavy
 * use needs another tile source (DEPLOY.md).
 */
export const OSM_TILES: MapTiles = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  maxZoom: 19,
};

/**
 * Gemini 3.8 Flash, as Vertex AI names it: "Model ID: gemini-3.8-flash", GA since
 * 2 September 2026, on the global endpoint, with function calling, structured output
 * and system instructions (docs.cloud.google.com/gemini-enterprise-agent-platform/
 * models/gemini/3-8-flash, checked 30 October 2026). The only Gemini 3.8 text model.
 */
export const DEFAULT_AI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_AI_REGION = 'global';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const storeBackend = (env.STORE_BACKEND ?? 'memory') as Config['storeBackend'];
  if (storeBackend !== 'memory' && storeBackend !== 'postgres') {
    throw new Error(`Invalid STORE_BACKEND "${storeBackend}" (expected "memory" or "postgres")`);
  }
  if (storeBackend === 'postgres' && !env.DATABASE_URL) {
    throw new Error('STORE_BACKEND=postgres requires DATABASE_URL to be set');
  }
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    storeBackend,
    databaseUrl: env.DATABASE_URL,
    migrationDatabaseUrl: nonEmpty(env.MIGRATION_DATABASE_URL?.trim()),
    adminApiKey: env.ADMIN_API_KEY && env.ADMIN_API_KEY.length > 0 ? env.ADMIN_API_KEY : undefined,
    linkSecret: nonEmpty(env.LINK_SECRET?.trim()),
    publicBaseUrl: env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.length > 0 ? env.PUBLIC_BASE_URL : undefined,
    migrateOnBoot: env.MIGRATE_ON_BOOT === 'true' || env.MIGRATE_ON_BOOT === '1',
    renderExternalUrl: nonEmpty(env.RENDER_EXTERNAL_URL),
    setupCode: nonEmpty(env.SETUP_CODE?.trim()),
    rateLimitPerMinute: rateLimitOf(env.RATE_LIMIT_PER_MINUTE),
    trustProxyHops: trustProxyHopsOf(env.TRUST_PROXY_HOPS),
    qualityWorkerMaxMb: qualityWorkerMaxMbOf(env.QUALITY_WORKER_MAX_MB),
    parsedCacheMb: wholeAtLeast('PARSED_FILES_CACHE_MB', env.PARSED_FILES_CACHE_MB, 8),
    servedCacheMb: wholeAtLeast('SERVED_FILES_CACHE_MB', env.SERVED_FILES_CACHE_MB, 8),
    mapBuildsKept: wholeAtLeast('MAP_BUILDS_KEPT', env.MAP_BUILDS_KEPT, 1),
    projectStatesKept: wholeAtLeast('PROJECT_STATES_KEPT', env.PROJECT_STATES_KEPT, 1),
    ...aiConfigOf(env, storeBackend),
    mapTiles: mapTilesOf(env),
    ...mailConfigOf(env),
    trustForwardedHost: env.TRUST_FORWARDED_HOST === 'true' || env.TRUST_FORWARDED_HOST === '1',
  };
}

/** The shortest LINK_SECRET accepted when mail is sent (it signs the mails' links). */
export const MIN_LINK_SECRET_LENGTH = 32;

/** SMTP_URL, MAIL_FROM, DIGEST_SECRET and DIGEST_OIDC_*, checked: a server never starts with mail half set up. */
function mailConfigOf(env: NodeJS.ProcessEnv): Pick<Config, 'smtpUrl' | 'mailFrom' | 'digestSecret' | 'digestOidc'> {
  const smtpUrl = nonEmpty(env.SMTP_URL?.trim());
  const mailFrom = nonEmpty(env.MAIL_FROM?.trim());
  const digestSecret = nonEmpty(env.DIGEST_SECRET?.trim());
  if (smtpUrl) {
    parseSmtpUrl(smtpUrl); // throws with the reason
    if (!mailFrom) throw new Error('SMTP_URL is set but MAIL_FROM is not: set the address the mails come from (Collect Earth Cloud <noreply@example.org>)');
    // The mails' links never come from a request (whose Host a client chooses).
    if (!nonEmpty(env.PUBLIC_BASE_URL?.trim()) && !nonEmpty(env.RENDER_EXTERNAL_URL?.trim())) {
      throw new Error('SMTP_URL is set but PUBLIC_BASE_URL is not: set the address people open the dashboard at (https://ce-cloud.example.org); the mails\' links use it');
    }
    // Their own key, never one worked out from DATABASE_URL (a password change would break sent links).
    const link = env.LINK_SECRET?.trim() ?? '';
    if (link.length < MIN_LINK_SECRET_LENGTH) {
      throw new Error(`SMTP_URL is set but LINK_SECRET is not, or is under ${MIN_LINK_SECRET_LENGTH} characters: it signs the mails' links (openssl rand -base64 32)`);
    }
  }
  const audience = nonEmpty(env.DIGEST_OIDC_AUDIENCE?.trim());
  const email = nonEmpty(env.DIGEST_OIDC_EMAIL?.trim());
  if ((audience === undefined) !== (email === undefined)) {
    throw new Error('DIGEST_OIDC_AUDIENCE and DIGEST_OIDC_EMAIL go together: the endpoint\'s address and the scheduler\'s service account');
  }
  if (mailFrom && !isMailFrom(mailFrom)) throw new Error('MAIL_FROM must be an address: noreply@example.org or Name <noreply@example.org>');
  if (digestSecret && digestSecret.length < MIN_DIGEST_SECRET_LENGTH) {
    throw new Error(`DIGEST_SECRET must be at least ${MIN_DIGEST_SECRET_LENGTH} characters (openssl rand -base64 32)`);
  }
  return { smtpUrl, mailFrom, digestSecret, ...(audience && email ? { digestOidc: { audience, email } } : {}) };
}

/** https, or http for a tile server on this machine. */
function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value.replace(/\{-?[a-z]\}/g, '0'));
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

function mapTilesOf(env: NodeJS.ProcessEnv): MapTiles {
  const url = nonEmpty(env.MAP_TILE_URL?.trim());
  const attribution = nonEmpty(env.MAP_TILE_ATTRIBUTION?.trim());
  const attributionUrl = nonEmpty(env.MAP_TILE_ATTRIBUTION_URL?.trim());
  const zoom = nonEmpty(env.MAP_TILE_MAX_ZOOM?.trim());
  if (url === undefined) {
    if (attribution !== undefined || attributionUrl !== undefined || zoom !== undefined) {
      throw new Error('MAP_TILE_ATTRIBUTION, MAP_TILE_ATTRIBUTION_URL and MAP_TILE_MAX_ZOOM go with MAP_TILE_URL, which is not set');
    }
    return OSM_TILES;
  }
  const unknown = (url.match(/\{[^}]*\}/g) ?? []).some((p) => !['{z}', '{x}', '{y}', '{-y}', '{s}', '{r}'].includes(p));
  if (unknown || !['{z}', '{x}', '{y}'].every((part) => url.includes(part)) || !isWebUrl(url)) {
    throw new Error(`Invalid MAP_TILE_URL "${url}" (expected an https URL with {z}, {x} and {y} and no other placeholder than {-y}, {s} or {r}, such as https://tile.openstreetmap.org/{z}/{x}/{y}.png)`);
  }
  if (attribution === undefined || attribution.length > 300) {
    throw new Error('MAP_TILE_ATTRIBUTION is needed with MAP_TILE_URL (the text the tile source asks to show, at most 300 characters)');
  }
  if (attributionUrl !== undefined && !isWebUrl(attributionUrl)) {
    throw new Error(`Invalid MAP_TILE_ATTRIBUTION_URL "${attributionUrl}" (expected an https URL)`);
  }
  const maxZoom = zoom === undefined ? OSM_TILES.maxZoom : Number(zoom);
  if (!Number.isInteger(maxZoom) || maxZoom < 1 || maxZoom > 22) {
    throw new Error(`Invalid MAP_TILE_MAX_ZOOM "${zoom}" (expected a whole number from 1 to 22)`);
  }
  return { url, attribution, attributionUrl: attributionUrl ?? null, maxZoom };
}

function aiConfigOf(
  env: NodeJS.ProcessEnv,
  storeBackend: Config['storeBackend'],
): Pick<Config, 'aiVertexApiKey' | 'aiVertexProject' | 'aiVertexRegion' | 'aiModel' | 'aiConfigured' | 'aiFake'> {
  const aiVertexApiKey = nonEmpty(env.AI_VERTEX_API_KEY?.trim());
  const aiVertexProject = nonEmpty(env.AI_VERTEX_PROJECT?.trim());
  const aiVertexRegion = nonEmpty(env.AI_VERTEX_REGION?.trim()) ?? DEFAULT_AI_REGION;
  const fake = env.AI_FAKE?.trim() ?? '';
  if (fake !== '' && fake !== '0' && fake !== '1') {
    throw new Error(`Invalid AI_FAKE "${env.AI_FAKE}" (expected 1, or 0 / unset)`);
  }
  const aiFake = fake === '1';
  if (aiFake && storeBackend !== 'memory') {
    throw new Error('AI_FAKE=1 is for development only and needs STORE_BACKEND=memory');
  }
  // Never on a real deployment: Cloud Run sets K_SERVICE, and production NODE_ENV=production.
  if (aiFake && (nonEmpty(env.K_SERVICE?.trim()) !== undefined || env.NODE_ENV?.trim() === 'production')) {
    throw new Error('AI_FAKE=1 is for development only: it is refused on Cloud Run (K_SERVICE) and with NODE_ENV=production');
  }
  return {
    aiVertexApiKey,
    aiVertexProject,
    aiVertexRegion,
    aiModel: nonEmpty(env.AI_MODEL?.trim()) ?? DEFAULT_AI_MODEL,
    aiConfigured: aiFake || aiVertexApiKey !== undefined || aiVertexProject !== undefined,
    ...(aiFake ? { aiFake } : {}),
  };
}

function qualityWorkerMaxMbOf(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 64) {
    throw new Error(`Invalid QUALITY_WORKER_MAX_MB "${value}" (expected a whole number of MB, at least 64)`);
  }
  return n;
}

/** A whole number of at least `min` from the environment; undefined when unset or empty. */
function wholeAtLeast(name: string, value: string | undefined, min: number): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`Invalid ${name} "${value}" (expected a whole number, at least ${min})`);
  }
  return n;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function trustProxyHopsOf(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid TRUST_PROXY_HOPS "${value}" (expected a whole number, at least 1)`);
  }
  return n;
}

function rateLimitOf(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid RATE_LIMIT_PER_MINUTE "${value}" (expected a whole number, 0 = off)`);
  }
  return n;
}
