import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { InMemoryStore } from './store/memory.js';
import { PostgresStore } from './store/postgres.js';
import { runMigrations } from './store/migrate.js';
import type { Store } from './store/store.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Optional self-initialising deploy: apply pending migrations before listening.
  // Migrations are idempotent, so this is safe to leave on for every boot. On a
  // multi-instance deploy prefer running `npm run migrate` as a one-off release
  // step instead, to avoid concurrent migration races on cold start.
  if (config.migrateOnBoot) {
    if (config.storeBackend !== 'postgres' || !config.databaseUrl) {
      throw new Error('MIGRATE_ON_BOOT requires STORE_BACKEND=postgres and DATABASE_URL');
    }
    await runMigrations(config.databaseUrl, (msg) => process.stdout.write(`${msg}\n`));
  }

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
