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
}

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
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
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
