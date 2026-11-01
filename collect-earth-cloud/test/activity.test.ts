import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRecorder, clientAgentOf, MAX_CLIENT_AGENT_CHARS } from '../src/activity.js';
import { recordChange, recordEventOf } from '../src/lww.js';
import { InMemoryStore } from '../src/store/memory.js';
import { InvalidCursorError } from '../src/store/store.js';
import { AUDIT_ACTIONS, type MemberActivityPatch, type RecordEventInput, type RecordRow } from '../src/types.js';

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

// Collect Earth's saves, as they reach the server (AbstractEarthSurveyService and
// Collect's RecordManager.save, which sets modifiedDate to now on every save): each
// autosave of the balloon has a new modifiedOn and activelySaved false, also onto a
// submitted plot; Submit and validate sends activelySaved true. A retried batch sends
// the same save again.
describe('recordChange: what a stored upload did', () => {
  const autosave1 = row({ modifiedOn: 1000, summary: { a: '1' } });
  const autosave2 = row({ modifiedOn: 2000, summary: { a: '2' } });
  const submit = row({ modifiedOn: 3000, activelySaved: true, summary: { a: '2' } });
  const editAfterSubmit = row({ modifiedOn: 4000, activelySaved: false, summary: { a: '3' } });
  const submitAgain = row({ modifiedOn: 5000, activelySaved: true, summary: { a: '3' } });

  it('a plot opened and answered, then submitted, then edited and submitted again', () => {
    expect(recordChange(null, autosave1, false)).toBe('created');
    expect(recordChange(autosave1, autosave2, false)).toBe('updated');
    expect(recordChange(autosave2, submit, false)).toBe('submitted');
    expect(recordChange(submit, editAfterSubmit, true)).toBe('unsubmitted');
    expect(recordChange(editAfterSubmit, submitAgain, true)).toBe('resubmitted');
  });

  it('only the first submission of a record is submitted; a later one is resubmitted', () => {
    expect(recordChange(null, submit, false)).toBe('submitted');
    expect(recordChange(null, submit, true)).toBe('resubmitted');
    // Submit pressed again on a submitted plot (an edit inside the write-behind window
    // reaches the server with the submit): every actively saved upload is a submission.
    expect(recordChange(submit, submitAgain, true)).toBe('resubmitted');
  });

  it('a tombstone is deleted; a record coming back after one is created, or (re)submitted', () => {
    const gone = row({ modifiedOn: 6000, deleted: true, activelySaved: true });
    expect(recordChange(submitAgain, gone, true)).toBe('deleted');
    expect(recordChange(null, gone, false)).toBe('deleted');
    expect(recordChange(gone, row({ modifiedOn: 7000 }), true)).toBe('created');
    expect(recordChange(gone, row({ modifiedOn: 7000, activelySaved: true }), true)).toBe('resubmitted');
  });

  it('the same save sent again (a retried batch) changes nothing: no event', () => {
    expect(recordChange(submit, { ...submit, receivedAt: 9000 }, true)).toBeNull();
    const gone = row({ deleted: true });
    expect(recordChange(gone, { ...gone }, false)).toBeNull();
  });

  it('a save with the same time but other answers or XML is not a retry', () => {
    expect(recordChange(autosave2, { ...autosave2, summary: { a: 'other' } }, false)).toBe('updated');
    expect(recordChange(autosave2, { ...autosave2, xml: '<other/>' }, false)).toBe('updated');
  });

  it('the event keeps the answers only when (re)submitted, and never the XML', () => {
    const submitted = recordEventOf(null, submit, false)!;
    expect(submitted).toEqual({
      projectId: 'p',
      recordKey: '1',
      operator: 'maria',
      modifiedOn: 3000,
      receivedAt: 5000,
      activelySaved: true,
      step: 1,
      deleted: false,
      change: 'submitted',
      summary: { a: '2' },
    });
    expect(recordEventOf(editAfterSubmit, submitAgain, true)!.summary).toEqual({ a: '3' });
    expect(recordEventOf(null, autosave1, false)!.summary).toBeNull();
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

// Cloud Run (request-based billing) throttles the CPU once a response is sent: the
// write that is due is made inside the request, and timers are only a best effort.
describe('ActivityRecorder: at most one write per member per minute, inside the request', () => {
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

  it("the member's first call of the minute is written before note() returns", async () => {
    await recorder.note('p', 'u', {});
    expect(writes).toEqual([{ projectId: 'p', userId: 'u', patch: { lastSeenAt: 1_000_000 } }]);
  });

  it('calls within the minute are added up in memory, and written by the first call after it, with no timer', async () => {
    await recorder.note('p', 'u', {});
    vi.setSystemTime(1_010_000); // the clock moves, but no timer runs (a throttled instance)
    await recorder.note('p', 'u', { sync: { records: 3 }, clientAgent: 'CE/1' });
    vi.setSystemTime(1_020_000);
    await recorder.note('p', 'u', { sync: { records: 2 } });
    vi.setSystemTime(1_030_000);
    await recorder.note('p', 'u', { plotsDownload: true, cepDownload: true, clientAgent: 'CE/2' });
    expect(writes).toHaveLength(1);
    vi.setSystemTime(1_070_000);
    await recorder.note('p', 'u', {});
    expect(writes).toHaveLength(2);
    expect(writes[1].patch).toEqual({
      lastSeenAt: 1_070_000,
      lastSyncAt: 1_020_000,
      syncs: 2,
      recordsReceived: 5,
      lastPlotsDownloadAt: 1_030_000,
      lastCepDownloadAt: 1_030_000,
      clientAgent: 'CE/2',
    });
  });

  it('a timer writes what is pending a minute after the last write, as a best effort', async () => {
    await recorder.note('p', 'u', {});
    await vi.advanceTimersByTimeAsync(10_000);
    await recorder.note('p', 'u', { sync: { records: 1 } });
    await vi.advanceTimersByTimeAsync(49_999);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toHaveLength(2);
    expect(writes[1].patch).toMatchObject({ syncs: 1, lastSeenAt: 1_010_000 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(writes).toHaveLength(2);
  });

  it('keeps each member of each project apart', async () => {
    await recorder.note('p', 'u', {});
    await recorder.note('p', 'v', {});
    await recorder.note('q', 'u', {});
    expect(writes.map((w) => `${w.projectId} ${w.userId}`)).toEqual(['p u', 'p v', 'q u']);
  });

  it('flush and close write what is pending at once', async () => {
    await recorder.note('p', 'u', {});
    vi.setSystemTime(1_005_000);
    await recorder.note('p', 'u', { sync: { records: 1 } });
    await recorder.close();
    expect(writes).toHaveLength(2);
    expect(writes[1].patch).toMatchObject({ syncs: 1, recordsReceived: 1 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(writes).toHaveLength(2);
  });

  it('a failed write is reported, does not throw, and its patch is written with the next one', async () => {
    const errors: unknown[] = [];
    const patches: MemberActivityPatch[] = [];
    let fail = true;
    const flaky = new ActivityRecorder(
      {
        touchMemberActivity: async (_p, _u, patch) => {
          if (fail) throw new Error('db down');
          patches.push(patch);
        },
      },
      { onError: (err) => errors.push(err) },
    );
    await flaky.note('p', 'u', { sync: { records: 2 }, clientAgent: 'CE/1' });
    expect(String(errors[0])).toContain('db down');
    fail = false;
    vi.setSystemTime(1_090_000);
    await flaky.note('p', 'u', { sync: { records: 1 } });
    expect(patches).toEqual([{ lastSeenAt: 1_090_000, lastSyncAt: 1_090_000, syncs: 2, recordsReceived: 3, clientAgent: 'CE/1' }]);
    await flaky.close();
  });

  it('forgets idle members once it holds many, scanning at most once a minute', async () => {
    const small = new ActivityRecorder(store, { pruneAbove: 3 });
    for (const u of ['a', 'b', 'c']) await small.note('p', u, {});
    expect(small.size()).toBe(3);
    await small.note('p', 'd', {}); // nobody idle for a minute yet: nothing forgotten
    expect(small.size()).toBe(4);
    vi.setSystemTime(1_061_000);
    await small.note('p', 'e', {}); // a, b, c, d idle over a minute: forgotten
    expect(small.size()).toBe(1);
    vi.setSystemTime(1_062_000);
    for (const u of ['f', 'g', 'h']) await small.note('p', u, {});
    expect(small.size()).toBe(4); // scanned at 1_061_000: not again within the minute
    await small.close();
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

  it('putRecordWithEvent stores the record and its event together, from the row before it and whether it was submitted', async () => {
    const seen: [RecordRow | null, boolean][] = [];
    const upload = (r: RecordRow) =>
      store.putRecordWithEvent(a, r.recordKey, r.operator, (existing, submittedBefore) => {
        seen.push([existing, submittedBefore]);
        if (existing && r.modifiedOn < existing.modifiedOn) return null; // stale
        return { row: r, event: recordEventOf(existing, r, submittedBefore) };
      });
    const draft = row({ projectId: a, modifiedOn: 1000 });
    const submitted = row({ projectId: a, modifiedOn: 2000, activelySaved: true });
    expect(await upload(draft)).toBe(true);
    expect(await upload(submitted)).toBe(true);
    expect(await upload({ ...submitted })).toBe(true); // a retry: stored, no event
    expect(await upload(row({ projectId: a, modifiedOn: 500 }))).toBe(false);
    expect(await upload(row({ projectId: a, modifiedOn: 3000, activelySaved: true }))).toBe(true);
    expect(seen.map(([e, s]) => [e?.modifiedOn ?? null, s])).toEqual([[null, false], [1000, false], [2000, true], [2000, true], [2000, true]]);
    const list = (await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 10 })).reverse();
    expect(list.map((e) => e.change)).toEqual(['created', 'submitted', 'resubmitted']);
    expect((await store.getRecord(a, '1', 'maria'))!.modifiedOn).toBe(3000);
  });

  it('refuses a cursor whose id is not a whole number, in both lists', async () => {
    await expect(store.listRecordEvents(a, { from: 0, to: 10, limit: 1, before: { at: 1, id: 'x' } })).rejects.toThrow(InvalidCursorError);
    await expect(store.listAudit(a, { limit: 1, before: { at: 1, id: '1.5' } })).rejects.toThrow(InvalidCursorError);
    await expect(store.listAudit(a, { limit: 1, before: { at: Number.NaN, id: '1' } })).rejects.toThrow(InvalidCursorError);
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

  it('allows exactly the changes and audit actions the code has', () => {
    const listed = (constraint: string) =>
      [...sql.slice(sql.indexOf(constraint)).split('))')[0].matchAll(/'([a-z.]+)'/g)].map((m) => m[1]).sort();
    expect(listed('change         TEXT')).toEqual(['created', 'deleted', 'resubmitted', 'submitted', 'unsubmitted', 'updated']);
    expect(listed('audit_log_action_check')).toEqual([...AUDIT_ACTIONS].sort());
    expect(AUDIT_ACTIONS).toContain('survey.replaced');
  });

  it('indexes what the deletions and the first-submission lookup search by', () => {
    expect(sql).toContain('ON record_events(project_id, record_key, operator)');
    expect(sql).toContain('ON audit_log(actor_user_id)');
  });
});
