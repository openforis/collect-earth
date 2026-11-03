import { forgetMigrationUrl, rowLevelSecurityAtBoot } from './boot.js';
import { loadConfig } from './config.js';
import { readyLine, startLocal } from './local.js';
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
  // The owner's URL is not needed past this point: nothing else may read or log it.
  const separateRole = forgetMigrationUrl(config);

  const store: Store =
    config.storeBackend === 'postgres'
      ? new PostgresStore(config.databaseUrl!)
      : new InMemoryStore();

  // Before listening: with a separate app role asked for, a role RLS does not bind stops the start.
  let rlsLog: ReturnType<typeof rowLevelSecurityAtBoot> | null = null;
  if (store instanceof PostgresStore) {
    try {
      rlsLog = rowLevelSecurityAtBoot(await store.rowLevelSecurity(), separateRole);
    } catch (err) {
      await store.close();
      throw err;
    }
  }

  // The local mode (src/local.ts): its account and project first. Its log goes to stderr, so that
  // stdout carries only the ready line the desktop reads.
  const local = config.localMode ? await startLocal(store as InMemoryStore, config) : undefined;
  const app = await buildServer({ store, config, logger: local ? { stream: process.stderr } : true, ...(local ? { local } : {}) });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down`);
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  if (local) {
    process.stdout.write(`${readyLine(app, local)}\n`);
    // Collect Earth keeps this process's stdin open as a pipe, which the system closes when Collect
    // Earth ends, even killed: the dashboard then ends too rather than staying behind. Asked for by
    // LOCAL_EXIT_WITH_STDIN=1, as a server started with no stdin (/dev/null) would end at once.
    if (process.env.LOCAL_EXIT_WITH_STDIN === '1') {
      process.stdin.on('end', () => void shutdown('the end of stdin (Collect Earth ended)'));
      process.stdin.on('error', () => void shutdown('an error of stdin (Collect Earth ended)'));
      process.stdin.resume();
    }
    return;
  }
  if (config.storeBackend === 'memory') {
    app.log.warn('STORE_BACKEND=memory: data is not persisted across restarts');
  }
  if (config.aiFake) {
    app.log.warn('AI_FAKE=1: the AI assistant is a scripted fake for development, not Gemini; it never calls Vertex AI');
  }
  if (rlsLog) {
    app.log[rlsLog.level](rlsLog.message);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
