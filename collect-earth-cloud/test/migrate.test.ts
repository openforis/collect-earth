import { describe, expect, it, vi, beforeEach } from 'vitest';

// Every query run by runMigrations, in order, tagged with the client that ran it.
const calls: { client: number; sql: string; params?: unknown[] }[] = [];
let clients = 0;
let failOn: string | null = null;
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
      if (failOn && sql.includes(failOn)) {
        throw new Error('boom');
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

const { credentialsOf, migrationFiles, runMigrations } = await import('../src/store/migrate.js');

describe('runMigrations', () => {
  beforeEach(() => {
    calls.length = 0;
    clients = 0;
    failOn = null;
    answers = {};
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
    // Then what ran is recorded (schema_migrations), still under the lock, with every file.
    const recorded = calls.at(-3)!;
    expect(recorded.sql).toContain('INSERT INTO schema_migrations');
    expect(recorded.params![0]).toEqual(migrationFiles());
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
