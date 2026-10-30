import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { InMemoryStore } from './store/memory.js';
import { PostgresStore } from './store/postgres.js';
import { runMigrations } from './store/migrate.js';
import type { Store } from './store/store.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Optional self-initialising deploy: apply pending migrations before listening.
  // Migrations are idempotent and run under a Postgres advisory lock, so this is
  // safe to leave on for every boot, also when several instances start at once.
  if (config.migrateOnBoot) {
    if (config.storeBackend !== 'postgres' || !config.databaseUrl) {
      throw new Error('MIGRATE_ON_BOOT requires STORE_BACKEND=postgres and DATABASE_URL');
    }
    // With MIGRATION_DATABASE_URL, the owner migrates and prepares the app role that
    // DATABASE_URL names; the server then runs as that role, bound by Row-Level Security.
    await runMigrations(config.migrationDatabaseUrl ?? config.databaseUrl, (msg) => process.stdout.write(`${msg}\n`), {
      appDatabaseUrl: config.migrationDatabaseUrl ? config.databaseUrl : undefined,
    });
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
  if (config.aiFake) {
    app.log.warn('AI_FAKE=1: the AI assistant is a scripted fake for development, not Gemini; it never calls Vertex AI');
  }
  if (store instanceof PostgresStore) {
    const rls = await store.rowLevelSecurity();
    if (rls.enforced) {
      app.log.info(`Row-Level Security binds the database role ${rls.role}`);
    } else {
      app.log.warn(
        `Row-Level Security does not bind the database role ${rls.role} (${rls.reason}); only the route checks keep projects apart. See "Row-Level Security and the database role" in DEPLOY.md`,
      );
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
