import { describe, expect, it, vi, beforeEach } from 'vitest';

// Every query run by runMigrations, in order, tagged with the client that ran it.
const calls: { client: number; sql: string }[] = [];
let clients = 0;
let failOn: string | null = null;

vi.mock('pg', () => {
  class Client {
    private readonly id = ++clients;
    async connect(): Promise<void> {
      calls.push({ client: this.id, sql: 'CONNECT' });
    }
    async query(sql: string): Promise<void> {
      calls.push({ client: this.id, sql });
      if (failOn && sql.includes(failOn)) {
        throw new Error('boom');
      }
    }
    async end(): Promise<void> {
      calls.push({ client: this.id, sql: 'END' });
    }
  }
  return { default: { Client } };
});

const { runMigrations } = await import('../src/store/migrate.js');

describe('runMigrations', () => {
  beforeEach(() => {
    calls.length = 0;
    clients = 0;
    failOn = null;
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
});
