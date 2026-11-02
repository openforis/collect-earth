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
}

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
    publicBaseUrl: env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.length > 0 ? env.PUBLIC_BASE_URL : undefined,
    migrateOnBoot: env.MIGRATE_ON_BOOT === 'true' || env.MIGRATE_ON_BOOT === '1',
    renderExternalUrl: nonEmpty(env.RENDER_EXTERNAL_URL),
    setupCode: nonEmpty(env.SETUP_CODE?.trim()),
    rateLimitPerMinute: rateLimitOf(env.RATE_LIMIT_PER_MINUTE),
    trustProxyHops: trustProxyHopsOf(env.TRUST_PROXY_HOPS),
    qualityWorkerMaxMb: qualityWorkerMaxMbOf(env.QUALITY_WORKER_MAX_MB),
    ...aiConfigOf(env, storeBackend),
    mapTiles: mapTilesOf(env),
  };
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
