import { describe, expect, it } from 'vitest';
import { ProjectStateCache } from '../src/projectState.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { RecordRow } from '../src/types.js';

const log = { warn: () => {}, error: () => {} };

async function project() {
  const store = new InMemoryStore();
  const { projectId } = await store.createProject({ name: 'p' });
  await store.putCsvFile(projectId, 'a.csv', Buffer.from('id,lat,lon\n1,0,0\n2,0,0\n'));
  const record = (recordKey: string, modifiedOn: number): RecordRow =>
    ({ projectId, recordKey, operator: 'ana', modifiedOn, receivedAt: modifiedOn, activelySaved: true, step: 1, xml: '<r/>', summary: {}, deleted: false, deletedOn: null }) as RecordRow;
  return { store, projectId, record };
}

describe('ProjectStateCache', () => {
  it('builds a project once for unchanged inputs, again when a record changes', async () => {
    const { store, projectId, record } = await project();
    const cache = new ProjectStateCache(store, { staleMs: 0 });
    const first = await cache.get(projectId, log);
    expect(first.stale).toBe(false);
    expect(first.state.units.totals.plots).toBe(2);
    await cache.get(projectId, log);
    expect(cache.built).toBe(1);
    await store.putRecord(record('1', 1000));
    const second = await cache.get(projectId, log);
    expect(cache.built).toBe(2);
    expect(second.state.units.totals.submitted).toBe(1);
  });

  it('serves a young state (stale) while a newer one is built behind it, one build at a time', async () => {
    const { store, projectId, record } = await project();
    let now = 1_000_000;
    const cache = new ProjectStateCache(store, { staleMs: 30_000, now: () => now });
    await cache.get(projectId, log);
    await store.putRecord(record('1', 1000));
    now += 10_000;
    const [a, b] = await Promise.all([cache.get(projectId, log), cache.get(projectId, log)]);
    expect(a.stale).toBe(true);
    expect(b.stale).toBe(true);
    expect(a.state.units.totals.submitted).toBe(0);
    // Let the build behind it end: the next request gets the new state.
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.built).toBe(2);
    const fresh = await cache.get(projectId, log);
    expect(fresh).toMatchObject({ stale: false });
    expect(fresh.state.units.totals.submitted).toBe(1);
    // Older than staleMs: waited for, never served stale.
    await store.putRecord(record('2', 2000));
    now += 60_000;
    const late = await cache.get(projectId, log);
    expect(late.stale).toBe(false);
    expect(late.state.units.totals.submitted).toBe(2);
  });

  it('concurrent first requests share one build', async () => {
    const { store, projectId } = await project();
    const cache = new ProjectStateCache(store, { staleMs: 0 });
    await Promise.all([cache.get(projectId, log), cache.get(projectId, log), cache.get(projectId, log)]);
    expect(cache.built).toBe(1);
  });

  it('keeps at most maxProjects projects, and drops one idle for idleMs', async () => {
    const store = new InMemoryStore();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await store.createProject({ name: `p${i}` })).projectId);
    let now = 0;
    const cache = new ProjectStateCache(store, { staleMs: 0, maxProjects: 2, idleMs: 60_000, now: () => now });
    for (const id of ids) await cache.get(id, log);
    expect(cache.built).toBe(3);
    await cache.get(ids[0], log); // evicted by the third: built again
    expect(cache.built).toBe(4);
    now += 61_000;
    await cache.get(ids[2], log); // idle too long: dropped, built again
    expect(cache.built).toBe(5);
  });

  it('roles are read each time (not part of the version)', async () => {
    const { store, projectId } = await project();
    const user = await store.createUser({ username: 'ana', passwordHash: 'x', email: null });
    await store.addMembership(projectId, user.id, 'operator');
    const cache = new ProjectStateCache(store, { staleMs: 0 });
    expect((await cache.get(projectId, log)).members[0].role).toBe('operator');
    await store.setMemberRole(projectId, user.id, 'reviewer');
    const again = await cache.get(projectId, log);
    expect(again.members[0].role).toBe('reviewer');
    expect(cache.built).toBe(1);
  });
});
