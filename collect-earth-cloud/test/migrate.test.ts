import { describe, expect, it, vi, beforeEach } from 'vitest';

// Every query run by runMigrations, in order, tagged with the client that ran it.
const calls: { client: number; sql: string; params?: unknown[] }[] = [];
let clients = 0;
let failOn: string | null = null;
// The Postgres error code thrown by failOn, and how many times.
let failCode: string | undefined;
let failTimes = Infinity;
// Rows answered to a query containing the key (the role checks of prepareAppRole).
let answers: Record<string, unknown[]> = {};

vi.mock('pg', () => {
  class Client {
    private readonly id = ++clients;
    async connect(): Promise<void> {
      calls.push({ client: this.id, sql: 'CONNECT' });
    }
    async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
      calls.push({ client: this.id, sql, params });
      if (failOn && sql.includes(failOn) && failTimes > 0) {
        failTimes -= 1;
        throw Object.assign(new Error('boom'), failCode !== undefined ? { code: failCode } : {});
      }
      const key = Object.keys(answers).find((k) => sql.includes(k));
      const rows = key ? answers[key] : [];
      return { rows, rowCount: rows.length };
    }
    async end(): Promise<void> {
      calls.push({ client: this.id, sql: 'END' });
    }
  }
  return { default: { Client } };
});

const { credentialsOf, migrationFiles, readMigrations, runMigrations } = await import('../src/store/migrate.js');

describe('runMigrations', () => {
  beforeEach(() => {
    calls.length = 0;
    clients = 0;
    failOn = null;
    failCode = undefined;
    failTimes = Infinity;
    answers = {};
  });

  it('skips the files applied with the same sha256, runs one edited since and records it with its checksum (B4)', async () => {
    const files = readMigrations();
    const edited = files.find((f) => f.name === '015_decision_bulk.sql')!;
    answers = { 'SELECT name, checksum FROM schema_migrations': files.map((f) => ({ name: f.name, checksum: f === edited ? 'old' : f.checksum })) };
    const logged: string[] = [];
    await runMigrations('postgres://unused', (m) => logged.push(m));
    const sql = calls.map((c) => c.sql);
    expect(sql).toContain("SET lock_timeout = '3s'");
    expect(sql.indexOf("SET lock_timeout = '3s'")).toBeGreaterThan(sql.findIndex((x) => x.includes('pg_advisory_lock')));
    // Only 015 ran.
    expect(sql.filter((x) => files.some((f) => f.sql === x))).toEqual([edited.sql]);
    expect(logged).toEqual(['Migration 015_decision_bulk.sql applied.', `Migrations: ${files.length - 1} already applied and unchanged, skipped.`]);
    const recorded = calls.find((c) => c.sql.includes('INSERT INTO schema_migrations'))!;
    expect(recorded.params).toEqual(['015_decision_bulk.sql', edited.checksum]);
    expect(calls.filter((c) => c.sql.includes('INSERT INTO schema_migrations'))).toHaveLength(1);
    expect(edited.checksum).toMatch(/^[0-9a-f]{64}$/);

    // Nothing changed: no file runs, nothing is recorded.
    calls.length = 0;
    answers = { 'SELECT name, checksum FROM schema_migrations': files.map((f) => ({ name: f.name, checksum: f.checksum })) };
    await runMigrations('postgres://unused');
    expect(calls.some((c) => files.some((f) => f.sql === c.sql))).toBe(false);
    expect(calls.some((c) => c.sql.includes('INSERT INTO schema_migrations'))).toBe(false);
  });

  it('runs every file when schema_migrations has no checksum column yet (before 024): those run before it are recorded once it is there', async () => {
    // The record of each file up to 023 finds no checksum column (the read finds nothing recorded).
    failOn = 'INSERT INTO schema_migrations (name, checksum) VALUES';
    failCode = '42703';
    const files = migrationFiles();
    failTimes = files.indexOf('024_migration_checksums.sql');
    await runMigrations('postgres://unused');
    // 024 recorded itself; then every file before it at once.
    const batch = calls.filter((c) => c.sql.includes('INSERT INTO schema_migrations') && c.sql.includes('unnest('));
    expect(batch).toHaveLength(1);
    expect(batch[0].params![0]).toEqual(files.filter((f) => f !== '024_migration_checksums.sql'));
    expect(files).toContain('024_migration_checksums.sql');
  });

  it('records each file as soon as it has run: a later one failing leaves the ones before recorded', async () => {
    const files = readMigrations();
    const failing = files.find((f) => f.sql.includes('ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at'))!;
    failOn = 'ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at';
    failTimes = 1;
    await expect(runMigrations('postgres://unused', () => {}, { attempts: 1 })).rejects.toThrow('boom');
    const recordedNames = calls.filter((c) => c.sql.includes('VALUES ($1, $2)')).map((c) => c.params![0]);
    expect(recordedNames).toEqual(files.slice(0, files.indexOf(failing)).map((f) => f.name));
  });

  it('a run that meets a busy table (lock_timeout, 55P03) is tried again after a pause; other errors are not', async () => {
    failOn = 'CREATE TABLE IF NOT EXISTS projects';
    failCode = '55P03';
    failTimes = 2;
    const pauses: number[] = [];
    const logged: string[] = [];
    await runMigrations('postgres://unused', (m) => logged.push(m), { pauseMs: (n) => (pauses.push(n), 0) });
    expect(pauses).toEqual([1, 2]);
    expect(logged.filter((m) => m.includes('lock_timeout'))).toHaveLength(2);
    // Each run released the advisory lock and closed its connection.
    expect(calls.filter((c) => c.sql.includes('pg_advisory_unlock'))).toHaveLength(3);
    expect(calls.filter((c) => c.sql === 'END')).toHaveLength(3);

    calls.length = 0;
    failTimes = 9;
    await expect(runMigrations('postgres://unused', () => {}, { attempts: 3, pauseMs: () => 0 })).rejects.toMatchObject({ code: '55P03' });
    expect(calls.filter((c) => c.sql === 'END')).toHaveLength(3);
  });

  it('runs every migration on one connection while holding the advisory lock', async () => {
    const logged: string[] = [];
    await runMigrations('postgres://unused', (m) => logged.push(m));

    expect(new Set(calls.map((c) => c.client)).size).toBe(1);
    const sql = calls.map((c) => c.sql);
    expect(sql[0]).toBe('CONNECT');
    expect(sql[1]).toContain('pg_advisory_lock');
    expect(sql.at(-2)).toContain('pg_advisory_unlock');
    expect(sql.at(-1)).toBe('END');
    // The migrations themselves sit between lock and unlock.
    expect(sql.slice(2, -2).length).toBeGreaterThanOrEqual(4);
    expect(logged[0]).toBe('Migration 001_init.sql applied.');
    // Each file is recorded (schema_migrations) right after it ran, still under the lock.
    const files = readMigrations();
    for (const f of files) {
      const at = calls.findIndex((c) => c.sql === f.sql);
      expect(calls[at + 1].sql, f.name).toContain('INSERT INTO schema_migrations');
      expect(calls[at + 1].params).toEqual([f.name, f.checksum]);
    }
    expect(migrationFiles()[0]).toBe('001_init.sql');
    expect(migrationFiles()).toContain('018_platform.sql');
  });

  it('releases the lock and closes the connection when a migration fails', async () => {
    failOn = 'CREATE';
    await expect(runMigrations('postgres://unused')).rejects.toThrow('boom');
    const sql = calls.map((c) => c.sql);
    expect(sql.at(-2)).toContain('pg_advisory_unlock');
    expect(sql.at(-1)).toBe('END');
  });

  describe('with a separate app role (MIGRATION_DATABASE_URL)', () => {
    const APP = 'postgres://ce_app:s3cr%27et@/collect_earth_cloud?host=/cloudsql/p:r:i';
    const ROLE = 'FROM pg_roles r WHERE r.rolname';
    const owner = (name = 'ce') => ({ 'SELECT current_user': [{ name }] });
    const plain = { rolsuper: false, rolbypassrls: false, rolcreaterole: false, member_of_privileged: false };
    const ok = { 'bool_or(pg_has_role': [{ owns: false }], has_schema_privilege: [{ can_create: false }] };
    const alter = { "format('ALTER ROLE": [{ sql: 'ALTER ROLE "ce_app" PASSWORD ...' }] };
    const VERIFIER = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/;
    // Everything sent to Postgres: every query and every parameter.
    const sent = () => JSON.stringify(calls);

    it('creates a missing role with a SCRAM verifier (never the password), grants it the tables, and never logs the password', async () => {
      answers = { ...owner(), "format('CREATE ROLE": [{ sql: 'CREATE ROLE "ce_app" LOGIN PASSWORD ...' }], ...ok };
      const logged: string[] = [];
      await runMigrations('postgres://ce:pw@/db', (m) => logged.push(m), { appDatabaseUrl: APP });
      const sql = calls.map((c) => c.sql);
      const format = calls.find((c) => c.sql.includes("format('CREATE ROLE"))!;
      expect(format.params![0]).toBe('ce_app');
      expect(format.params![1]).toMatch(VERIFIER);
      expect(format.sql).toContain('NOSUPERUSER NOBYPASSRLS');
      expect(sent()).not.toContain('s3cr');
      expect(sql).toContain('CREATE ROLE "ce_app" LOGIN PASSWORD ...');
      expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "ce_app"');
      expect(sql).toContain('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "ce_app"');
      // Tables and sequences the owner creates later are the app role's to use too.
      expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "ce" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "ce_app"');
      expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "ce" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "ce_app"');
      // schema_migrations is the owner's to write: the app role only reads it, taken back after
      // the blanket grant on every boot.
      const revoke = sql.indexOf('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM "ce_app"');
      expect(revoke).toBeGreaterThan(sql.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "ce_app"'));
      expect(revoke).toBeGreaterThan(sql.findIndex((q) => q.includes('ALTER DEFAULT PRIVILEGES') && q.includes('ON TABLES')));
      // The progress links' lookup (021, not PUBLIC) is the app role's to call.
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION share_link_lookup(TEXT) TO "ce_app"');
      // Inside the lock, after the migrations.
      expect(sql.indexOf('GRANT USAGE ON SCHEMA public TO "ce_app"')).toBeLessThan(sql.findIndex((q) => q.includes('pg_advisory_unlock')));
      expect(logged.join(' ')).not.toContain('s3cr');
      expect(logged).toContain('Database role ce_app created.');
    });

    it('sets a fresh verifier on an existing plain role, so DATABASE_URL is the source of truth', async () => {
      answers = { ...owner(), [ROLE]: [plain], ...alter, ...ok };
      await runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: APP });
      expect(calls.some((c) => c.sql.includes('CREATE ROLE'))).toBe(false);
      const format = calls.find((c) => c.sql.includes("format('ALTER ROLE %I PASSWORD %L'"))!;
      expect(format.params![0]).toBe('ce_app');
      expect(format.params![1]).toMatch(VERIFIER);
      expect(calls.map((c) => c.sql)).toContain('ALTER ROLE "ce_app" PASSWORD ...');
      expect(sent()).not.toContain('s3cr');
      expect(calls.some((c) => c.sql.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE'))).toBe(true);
    });

    it('reads the user and password from the query string too', async () => {
      answers = { ...owner(), [ROLE]: [plain], ...alter, ...ok };
      await runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: 'postgres:///db?host=/cloudsql/p:r:i&user=ce_q&password=qpw' });
      expect(calls.find((c) => c.sql.includes(ROLE))!.params).toEqual(['ce_q']);
      expect(calls.find((c) => c.sql.includes("format('ALTER ROLE"))!.params![1]).toMatch(VERIFIER);
      expect(sent()).not.toContain('qpw');
    });

    it('refuses a role that Row-Level Security would not bind, before changing it', async () => {
      const refused: [Record<string, unknown>, RegExp][] = [
        [{ ...plain, rolsuper: true }, /superuser/],
        [{ ...plain, rolbypassrls: true }, /bypass Row-Level Security/],
        [{ ...plain, rolcreaterole: true }, /CREATEROLE/],
        [{ ...plain, member_of_privileged: true }, /member of a role/],
      ];
      for (const [row, message] of refused) {
        calls.length = 0;
        answers = { ...owner(), [ROLE]: [row], ...alter, ...ok };
        await expect(runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: APP })).rejects.toThrow(message);
        expect(calls.some((c) => c.sql.includes('ALTER ROLE') || c.sql.startsWith('GRANT'))).toBe(false);
        expect(calls.at(-2)!.sql).toContain('pg_advisory_unlock');
      }
      calls.length = 0;
      answers = { ...owner(), [ROLE]: [plain], ...alter, ...ok, 'bool_or(pg_has_role': [{ owns: true }] };
      await expect(runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: APP })).rejects.toThrow(/owns the tables/);
      expect(calls.some((c) => c.sql.startsWith('GRANT'))).toBe(false);
    });

    it('refuses a role that may create objects in schema public (Postgres 14 and older), saying how to fix it', async () => {
      answers = { ...owner(), [ROLE]: [plain], ...alter, ...ok, has_schema_privilege: [{ can_create: true }] };
      await expect(runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: APP })).rejects.toThrow(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
      expect(calls.some((c) => c.sql.startsWith('GRANT'))).toBe(false);
    });

    it('needs a password to create a missing role', async () => {
      answers = { ...owner(), ...ok };
      await expect(runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: 'postgres://ce_app@/db' })).rejects.toThrow(/no password/);
    });

    it('only warns when both URLs use the same role', async () => {
      answers = owner('ce_app');
      const logged: string[] = [];
      await runMigrations('postgres://ce_app:pw@/db', (m) => logged.push(m), { appDatabaseUrl: APP });
      expect(calls.some((c) => c.sql.startsWith('GRANT'))).toBe(false);
      expect(logged.at(-1)).toMatch(/same role \(ce_app\)/);
    });
  });
});

describe('credentialsOf', () => {
  it('reads the user and password of TCP and socket URLs, also from the query string', () => {
    expect(credentialsOf('postgres://ce_app:p%40ss@localhost:5432/db')).toEqual({ user: 'ce_app', password: 'p@ss' });
    expect(credentialsOf('postgresql://ce_app:pw@/db?host=/cloudsql/a:b:c')).toEqual({ user: 'ce_app', password: 'pw' });
    expect(credentialsOf('postgres:///db?host=/cloudsql/a:b:c&user=ce_q&password=p%26w')).toEqual({ user: 'ce_q', password: 'p&w' });
    expect(credentialsOf('postgres://ce_app@host/db')).toEqual({ user: 'ce_app', password: null });
    expect(credentialsOf('postgres://host/db')).toBeNull();
    expect(credentialsOf('mysql://u:p@host/db')).toBeNull();
  });
});
