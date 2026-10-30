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
  options: { appDatabaseUrl?: string } = {},
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
      if (options.appDatabaseUrl !== undefined) {
        await prepareAppRole(client, options.appDatabaseUrl, log);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

/** The user and password a postgres:// URL names (also with an empty host, as Cloud SQL's socket URLs have). */
export function credentialsOf(url: string): { user: string; password: string | null } | null {
  const m = /^postgres(?:ql)?:\/\/([^:@/?#]+)(?::([^@/?#]*))?@/.exec(url);
  if (!m) {
    return null;
  }
  return { user: decodeURIComponent(m[1]), password: m[2] === undefined ? null : decodeURIComponent(m[2]) };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * With a separate app role (MIGRATION_DATABASE_URL set): creates the role DATABASE_URL
 * names if it is missing (LOGIN, with that URL's password; no other right), refuses a
 * role that would not be bound by Row-Level Security (a superuser, BYPASSRLS, or the
 * tables' owner or a member of it), and grants it the use of every table. Idempotent;
 * run as the owner after the migrations, on every boot, so new tables are covered. The
 * password is never logged.
 */
export async function prepareAppRole(client: pg.Client, appDatabaseUrl: string, log: (msg: string) => void): Promise<void> {
  const app = credentialsOf(appDatabaseUrl);
  if (!app) {
    throw new Error('DATABASE_URL must name its user (postgres://USER:PASSWORD@...) when MIGRATION_DATABASE_URL is set');
  }
  const owner = (await client.query('SELECT current_user AS name')).rows[0].name as string;
  if (app.user === owner) {
    log(`DATABASE_URL and MIGRATION_DATABASE_URL use the same role (${owner}): Row-Level Security does not bind the server.`);
    return;
  }
  const role = await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [app.user]);
  if (role.rowCount === 0) {
    if (!app.password) {
      throw new Error(`The database role ${app.user} does not exist, and DATABASE_URL has no password to create it with`);
    }
    const create = await client.query(
      "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', $1::text, $2::text) AS sql",
      [app.user, app.password],
    );
    await client.query(create.rows[0].sql as string);
    log(`Database role ${app.user} created.`);
  } else if (role.rows[0].rolsuper || role.rows[0].rolbypassrls) {
    throw new Error(`The database role ${app.user} is a superuser or may bypass Row-Level Security; use a plain role for DATABASE_URL`);
  }
  const owning = await client.query(
    "SELECT COALESCE(bool_or(pg_has_role($1, tableowner, 'USAGE')), false) AS owns FROM pg_tables WHERE schemaname = 'public'",
    [app.user],
  );
  if (owning.rows[0].owns) {
    throw new Error(`The database role ${app.user} owns the tables (or is a member of their owner), so Row-Level Security would not bind it; use a role that does not`);
  }
  const r = quoteIdent(app.user);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
  log(`Database role ${app.user} may use the tables; Row-Level Security binds it.`);
}

/** CLI entrypoint: `npm run migrate`. */
async function main(): Promise<void> {
  const config = loadConfig();
  const url = config.migrationDatabaseUrl ?? config.databaseUrl;
  if (!url) {
    throw new Error('DATABASE_URL (or MIGRATION_DATABASE_URL) must be set to run migrations');
  }
  const appDatabaseUrl = config.migrationDatabaseUrl && config.databaseUrl ? config.databaseUrl : undefined;
  // eslint-disable-next-line no-console
  await runMigrations(url, (msg) => console.log(msg), { appDatabaseUrl });
}

// Only run as a script, not when imported (e.g. by index.ts for boot migrations).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
