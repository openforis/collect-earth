import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.js';

/** Applies every migrations/*.sql file in name order. Each is idempotent (IF NOT EXISTS). */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL must be set to run migrations');
  }
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  try {
    for (const file of files) {
      await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
      // eslint-disable-next-line no-console
      console.log(`Migration ${file} applied.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
