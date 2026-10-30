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

const { credentialsOf, runMigrations } = await import('../src/store/migrate.js');

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
    const owner = (name = 'ce') => ({ 'SELECT current_user': [{ name }] });

    it('creates a missing role with the password of DATABASE_URL, grants it the tables, and never logs the password', async () => {
      answers = { ...owner(), "format('CREATE ROLE": [{ sql: 'CREATE ROLE "ce_app" LOGIN PASSWORD ...' }], 'bool_or(pg_has_role': [{ owns: false }] };
      const logged: string[] = [];
      await runMigrations('postgres://ce:pw@/db', (m) => logged.push(m), { appDatabaseUrl: APP });
      const sql = calls.map((c) => c.sql);
      const format = calls.find((c) => c.sql.includes("format('CREATE ROLE"))!;
      expect(format.params).toEqual(['ce_app', "s3cr'et"]);
      expect(format.sql).toContain('NOSUPERUSER NOBYPASSRLS');
      expect(sql).toContain('CREATE ROLE "ce_app" LOGIN PASSWORD ...');
      expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "ce_app"');
      expect(sql).toContain('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "ce_app"');
      // Inside the lock, after the migrations.
      expect(sql.indexOf('GRANT USAGE ON SCHEMA public TO "ce_app"')).toBeLessThan(sql.findIndex((q) => q.includes('pg_advisory_unlock')));
      expect(logged.join(' ')).not.toContain("s3cr'et");
      expect(logged).toContain('Database role ce_app created.');
    });

    it('keeps an existing plain role as it is and grants it the tables', async () => {
      answers = { ...owner(), 'FROM pg_roles WHERE rolname': [{ rolsuper: false, rolbypassrls: false }], 'bool_or(pg_has_role': [{ owns: false }] };
      await runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: APP });
      expect(calls.some((c) => c.sql.includes('CREATE ROLE'))).toBe(false);
      expect(calls.some((c) => c.sql.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE'))).toBe(true);
    });

    it('refuses a role that Row-Level Security would not bind', async () => {
      answers = { ...owner(), 'FROM pg_roles WHERE rolname': [{ rolsuper: false, rolbypassrls: true }] };
      await expect(runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: APP })).rejects.toThrow(/bypass Row-Level Security/);
      answers = { ...owner(), 'FROM pg_roles WHERE rolname': [{ rolsuper: false, rolbypassrls: false }], 'bool_or(pg_has_role': [{ owns: true }] };
      await expect(runMigrations('postgres://ce:pw@/db', () => {}, { appDatabaseUrl: APP })).rejects.toThrow(/owns the tables/);
      expect(calls.some((c) => c.sql.startsWith('GRANT'))).toBe(false);
      expect(calls.at(-2)!.sql).toContain('pg_advisory_unlock');
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
  it('reads the user and password of TCP and socket URLs', () => {
    expect(credentialsOf('postgres://ce_app:p%40ss@localhost:5432/db')).toEqual({ user: 'ce_app', password: 'p@ss' });
    expect(credentialsOf('postgresql://ce_app:pw@/db?host=/cloudsql/a:b:c')).toEqual({ user: 'ce_app', password: 'pw' });
    expect(credentialsOf('postgres://ce_app@host/db')).toEqual({ user: 'ce_app', password: null });
    expect(credentialsOf('postgres://host/db')).toBeNull();
    expect(credentialsOf('mysql://u:p@host/db')).toBeNull();
  });
});
