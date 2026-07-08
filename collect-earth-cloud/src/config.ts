export interface Config {
  port: number;
  host: string;
  storeBackend: 'memory' | 'postgres';
  databaseUrl?: string;
  /** When set, POST /v1/projects requires header `x-admin-key` to match. */
  adminApiKey?: string;
  /** Public base URL (e.g. https://ce-cloud.example.org) for building invite/join links. */
  publicBaseUrl?: string;
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
  };
}
