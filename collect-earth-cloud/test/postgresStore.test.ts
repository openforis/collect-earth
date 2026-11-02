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
          if (sql.includes('records_version')) return { rows: [{ records_version: '7' }], rowCount: 1 };
          if (sql.includes('FROM project_tokens')) return { rows: [{ project_id: PROJECT }, { project_id: PROJECT_B }], rowCount: 2 };
          if (sql.includes('FROM records WHERE')) return { rows: [{ bytes: '10' }], rowCount: 1 };
          // Was the record submitted before (asked by itself when it has no row yet).
          if (sql.includes('AS submitted_before') && !sql.includes('FROM records')) return { rows: [{ submitted_before: true }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    }
    // Global tables (users, sessions) are read on the pool itself, with no project setting.
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql: `POOL ${sql}`, params });
      if (sql.includes('AS admins')) return { rows: [{ total: 3, disabled: 1, admins: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
    async end() {}
  }
  return { default: { Pool } };
});

const { PostgresStore } = await import('../src/store/postgres.js');
const { InvalidCursorError } = await import('../src/store/store.js');
const PROJECT = '00000000-0000-0000-0000-000000000001';
const PROJECT_B = '00000000-0000-0000-0000-000000000002';

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

  it('setDivision (and so move-unfinished) takes the check sampling lock before touching the holdings', async () => {
    await new PostgresStore('postgres://x').setDivision(PROJECT, '00000000-0000-0000-0000-0000000000f1', { mode: 'manual' }, []);
    const sqls = queries.map((q) => q.sql);
    const lock = sqls.findIndex((s) => s.includes("'collect-earth-cloud:sampling:'"));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(sqls.findIndex((s) => s.startsWith('DELETE FROM plot_assignments')));
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

  it("deleteProject deletes the activity data under the project's setting, member_activity before the members", async () => {
    await new PostgresStore('postgres://x').deleteProject(PROJECT);
    const deleted = queries.filter((q) => q.sql.startsWith('DELETE FROM')).map((q) => q.sql.split(' ')[2]);
    for (const table of ['record_events', 'member_activity', 'audit_log', 'attention_reads', 'sampling_rules']) {
      expect(deleted).toContain(table);
    }
    expect(deleted.indexOf('member_activity')).toBeLessThan(deleted.indexOf('project_members'));
  });

  it('removeMember drops their activity and keeps their audit entries with no actor', async () => {
    await new PostgresStore('postgres://x').removeMember(PROJECT, '00000000-0000-0000-0000-0000000000aa');
    const sqls = queries.map((q) => q.sql);
    expect(sqls.some((s) => s.startsWith('DELETE FROM member_activity'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('DELETE FROM attention_reads'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('UPDATE audit_log SET actor_user_id = NULL'))).toBe(true);
    expect(sqls.findIndex((s) => s.startsWith('DELETE FROM member_activity'))).toBeLessThan(
      sqls.findIndex((s) => s.startsWith('DELETE FROM project_members')),
    );
  });

  it('writes member activity only for a member, and pages events by (time, id)', async () => {
    const store = new PostgresStore('postgres://x');
    await store.touchMemberActivity(PROJECT, '00000000-0000-0000-0000-0000000000aa', { lastSeenAt: 1 });
    expect(queries.find((q) => q.sql.includes('INSERT INTO member_activity'))!.sql).toContain('WHERE EXISTS (SELECT 1 FROM project_members');
    await store.touchMemberActivity(PROJECT, 'not-a-uuid', { lastSeenAt: 1 });
    expect(queries.filter((q) => q.sql.includes('INSERT INTO member_activity'))).toHaveLength(1);
    await store.listRecordEvents(PROJECT, { from: 0, to: 10, limit: 5, operator: 'maria', before: { at: 5, id: '7' } });
    const list = queries.find((q) => q.sql.includes('FROM record_events'))!;
    expect(list.sql).toContain('(modified_on, id) < ($6::timestamptz, $7::bigint)');
    expect(list.params).toEqual([PROJECT, new Date(0), new Date(10), 5, 'maria', new Date(5), '7']);
  });

  it('putRecordWithEvent stores the record and its event in one transaction, after the record lock and the locked read', async () => {
    const store = new PostgresStore('postgres://x');
    const seen: unknown[] = [];
    const stored = await store.putRecordWithEvent(PROJECT, 'k', 'maria', (existing, submittedBefore) => {
      seen.push([existing, submittedBefore]);
      const row = { projectId: PROJECT, recordKey: 'k', operator: 'maria', modifiedOn: 1, receivedAt: 2, activelySaved: true, step: 1, xml: null, summary: {}, deleted: false, deletedOn: null };
      return { row, event: { ...row, change: 'resubmitted' as const, summary: {} } };
    });
    expect(stored).toBe(true);
    expect(seen).toEqual([[null, true]]);
    const sqls = queries.map((q) => q.sql.trim().split(/\s+/).slice(0, 3).join(' '));
    expect(sqls.filter((q) => q === 'BEGIN')).toHaveLength(1);
    const at = (prefix: string) => queries.findIndex((q) => q.sql.trim().startsWith(prefix));
    expect(queries[at('SELECT pg_advisory_xact_lock')].params).toEqual([PROJECT, 'k', 'maria']);
    expect(queries.find((q) => q.sql.includes('FROM records'))!.sql).toContain('FOR UPDATE');
    expect(at('SELECT pg_advisory_xact_lock')).toBeLessThan(at('SELECT project_id, record_key'));
    expect(at('INSERT INTO records')).toBeLessThan(at('INSERT INTO record_events'));
    expect(at('INSERT INTO record_events')).toBeLessThan(at('COMMIT'));

    queries.length = 0;
    expect(await store.putRecordWithEvent(PROJECT, 'k', 'maria', () => null)).toBe(false);
    expect(queries.some((q) => q.sql.includes('INSERT INTO'))).toBe(false);
  });

  it('refuses a cursor that is no cursor before querying, as the memory store does', async () => {
    const store = new PostgresStore('postgres://x');
    await expect(store.listRecordEvents(PROJECT, { from: 0, to: 1, limit: 1, before: { at: 1, id: '1; DROP' } })).rejects.toThrow(InvalidCursorError);
    await expect(store.listAudit(PROJECT, { limit: 1, before: { at: 1, id: '99999999999999999999' } })).rejects.toThrow(InvalidCursorError);
    // Times Postgres's timestamptz cannot hold (a 500 before): refused before any query.
    const asked = queries.length;
    await expect(store.listRecordEvents(PROJECT, { from: 0, to: 1, limit: 1, before: { at: 9e15, id: '1' } })).rejects.toThrow(InvalidCursorError);
    await expect(store.listAudit(PROJECT, { limit: 1, before: { at: -3e14, id: '1' } })).rejects.toThrow(InvalidCursorError);
    await expect(store.listRecordEvents(PROJECT, { from: 0, to: 9e15, limit: 1 })).rejects.toThrow(InvalidCursorError);
    await expect(store.listAudit(PROJECT, { limit: 1, from: -8e15 })).rejects.toThrow(InvalidCursorError);
    expect(queries.length).toBe(asked);
    expect(queries).toHaveLength(0);
  });

  it("getRecordXml reads the asked records' XML in one query under the project's setting, and nothing for no keys", async () => {
    const store = new PostgresStore('postgres://x');
    expect(await store.getRecordXml(PROJECT, [])).toEqual([]);
    expect(queries).toHaveLength(0);
    await store.getRecordXml(PROJECT, [
      { recordKey: '1,1', operator: 'ana' },
      { recordKey: '1,2', operator: 'ben' },
    ]);
    const setting = queries.findIndex((q) => q.params?.[0] === 'app.current_project' && q.params[1] === PROJECT);
    const read = queries.findIndex((q) => q.sql.includes('r.xml'));
    expect(setting).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(setting);
    expect(queries[read].sql).toMatch(/SELECT r\.record_key, r\.operator, r\.step, r\.xml\s+FROM records r\s+JOIN \(SELECT DISTINCT \* FROM unnest/);
    expect(queries[read].params).toEqual([PROJECT, ['1,1', '1,2'], ['ana', 'ben']]);
  });

  it('reads the quality version from the project counter the triggers bump', async () => {
    await new PostgresStore('postgres://x').qualityVersion(PROJECT);
    const read = queries.find((q) => q.sql.includes('records_version'))!;
    expect(read.sql).not.toMatch(/hashtextextended|count\(/);
  });

  it("platformStats reads each project's data under that project's setting, read-only, and accounts as counts", async () => {
    const stats = await new PostgresStore('postgres://x').platformStats({ activeSince: 0, signupsFrom: 0, receivedFrom: 0 });
    expect(stats).toMatchObject({ users: 3, disabledUsers: 1, platformAdmins: 1, activeUsers: 0 });
    expect(stats.projects).toEqual([
      { projectId: PROJECT, storageBytes: 10, active: false },
      { projectId: PROJECT_B, storageBytes: 10, active: false },
    ]);
    const sqls = queries.map((q) => q.sql);
    expect(sqls[sqls.findIndex((s) => !s.startsWith('POOL'))]).toBe('BEGIN READ ONLY');
    // Every project-scoped read comes after its own project's setting.
    let current: unknown = null;
    for (const q of queries) {
      if (q.params?.[0] === 'app.current_project') current = q.params[1];
      for (const table of ['member_activity', 'record_events', 'records', 'csv_files', 'project_ceps']) {
        if (q.sql.includes(`FROM ${table} WHERE`)) {
          expect(q.params![0]).toBe(current);
        }
      }
    }
    // users and sessions only on the pool, as counts or ids that never leave the store.
    expect(sqls.filter((s) => /FROM (users|sessions)/.test(s)).every((s) => s.startsWith('POOL'))).toBe(true);
  });

  it('disableUser takes the platform admins lock before reading the account, and stops at an unknown one', async () => {
    const store = new PostgresStore('postgres://x');
    expect(await store.disableUser('not-a-uuid', PROJECT)).toBe('not_found');
    expect(queries).toHaveLength(0);
    expect(await store.disableUser('00000000-0000-0000-0000-0000000000aa', PROJECT)).toBe('not_found');
    const sqls = queries.map((q) => q.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toContain('pg_advisory_xact_lock');
    expect(sqls[2]).toContain('FOR UPDATE');
    expect(sqls.at(-1)).toBe('ROLLBACK');
  });

  it('deleteUser counts the enabled platform admins again under the same lock, before deleting anything', async () => {
    await new PostgresStore('postgres://x').deleteUser('00000000-0000-0000-0000-0000000000aa');
    const sqls = queries.map((q) => q.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toContain("hashtext('collect-earth-cloud:platform-admins')");
    expect(sqls[2]).toContain('FOR UPDATE');
    expect(sqls.findIndex((s) => s.startsWith('DELETE'))).toBeGreaterThan(2);
  });

  it('createPasswordReset makes a link only for an enabled account, in one statement', async () => {
    expect(await new PostgresStore('postgres://x').createPasswordReset('00000000-0000-0000-0000-0000000000aa', 1)).toBeNull();
    const insert = queries.find((q) => q.sql.includes('INSERT INTO password_resets'))!;
    expect(insert.sql).toMatch(/SELECT \$1, id, \$3 FROM users WHERE id = \$2 AND disabled_at IS NULL/);
  });
});
