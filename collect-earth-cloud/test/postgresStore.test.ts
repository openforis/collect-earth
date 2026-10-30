import { afterEach, describe, expect, it, vi } from 'vitest';

// A stand-in for pg's Pool: the options it was made with, its listeners, and every
// query run on its clients, in order.
const pools: { options: Record<string, unknown>; listeners: Map<string, (err: Error) => void> }[] = [];
const queries: { sql: string; params?: unknown[] }[] = [];
// Queries containing `match` throw a Postgres error with `code`, `times` times.
const failing: { match: string; code: string; times: number } = { match: '', code: '', times: 0 };

vi.mock('pg', () => {
  class Pool {
    private readonly listeners = new Map<string, (err: Error) => void>();
    constructor(options: Record<string, unknown>) {
      pools.push({ options, listeners: this.listeners });
    }
    on(event: string, listener: (err: Error) => void) {
      this.listeners.set(event, listener);
      return this;
    }
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          queries.push({ sql, params });
          if (failing.times > 0 && failing.match && sql.includes(failing.match)) {
            failing.times -= 1;
            throw Object.assign(new Error('deadlock detected'), { code: failing.code });
          }
          return { rows: sql.includes('records_version') ? [{ records_version: '7' }] : [], rowCount: 0 };
        },
        release() {},
      };
    }
    async end() {}
  }
  return { default: { Pool } };
});

const { PostgresStore } = await import('../src/store/postgres.js');
const PROJECT = '00000000-0000-0000-0000-000000000001';

describe('PostgresStore pool', () => {
  afterEach(() => {
    pools.length = 0;
    queries.length = 0;
    vi.restoreAllMocks();
  });

  it('passes the pool size and connection timeout to the pool', () => {
    new PostgresStore('postgres://x', { max: 2, connectionTimeoutMillis: 10_000 });
    expect(pools[0].options).toMatchObject({ connectionString: 'postgres://x', max: 2, connectionTimeoutMillis: 10_000 });
  });

  it('logs an idle connection that fails instead of crashing the process', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    new PostgresStore('postgres://x');
    pools[0].listeners.get('error')!(new Error('connection reset'));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0].join(' '))).toContain('connection reset');

    const seen: unknown[] = [];
    new PostgresStore('postgres://x', { onPoolError: (err) => seen.push(err) });
    pools[1].listeners.get('error')!(new Error('gone'));
    expect(seen).toHaveLength(1);
  });

  it('sets a statement timeout in each transaction when asked to', async () => {
    const store = new PostgresStore('postgres://x', { statementTimeoutMs: 90_000 });
    expect(await store.qualityVersion(PROJECT)).toBe('7');
    expect(queries[0].sql).toBe('BEGIN');
    expect(queries.some((q) => q.sql.includes("set_config('statement_timeout'") && q.params?.includes('90000'))).toBe(true);

    queries.length = 0;
    await new PostgresStore('postgres://x').qualityVersion(PROJECT);
    expect(queries.some((q) => q.sql.includes('statement_timeout'))).toBe(false);
  });

  it('deleteProject retries a deadlock after a random pause of 10-50 ms, at most three times', async () => {
    const pauses: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      pauses.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as typeof setTimeout);
    Object.assign(failing, { match: 'FOR UPDATE', code: '40P01', times: 2 });
    await new PostgresStore('postgres://x').deleteProject(PROJECT);
    expect(pauses).toHaveLength(2);
    expect(pauses.every((ms) => ms >= 10 && ms <= 50)).toBe(true);
    expect(queries.filter((q) => q.sql.startsWith('DELETE FROM projects'))).toHaveLength(1);

    Object.assign(failing, { match: 'FOR UPDATE', code: '40P01', times: 3 });
    await expect(new PostgresStore('postgres://x').deleteProject(PROJECT)).rejects.toMatchObject({ code: '40P01' });
    Object.assign(failing, { match: 'FOR UPDATE', code: '23505', times: 1 });
    pauses.length = 0;
    await expect(new PostgresStore('postgres://x').deleteProject(PROJECT)).rejects.toMatchObject({ code: '23505' });
    expect(pauses).toHaveLength(0);
    failing.times = 0;
  });

  it('reads the quality version from the project counter the triggers bump', async () => {
    await new PostgresStore('postgres://x').qualityVersion(PROJECT);
    const read = queries.find((q) => q.sql.includes('records_version'))!;
    expect(read.sql).not.toMatch(/hashtextextended|count\(/);
  });
});
