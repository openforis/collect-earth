import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { InMemoryStore } from './store/memory.js';
import { PostgresStore } from './store/postgres.js';
import type { Store } from './store/store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store: Store =
    config.storeBackend === 'postgres'
      ? new PostgresStore(config.databaseUrl!)
      : new InMemoryStore();

  const app = await buildServer({ store, config, logger: true });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down`);
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  if (config.storeBackend === 'memory') {
    app.log.warn('STORE_BACKEND=memory: data is not persisted across restarts');
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
