import { createHash } from 'node:crypto';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.js';
import { scramSha256Verifier } from './scram.js';

/**
 * Key of the Postgres advisory lock held while migrating. Any fixed 64-bit value
 * works; it only has to be the same in every instance of this server and not used
 * by anything else in the database. Passed as text and cast to bigint in SQL.
 */
export const MIGRATION_LOCK_KEY = '4846419847';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** The migrations this server ships (migrations/*.sql), in the order they run. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** How long a migration statement waits for a table's lock (a long query of the running server) before it gives up. */
export const MIGRATION_LOCK_TIMEOUT = '3s';
/** Runs of the migrations tried when a table stays busy (lock_timeout), with a growing pause between them. */
export const MIGRATION_ATTEMPTS = 4;

/** A migration file: its name, its SQL and the sha256 of its bytes. */
export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

/** The migration files with their contents and checksums, in the order they run. */
export function readMigrations(): MigrationFile[] {
  return migrationFiles().map((name) => {
    const bytes = readFileSync(join(MIGRATIONS_DIR, name));
    return { name, sql: bytes.toString('utf8'), checksum: createHash('sha256').update(bytes).digest('hex') };
  });
}

/**
 * Applies the migrations/*.sql files in name order, skipping those already applied with the same
 * sha256 (schema_migrations.checksum, migration 024): a file edited since runs again, a new one
 * runs. Each file is idempotent (IF NOT EXISTS), so running one again is safe; skipping them keeps
 * a boot from taking the tables' locks for nothing. Logs via the provided sink.
 *
 * The whole run holds a session-level advisory lock on one connection, so when
 * several instances boot at once with MIGRATE_ON_BOOT=true (Cloud Run scaling
 * out), they apply the migrations one after the other instead of racing on the
 * same CREATE statements. The lock is released at the end, and Postgres also
 * drops it if the connection dies. Once it holds the lock, every statement waits at most
 * MIGRATION_LOCK_TIMEOUT for a table's lock (an ALTER TABLE queued behind a long query would
 * otherwise stop every other query on that table meanwhile); a run that times out is rolled back
 * (each file is one implicit transaction) and tried again, MIGRATION_ATTEMPTS runs in all.
 */
export async function runMigrations(
  databaseUrl: string,
  log: (msg: string) => void = () => {},
  options: { appDatabaseUrl?: string; attempts?: number; pauseMs?: (attempt: number) => number } = {},
): Promise<void> {
  const attempts = options.attempts ?? MIGRATION_ATTEMPTS;
  const pause = options.pauseMs ?? ((attempt: number) => 1000 * 2 ** (attempt - 1));
  for (let attempt = 1; ; attempt++) {
    try {
      await runOnce(databaseUrl, log, options.appDatabaseUrl);
      return;
    } catch (err) {
      if ((err as { code?: unknown }).code !== '55P03' || attempt >= attempts) {
        throw err;
      }
      log(`Migrations: a table was busy for over ${MIGRATION_LOCK_TIMEOUT} (lock_timeout); trying again (${attempt} of ${attempts - 1}).`);
      await new Promise((resolve) => setTimeout(resolve, pause(attempt)));
    }
  }
}

/** The checksums recorded for the files applied; none when schema_migrations or its checksum column is not there yet. */
async function appliedChecksums(client: pg.Client): Promise<Map<string, string>> {
  try {
    const res = await client.query('SELECT name, checksum FROM schema_migrations');
    return new Map(res.rows.filter((r) => typeof r.checksum === 'string').map((r) => [r.name as string, r.checksum as string]));
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    // 42P01: no schema_migrations (before 018); 42703: no checksum column (before 024).
    if (code === '42P01' || code === '42703') return new Map();
    throw err;
  }
}

/** Records one file as applied with its checksum; false when schema_migrations (018) or its checksum column (024) is not there yet. */
async function recorded(client: pg.Client, file: MigrationFile): Promise<boolean> {
  try {
    await client.query(
      `INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET last_applied_at = now(), checksum = EXCLUDED.checksum`,
      [file.name, file.checksum],
    );
    return true;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === '42P01' || code === '42703') return false;
    throw err;
  }
}

async function runOnce(databaseUrl: string, log: (msg: string) => void, appDatabaseUrl: string | undefined): Promise<void> {
  const files = readMigrations();

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`SET lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
      let applied = await appliedChecksums(client);
      let ran = 0;
      for (const file of files) {
        if (applied.get(file.name) === file.checksum) {
          continue;
        }
        await client.query(file.sql);
        ran += 1;
        log(`Migration ${file.name} applied.`);
        // What ran, recorded at once (a later file failing does not make this one run again), for the
        // server owner's panel too (schema_migrations, 018): the first time each one ran and the last,
        // and the checksum it ran with (024). Before 018 and 024 have run there is nowhere to write it:
        // those files are then recorded with the others once the table and the column are there.
        if (await recorded(client, file)) {
          applied = new Map(applied).set(file.name, file.checksum);
        }
      }
      if (ran < files.length) {
        log(`Migrations: ${files.length - ran} already applied and unchanged, skipped.`);
      }
      // The files run before schema_migrations (or its checksum column) existed.
      const unrecorded = files.filter((f) => applied.get(f.name) !== f.checksum);
      if (unrecorded.length > 0) {
        await client.query(
          `INSERT INTO schema_migrations (name, checksum) SELECT * FROM unnest($1::text[], $2::text[])
           ON CONFLICT (name) DO UPDATE SET last_applied_at = now(), checksum = EXCLUDED.checksum`,
          [unrecorded.map((f) => f.name), unrecorded.map((f) => f.checksum)],
        );
      }
      if (appDatabaseUrl !== undefined) {
        await prepareAppRole(client, appDatabaseUrl, log);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

/**
 * The user and password a Postgres connection string names, read as pg reads it
 * (pg-connection-string): `postgres://USER:PASSWORD@host/db`, an empty host as in Cloud
 * SQL's socket URLs, or `?user=...&password=...` in the query string. Null when it names
 * no user (pg would then use PGUSER or the system's user, which we cannot check).
 */
export function credentialsOf(url: string): { user: string; password: string | null } | null {
  if (!/^postgres(?:ql)?:\/\//.test(url)) {
    return null;
  }
  let parsed: ReturnType<typeof parseConnectionString>;
  try {
    parsed = parseConnectionString(url);
  } catch {
    return null;
  }
  if (!parsed.user) {
    return null;
  }
  return { user: parsed.user, password: parsed.password ? parsed.password : null };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The fix for a role that may create objects in schema public (Postgres 14 and older grant it to everyone). */
export const PUBLIC_SCHEMA_FIX =
  'REVOKE CREATE ON SCHEMA public FROM PUBLIC (as the schema\'s owner, e.g. postgres; if the tables\' owner then cannot create tables, also GRANT CREATE ON SCHEMA public TO it)';

/**
 * With a separate app role (MIGRATION_DATABASE_URL set), run as the owner after the
 * migrations, on every boot, so new tables are covered. Idempotent.
 * - Creates the role DATABASE_URL names if it is missing (LOGIN, no other right), or
 *   sets its password again if it exists, so the URL (the secret) is the source of
 *   truth. Postgres gets only a SCRAM-SHA-256 verifier of the password, never the
 *   password itself: a statement that fails is written to Postgres's log as it is.
 * - Refuses, before changing anything, a role Row-Level Security would not bind or that
 *   could get out of it: a superuser, BYPASSRLS, CREATEROLE, a member (directly or not)
 *   of a superuser or BYPASSRLS role, the tables' owner or a member of it, or a role
 *   that may create objects in schema public.
 * - Grants it the use of every table and sequence, now and (default privileges) those
 *   the owner creates later.
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
  const role = await client.query(
    `SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole,
            EXISTS (SELECT 1 FROM pg_roles m
                     WHERE m.oid <> r.oid AND (m.rolsuper OR m.rolbypassrls) AND pg_has_role(r.oid, m.oid, 'MEMBER')) AS member_of_privileged
       FROM pg_roles r WHERE r.rolname = $1`,
    [app.user],
  );
  if (role.rowCount === 0) {
    if (!app.password) {
      throw new Error(`The database role ${app.user} does not exist, and DATABASE_URL has no password to create it with`);
    }
    const create = await client.query(
      "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', $1::text, $2::text) AS sql",
      [app.user, scramSha256Verifier(app.password)],
    );
    await client.query(create.rows[0].sql as string);
    log(`Database role ${app.user} created.`);
  } else {
    const r = role.rows[0];
    if (r.rolsuper) {
      throw new Error(`The database role ${app.user} is a superuser, so Row-Level Security would not bind it; use a plain role for DATABASE_URL`);
    }
    if (r.rolbypassrls) {
      throw new Error(`The database role ${app.user} may bypass Row-Level Security; use a plain role for DATABASE_URL`);
    }
    if (r.rolcreaterole) {
      throw new Error(`The database role ${app.user} has CREATEROLE, so it could give itself other roles' rights; use a plain role for DATABASE_URL`);
    }
    if (r.member_of_privileged) {
      throw new Error(`The database role ${app.user} is a member of a role that is a superuser or may bypass Row-Level Security; use a plain role for DATABASE_URL`);
    }
  }
  const owning = await client.query(
    "SELECT COALESCE(bool_or(pg_has_role($1, tableowner, 'USAGE')), false) AS owns FROM pg_tables WHERE schemaname = 'public'",
    [app.user],
  );
  if (owning.rows[0].owns) {
    throw new Error(`The database role ${app.user} owns the tables (or is a member of their owner), so Row-Level Security would not bind it; use a role that does not`);
  }
  const creating = await client.query("SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create", [app.user]);
  if (creating.rows[0].can_create) {
    throw new Error(`The database role ${app.user} may create objects in schema public (the default up to Postgres 14). Fix it with: ${PUBLIC_SCHEMA_FIX}`);
  }
  if (role.rowCount !== 0 && app.password) {
    const alter = await client.query("SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS sql", [
      app.user,
      scramSha256Verifier(app.password),
    ]);
    try {
      await client.query(alter.rows[0].sql as string);
    } catch (err) {
      throw new Error(
        `Could not set the password of the database role ${app.user} from DATABASE_URL (${(err as Error).message}). ` +
          'The tables\' owner must be allowed to change that role: create it as the owner, or let the server create it.',
      );
    }
    log(`Database role ${app.user}: password set from DATABASE_URL.`);
  }
  const r = quoteIdent(app.user);
  const o = quoteIdent(owner);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${o} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${o} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${r}`);
  // Which migrations ran is written by runMigrations as the owner; the server only reads it.
  // After the blanket grant above, on every boot, so it stays taken back.
  await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM ${r}`);
  // The progress links' lookup (021) is not PUBLIC: the app role alone may call it.
  await client.query(`GRANT EXECUTE ON FUNCTION share_link_lookup(TEXT) TO ${r}`);
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
