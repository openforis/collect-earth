import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.js';

/**
 * Key of the Postgres advisory lock held while migrating. Any fixed 64-bit value
 * works; it only has to be the same in every instance of this server and not used
 * by anything else in the database. Passed as text and cast to bigint in SQL.
 */
export const MIGRATION_LOCK_KEY = '4846419847';

/**
 * Applies every migrations/*.sql file in name order. Each is idempotent
 * (IF NOT EXISTS), so running this repeatedly on an already-migrated database
 * is a no-op — safe to call on every boot. Logs via the provided sink.
 *
 * The whole run holds a session-level advisory lock on one connection, so when
 * several instances boot at once with MIGRATE_ON_BOOT=true (Cloud Run scaling
 * out), they apply the migrations one after the other instead of racing on the
 * same CREATE statements. The lock is released at the end, and Postgres also
 * drops it if the connection dies.
 */
export async function runMigrations(
  databaseUrl: string,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    try {
      for (const file of files) {
        await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
        log(`Migration ${file} applied.`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

/** CLI entrypoint: `npm run migrate`. */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL must be set to run migrations');
  }
  // eslint-disable-next-line no-console
  await runMigrations(config.databaseUrl, (msg) => console.log(msg));
}

// Only run as a script, not when imported (e.g. by index.ts for boot migrations).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
