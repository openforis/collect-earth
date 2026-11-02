import { describe, expect, it } from 'vitest';
import { attentionKey, decodeLogCursor, encodeLogCursor, kindFilter, LOG_START, logPage, type LogCursor, type LogSources } from '../src/activityLog.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { AuditEntry, RecordEvent } from '../src/types.js';

/** Both lists over plain arrays, as the stores order them (time, then id, newest first). */
function sources(events: RecordEvent[], audit: AuditEntry[]): LogSources {
  const before = (at: number, id: string, c?: { at: number; id: string }) => c === undefined || at < c.at || (at === c.at && Number(id) < Number(c.id));
  const desc = <T extends { id: string }>(time: (x: T) => number) => (a: T, b: T) => time(b) - time(a) || Number(b.id) - Number(a.id);
  return {
    events: async (c, limit) => events.filter((e) => before(e.modifiedOn, e.id, c)).sort(desc((e) => e.modifiedOn)).slice(0, limit),
    audit: async (c, limit) => audit.filter((a) => before(a.at, a.id, c)).sort(desc((a) => a.at)).slice(0, limit),
  };
}

const ev = (id: number, at: number): RecordEvent => ({
  id: String(id),
  projectId: 'p',
  recordKey: String(id),
  operator: 'maria',
  modifiedOn: at,
  receivedAt: at,
  activelySaved: true,
  step: 0,
  deleted: false,
  change: 'submitted',
  summary: null,
});
const au = (id: number, at: number): AuditEntry => ({ id: String(id), projectId: 'p', at, actorUserId: null, actor: null, action: 'csv.uploaded', details: {} });

async function readAll(src: LogSources, limit: number, use = { events: true, audit: true }) {
  const out: string[] = [];
  let cursor: LogCursor | null = LOG_START;
  let pages = 0;
  while (cursor !== null) {
    // Each cursor goes through its text, as the dashboard sends it back.
    const page = await logPage(src, decodeLogCursor(encodeLogCursor(cursor))!, limit, use);
    out.push(...page.rows.map((r) => (r.source === 'event' ? `e${r.event.id}@${r.at}` : `a${r.entry.id}@${r.at}`)));
    cursor = page.next;
    pages += 1;
    if (pages > 100) throw new Error('no end');
  }
  return { out, pages };
}

describe('the activity log: both lists merged, newest first, paged by a cursor of both positions', () => {
  // Many rows at the same times in both lists, ids not in time order.
  const events = [ev(1, 100), ev(2, 300), ev(3, 300), ev(4, 300), ev(9, 200), ev(5, 500), ev(6, 50), ev(7, 300)];
  const audit = [au(11, 300), au(12, 300), au(13, 400), au(14, 100), au(15, 300), au(16, 600)];
  const expected = ['a16@600', 'e5@500', 'a13@400', 'a15@300', 'a12@300', 'a11@300', 'e7@300', 'e4@300', 'e3@300', 'e2@300', 'e9@200', 'a14@100', 'e1@100', 'e6@50'];

  it('every row once, in order, whatever the page size (rows at the same time across pages included)', async () => {
    for (const limit of [1, 2, 3, 4, 5, 7, 13, 14, 50]) {
      const { out, pages } = await readAll(sources(events, audit), limit);
      expect(out, `limit ${limit}`).toEqual(expected);
      // At most one page more than full pages (an empty last page when the rows end on a page's end).
      expect(pages).toBeLessThanOrEqual(Math.ceil(expected.length / limit) + 1);
    }
  });

  it('one list alone; empty lists; the last page has no next', async () => {
    expect((await readAll(sources(events, audit), 3, { events: true, audit: false })).out).toEqual(expected.filter((x) => x.startsWith('e')));
    expect((await readAll(sources(events, audit), 3, { events: false, audit: true })).out).toEqual(expected.filter((x) => x.startsWith('a')));
    const none = await logPage(sources([], []), LOG_START, 10, { events: true, audit: true });
    expect(none).toEqual({ rows: [], next: null });
    const last = await logPage(sources(events, audit), LOG_START, 50, { events: true, audit: true });
    expect(last.rows).toHaveLength(14);
    expect(last.next).toBeNull();
  });

  it('rows added at the top meanwhile do not move the next pages', async () => {
    const list = [...events];
    const src = sources(list, audit);
    const first = await logPage(src, LOG_START, 4, { events: true, audit: true });
    list.push(ev(20, 900));
    const rest = await readAll({ events: src.events, audit: src.audit }, 4);
    // Read from the first page's cursor instead of the start.
    const out: string[] = first.rows.map((r) => (r.source === 'event' ? `e${r.event.id}@${r.at}` : `a${r.entry.id}@${r.at}`));
    let cursor = first.next;
    while (cursor) {
      const page = await logPage(src, cursor, 4, { events: true, audit: true });
      out.push(...page.rows.map((r) => (r.source === 'event' ? `e${r.event.id}@${r.at}` : `a${r.entry.id}@${r.at}`)));
      cursor = page.next;
    }
    expect(out).toEqual(expected);
    expect(rest.out[0]).toBe('e20@900');
  });

  it('cursors: the text form round-trips; anything else is refused', () => {
    const c: LogCursor = { events: { at: 1_793_600_000_000, id: '42' }, audit: 'end' };
    expect(encodeLogCursor(c)).toBe('1793600000000.42_e');
    expect(decodeLogCursor('1793600000000.42_e')).toEqual(c);
    expect(decodeLogCursor('s_s')).toEqual(LOG_START);
    for (const bad of ['', 's', 's_s_s', 'x_s', '1.2.3_s', '12_s', '1.a_s', `1.${'9'.repeat(19)}_s`, 5, null]) expect(decodeLogCursor(bad), String(bad)).toBeNull();
  });

  it('kinds: all, Collect Earth only, coordinators only, and their groups', () => {
    expect(kindFilter('all')).toEqual({ changes: undefined, actions: undefined });
    expect(kindFilter('records')).toEqual({ changes: undefined, actions: false });
    expect(kindFilter('coordinators')).toEqual({ changes: false, actions: undefined });
    expect(kindFilter('draft')).toEqual({ changes: ['created', 'updated'], actions: false });
    expect(kindFilter('decisions')).toEqual({ changes: false, actions: ['decision.set', 'decision.deleted', 'decision.bulk'] });
  });

  it('through the memory store: kinds, person and date window', async () => {
    const store = new InMemoryStore();
    const { projectId } = await store.createProject({ name: 'Log' });
    const e = (id: number, at: number, change: RecordEvent['change'], operator = 'maria') =>
      store.appendRecordEvent({ ...ev(id, at), projectId, operator, change, summary: null });
    await e(1, 1000, 'created');
    await e(2, 2000, 'updated');
    await e(3, 3000, 'submitted');
    await e(4, 4000, 'submitted', 'ana');
    await e(5, 5000, 'deleted');
    const page = await store.listRecordEvents(projectId, { from: 1500, to: 5000, changes: ['created', 'updated', 'submitted'], operator: 'maria', limit: 10 });
    expect(page.map((x) => x.modifiedOn)).toEqual([3000, 2000]);
    await store.appendAudit(projectId, { actorUserId: null, action: 'csv.uploaded', details: {} });
    await store.appendAudit(projectId, { actorUserId: null, action: 'decision.set', details: { plot: '1', decision: 'first' } });
    const now = Date.now();
    expect((await store.listAudit(projectId, { limit: 10, actions: ['decision.set', 'decision.bulk'] })).map((a) => a.action)).toEqual(['decision.set']);
    expect(await store.listAudit(projectId, { limit: 10, from: now + 60_000 })).toEqual([]);
    expect(await store.listAudit(projectId, { limit: 10, to: now - 60_000 })).toEqual([]);
    expect(await store.listAudit(projectId, { limit: 10, from: now - 60_000, to: now + 60_000 })).toHaveLength(2);
  });
});

describe('the bell: an item read stays read until what it says changes', () => {
  it('the same people and count give the same key; another person, count or level another; times do not count', () => {
    const quiet = (people: string[], lastSyncAt = 1) => ({ kind: 'quiet' as const, count: people.length, quietDays: 3, people: people.map((username) => ({ username, lastSyncAt, lastPlotsDownloadAt: null })) });
    expect(attentionKey(quiet(['ana', 'ben']))).toBe(attentionKey(quiet(['ben', 'ana'], 99)));
    expect(attentionKey(quiet(['ana', 'ben']))).not.toBe(attentionKey(quiet(['ana', 'cai'])));
    expect(attentionKey(quiet(['ana']))).toMatch(/^quiet:[0-9a-f]{16}$/);
    const storage = (level: 'nearlyFull' | 'over', usedBytes: number) => ({ kind: 'storage' as const, count: 1, level, usedBytes, limitBytes: 100 });
    expect(attentionKey(storage('nearlyFull', 91))).toBe(attentionKey(storage('nearlyFull', 95)));
    expect(attentionKey(storage('nearlyFull', 91))).not.toBe(attentionKey(storage('over', 101)));
    expect(attentionKey({ kind: 'differencesWaiting', count: 4 })).not.toBe(attentionKey({ kind: 'differencesWaiting', count: 5 }));
  });
});
