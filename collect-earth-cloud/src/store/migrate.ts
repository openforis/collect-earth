import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.js';

/**
 * Applies every migrations/*.sql file in name order. Each is idempotent
 * (IF NOT EXISTS), so running this repeatedly on an already-migrated database
 * is a no-op — safe to call on every boot. Logs via the provided sink.
 */
export async function runMigrations(
  databaseUrl: string,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    for (const file of files) {
      await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
      log(`Migration ${file} applied.`);
    }
  } finally {
    await pool.end();
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
