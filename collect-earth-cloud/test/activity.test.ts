import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRecorder, clientAgentOf, MAX_CLIENT_AGENT_CHARS } from '../src/activity.js';
import { recordChange, recordEventOf } from '../src/lww.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { MemberActivityPatch, RecordEventInput, RecordRow } from '../src/types.js';

function row(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    projectId: 'p',
    recordKey: '1',
    operator: 'maria',
    modifiedOn: 1000,
    receivedAt: 5000,
    activelySaved: false,
    step: 1,
    xml: '<r/>',
    summary: { a: '1' },
    deleted: false,
    deletedOn: null,
    ...overrides,
  };
}

describe('recordChange: what a stored upload did', () => {
  it('a first upload is created, or submitted when already actively saved', () => {
    expect(recordChange(null, row())).toBe('created');
    expect(recordChange(null, row({ activelySaved: true }))).toBe('submitted');
  });

  it('a draft saved again is updated; saving it actively submits it', () => {
    expect(recordChange(row(), row({ modifiedOn: 2000 }))).toBe('updated');
    expect(recordChange(row(), row({ modifiedOn: 2000, activelySaved: true }))).toBe('submitted');
  });

  it('a submitted plot saved again is updated, and saved as a draft is unsubmitted', () => {
    const submitted = row({ activelySaved: true });
    expect(recordChange(submitted, row({ modifiedOn: 2000, activelySaved: true }))).toBe('updated');
    expect(recordChange(submitted, row({ modifiedOn: 2000, activelySaved: false }))).toBe('unsubmitted');
  });

  it('a tombstone is deleted; a record coming back after one is created (or submitted) again', () => {
    expect(recordChange(row(), row({ modifiedOn: 2000, deleted: true }))).toBe('deleted');
    expect(recordChange(null, row({ deleted: true }))).toBe('deleted');
    const gone = row({ deleted: true, activelySaved: true });
    expect(recordChange(gone, row({ modifiedOn: 2000 }))).toBe('created');
    expect(recordChange(gone, row({ modifiedOn: 2000, activelySaved: true }))).toBe('submitted');
  });

  it('the same save sent again (a retried batch) changes nothing: no event', () => {
    expect(recordChange(row({ activelySaved: true }), row({ activelySaved: true, receivedAt: 9000 }))).toBeNull();
    expect(recordChange(row({ deleted: true }), row({ deleted: true }))).toBeNull();
  });

  it('the event keeps the answers only when submitted, and never the XML', () => {
    const submitted = recordEventOf(null, row({ activelySaved: true }))!;
    expect(submitted).toEqual({
      projectId: 'p',
      recordKey: '1',
      operator: 'maria',
      modifiedOn: 1000,
      receivedAt: 5000,
      activelySaved: true,
      step: 1,
      deleted: false,
      change: 'submitted',
      summary: { a: '1' },
    });
    expect(recordEventOf(null, row())!.summary).toBeNull();
    expect('xml' in submitted).toBe(false);
  });
});

describe('clientAgentOf', () => {
  it('keeps the raw User-Agent, cut at 200 characters', () => {
    expect(clientAgentOf('CollectEarth/1.21.3 (Windows 11)')).toBe('CollectEarth/1.21.3 (Windows 11)');
    expect(clientAgentOf('x'.repeat(500))).toHaveLength(MAX_CLIENT_AGENT_CHARS);
    expect(clientAgentOf(['a', 'b'])).toBe('a');
    expect(clientAgentOf(undefined)).toBeNull();
    expect(clientAgentOf('')).toBeNull();
  });
});

describe('ActivityRecorder: at most one write per member per minute', () => {
  const writes: { projectId: string; userId: string; patch: MemberActivityPatch }[] = [];
  const store = {
    async touchMemberActivity(projectId: string, userId: string, patch: MemberActivityPatch) {
      writes.push({ projectId, userId, patch });
    },
  };
  let recorder: ActivityRecorder;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    writes.length = 0;
    recorder = new ActivityRecorder(store);
  });

  afterEach(async () => {
    await recorder.close();
    vi.useRealTimers();
  });

  it('writes the first call at once', async () => {
    recorder.note('p', 'u', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual([{ projectId: 'p', userId: 'u', patch: { lastSeenAt: 1_000_000 } }]);
  });

  it('adds up the calls of the next minute in memory and writes them once, a minute after the first write', async () => {
    recorder.note('p', 'u', {});
    await vi.advanceTimersByTimeAsync(10_000);
    recorder.note('p', 'u', { sync: { records: 3 }, clientAgent: 'CE/1' });
    await vi.advanceTimersByTimeAsync(10_000);
    recorder.note('p', 'u', { sync: { records: 2 } });
    await vi.advanceTimersByTimeAsync(10_000);
    recorder.note('p', 'u', { plotsDownload: true, cepDownload: true, clientAgent: 'CE/2' });
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveLength(2);
    expect(writes[1].patch).toEqual({
      lastSeenAt: 1_030_000,
      lastSyncAt: 1_020_000,
      syncs: 2,
      recordsReceived: 5,
      lastPlotsDownloadAt: 1_030_000,
      lastCepDownloadAt: 1_030_000,
      clientAgent: 'CE/2',
    });
    // Nothing pending: no more writes.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(writes).toHaveLength(2);
  });

  it('writes at once again when the last write is more than a minute old', async () => {
    recorder.note('p', 'u', {});
    await vi.advanceTimersByTimeAsync(61_000);
    recorder.note('p', 'u', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map((w) => w.patch.lastSeenAt)).toEqual([1_000_000, 1_061_000]);
  });

  it('keeps each member of each project apart', async () => {
    recorder.note('p', 'u', {});
    recorder.note('p', 'v', {});
    recorder.note('q', 'u', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map((w) => `${w.projectId} ${w.userId}`)).toEqual(['p u', 'p v', 'q u']);
  });

  it('flush and close write what is pending at once', async () => {
    recorder.note('p', 'u', {});
    await vi.advanceTimersByTimeAsync(5_000);
    recorder.note('p', 'u', { sync: { records: 1 } });
    await recorder.close();
    expect(writes).toHaveLength(2);
    expect(writes[1].patch).toMatchObject({ syncs: 1, recordsReceived: 1 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(writes).toHaveLength(2);
  });

  it('a failed write is reported and does not throw into the request', async () => {
    const errors: unknown[] = [];
    const failing = new ActivityRecorder(
      { touchMemberActivity: async () => Promise.reject(new Error('db down')) },
      { onError: (err) => errors.push(err) },
    );
    failing.note('p', 'u', {});
    await failing.flush();
    expect(String(errors[0])).toContain('db down');
    await failing.close();
  });
});

describe('the memory store: record events, member activity and the audit log', () => {
  let store: InMemoryStore;
  let a: string;
  let b: string;
  let maria: string;
  let jose: string;

  const event = (projectId: string, overrides: Partial<RecordEventInput> = {}): RecordEventInput => ({
    projectId,
    recordKey: '1',
    operator: 'maria',
    modifiedOn: 1000,
    receivedAt: 2000,
    activelySaved: true,
    step: 1,
    deleted: false,
    change: 'submitted',
    summary: { a: '1' },
    ...overrides,
  });

  beforeEach(async () => {
    store = new InMemoryStore();
    a = (await store.createProject({ name: 'A' })).projectId;
    b = (await store.createProject({ name: 'B' })).projectId;
    maria = (await store.createUser({ username: 'maria', passwordHash: 'x', email: null })).id;
    jose = (await store.createUser({ username: 'jose', passwordHash: 'x', email: null })).id;
    await store.addMembership(a, maria, 'operator');
    await store.addMembership(a, jose, 'admin');
    await store.addMembership(b, maria, 'operator');
  });

  it('lists record events newest first, in the window, by operator, paged by cursor', async () => {
    for (const [key, at, operator] of [['1', 1000, 'maria'], ['2', 3000, 'jose'], ['3', 3000, 'maria'], ['4', 5000, 'maria'], ['5', 9000, 'maria']] as const) {
      await store.appendRecordEvent(event(a, { recordKey: key, modifiedOn: at, operator }));
    }
    const all = await store.listRecordEvents(a, { from: 1000, to: 9000, limit: 10 });
    expect(all.map((e) => e.recordKey)).toEqual(['4', '3', '2', '1']);
    expect(all[0]).toMatchObject({ projectId: a, change: 'submitted', summary: { a: '1' } });
    expect((await store.listRecordEvents(a, { from: 0, to: 10_000, operator: 'jose', limit: 10 })).map((e) => e.recordKey)).toEqual(['2']);
    const page1 = await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 2 });
    expect(page1.map((e) => e.recordKey)).toEqual(['5', '4']);
    const page2 = await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 2, before: { at: page1[1].modifiedOn, id: page1[1].id } });
    expect(page2.map((e) => e.recordKey)).toEqual(['3', '2']);
    // Two events at the same time are split by id: nothing lost or repeated between pages.
    const page3 = await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 1, before: { at: page2[0].modifiedOn, id: page2[0].id } });
    expect(page3.map((e) => e.recordKey)).toEqual(['2']);
  });

  it('adds up member activity: later times kept, counters added, the client agent replaced', async () => {
    await store.touchMemberActivity(a, maria, { lastSeenAt: 5000, lastSyncAt: 5000, syncs: 1, recordsReceived: 3, clientAgent: 'CE/1' });
    await store.touchMemberActivity(a, maria, { lastSeenAt: 4000, lastCepDownloadAt: 4000, syncs: 2, recordsReceived: 1 });
    await store.touchMemberActivity(a, maria, { lastPlotsDownloadAt: 6000, clientAgent: 'CE/2' });
    expect(await store.listMemberActivity(a)).toEqual([
      {
        userId: maria,
        lastSeenAt: 5000,
        lastSyncAt: 5000,
        lastPlotsDownloadAt: 6000,
        lastCepDownloadAt: 4000,
        syncsCount: 3,
        recordsReceived: 4,
        clientAgent: 'CE/2',
      },
    ]);
  });

  it('writes no activity for someone who is not a member', async () => {
    await store.touchMemberActivity(b, jose, { lastSeenAt: 1 });
    expect(await store.listMemberActivity(b)).toEqual([]);
  });

  it('lists the audit log newest first, with the actor, filtered and paged', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      await store.appendAudit(a, { actorUserId: jose, action: 'invite.created', details: { inviteId: 'i1', role: 'operator' } });
      vi.setSystemTime(2000);
      await store.appendAudit(a, { actorUserId: null, action: 'csv.uploaded', details: { plots: 10 } });
      await store.appendAudit(a, { actorUserId: jose, action: 'member.removed', details: { userId: maria } });
    } finally {
      vi.useRealTimers();
    }
    const all = await store.listAudit(a, { limit: 10 });
    expect(all.map((e) => e.action)).toEqual(['member.removed', 'csv.uploaded', 'invite.created']);
    expect(all[2]).toMatchObject({ projectId: a, at: 1000, actorUserId: jose, actor: 'jose', details: { inviteId: 'i1', role: 'operator' } });
    expect(all[1]).toMatchObject({ actorUserId: null, actor: null });
    expect((await store.listAudit(a, { limit: 10, actor: jose })).map((e) => e.action)).toEqual(['member.removed', 'invite.created']);
    expect((await store.listAudit(a, { limit: 10, action: 'csv.uploaded' })).map((e) => e.action)).toEqual(['csv.uploaded']);
    const page = await store.listAudit(a, { limit: 1, before: { at: all[0].at, id: all[0].id } });
    expect(page.map((e) => e.action)).toEqual(['csv.uploaded']);
  });

  it('keeps each project apart', async () => {
    await store.appendRecordEvent(event(a));
    await store.touchMemberActivity(a, maria, { lastSeenAt: 1 });
    await store.appendAudit(a, { actorUserId: jose, action: 'cep.replaced', details: {} });
    expect(await store.listRecordEvents(b, { from: 0, to: 10_000, limit: 10 })).toEqual([]);
    expect(await store.listMemberActivity(b)).toEqual([]);
    expect(await store.listAudit(b, { limit: 10 })).toEqual([]);
  });

  it('removing a member drops their activity there; their audit entries stay with no actor', async () => {
    await store.touchMemberActivity(a, jose, { lastSeenAt: 1 });
    await store.touchMemberActivity(a, maria, { lastSeenAt: 1 });
    await store.appendAudit(a, { actorUserId: jose, action: 'cep.replaced', details: {} });
    await store.appendAudit(a, { actorUserId: maria, action: 'cep.replaced', details: {} });
    await store.appendRecordEvent(event(a, { operator: 'jose' }));
    await store.removeMember(a, jose);
    expect((await store.listMemberActivity(a)).map((m) => m.userId)).toEqual([maria]);
    expect((await store.listAudit(a, { limit: 10 })).map((e) => e.actorUserId)).toEqual([maria, null]);
    expect(await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 10 })).toHaveLength(1);
  });

  it("deleting an account drops its activity everywhere and keeps its audit entries and records' events", async () => {
    await store.touchMemberActivity(a, maria, { lastSeenAt: 1 });
    await store.touchMemberActivity(b, maria, { lastSeenAt: 1 });
    await store.appendAudit(b, { actorUserId: maria, action: 'cep.replaced', details: {} });
    await store.appendRecordEvent(event(b));
    await store.deleteUser(maria);
    expect(await store.listMemberActivity(a)).toEqual([]);
    expect(await store.listMemberActivity(b)).toEqual([]);
    expect((await store.listAudit(b, { limit: 10 })).map((e) => [e.actorUserId, e.actor])).toEqual([[null, null]]);
    expect(await store.listRecordEvents(b, { from: 0, to: 10_000, limit: 10 })).toHaveLength(1);
  });

  it('deleting a project deletes its activity data and nothing of the others', async () => {
    for (const p of [a, b]) {
      await store.appendRecordEvent(event(p));
      await store.touchMemberActivity(p, maria, { lastSeenAt: 1 });
      await store.appendAudit(p, { actorUserId: maria, action: 'cep.replaced', details: {} });
    }
    await store.deleteProject(a);
    expect(await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 10 })).toEqual([]);
    expect(await store.listMemberActivity(a)).toEqual([]);
    expect(await store.listAudit(a, { limit: 10 })).toEqual([]);
    expect(await store.listRecordEvents(b, { from: 0, to: 10_000, limit: 10 })).toHaveLength(1);
    expect(await store.listMemberActivity(b)).toHaveLength(1);
    expect(await store.listAudit(b, { limit: 10 })).toHaveLength(1);
  });
});

describe('migration 012', () => {
  const sql = readFileSync(new URL('../migrations/012_activity.sql', import.meta.url), 'utf8');

  it('fences each new table on app.current_project, as records is', () => {
    for (const table of ['record_events', 'member_activity', 'audit_log']) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(
        `CREATE POLICY ${table}_isolation ON ${table}\n` +
          "  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)\n" +
          "  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);",
      );
    }
  });
});
