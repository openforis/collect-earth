export interface Config {
  port: number;
  host: string;
  storeBackend: 'memory' | 'postgres';
  databaseUrl?: string;
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
  /** The quality worker's heap in MB (QUALITY_WORKER_MAX_MB); undefined = the default (512). */
  qualityWorkerMaxMb?: number;
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
}

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
    adminApiKey: env.ADMIN_API_KEY && env.ADMIN_API_KEY.length > 0 ? env.ADMIN_API_KEY : undefined,
    publicBaseUrl: env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.length > 0 ? env.PUBLIC_BASE_URL : undefined,
    migrateOnBoot: env.MIGRATE_ON_BOOT === 'true' || env.MIGRATE_ON_BOOT === '1',
    renderExternalUrl: nonEmpty(env.RENDER_EXTERNAL_URL),
    setupCode: nonEmpty(env.SETUP_CODE?.trim()),
    rateLimitPerMinute: rateLimitOf(env.RATE_LIMIT_PER_MINUTE),
    trustProxyHops: trustProxyHopsOf(env.TRUST_PROXY_HOPS),
    qualityWorkerMaxMb: qualityWorkerMaxMbOf(env.QUALITY_WORKER_MAX_MB),
    ...aiConfigOf(env),
  };
}

function aiConfigOf(env: NodeJS.ProcessEnv): Pick<Config, 'aiVertexApiKey' | 'aiVertexProject' | 'aiVertexRegion' | 'aiModel' | 'aiConfigured'> {
  const aiVertexApiKey = nonEmpty(env.AI_VERTEX_API_KEY?.trim());
  const aiVertexProject = nonEmpty(env.AI_VERTEX_PROJECT?.trim());
  const aiVertexRegion = nonEmpty(env.AI_VERTEX_REGION?.trim()) ?? DEFAULT_AI_REGION;
  return {
    aiVertexApiKey,
    aiVertexProject,
    aiVertexRegion,
    aiModel: nonEmpty(env.AI_MODEL?.trim()) ?? DEFAULT_AI_MODEL,
    aiConfigured: aiVertexApiKey !== undefined || aiVertexProject !== undefined,
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
