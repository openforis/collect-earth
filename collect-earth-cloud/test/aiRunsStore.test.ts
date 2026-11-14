import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store/memory.js';
import type { AiRunWindow } from '../src/types.js';

const NOW = Date.UTC(2026, 9, 15, 12);
const window = (over: Partial<AiRunWindow> = {}): AiRunWindow => ({
  now: NOW, staleBefore: 0, dayStart: Date.UTC(2026, 9, 15), monthStart: Date.UTC(2026, 9, 1),
  reportsPerDay: 100, followUpsPerDay: 100, monthlyTokens: 1_000_000, ...over,
});

describe('AI runs in the store', () => {
  it('lists the AI tab\'s runs without the view proposals, however many came after', async () => {
    const store = new InMemoryStore();
    const { projectId } = await store.createProject({ name: 'p' });
    const ana = await store.createUser({ username: 'ana', passwordHash: 'x', email: null });
    const end = { status: 'done' as const, result: null, error: null, errorCode: null, finishedAt: NOW, inputTokens: 0, outputTokens: 0, toolCalls: [] };
    for (const kind of ['report', 'views', 'views', 'views'] as const) {
      const r = await store.startAiRun(projectId, { kind, startedBy: ana.id, model: 'm' }, window());
      if (!r.ok) throw new Error(r.limit);
      await store.finishAiRun(projectId, r.run.id, end);
    }
    expect((await store.listAiRuns(projectId, 2, { exceptViews: true })).map((r) => r.kind)).toEqual(['report']);
    expect((await store.listAiRuns(projectId, 2)).map((r) => r.kind)).toEqual(['views', 'views']);
  });

  it('a run failed as interrupted counts its tokens to the person\'s month, once', async () => {
    const store = new InMemoryStore();
    const a = (await store.createProject({ name: 'a' })).projectId;
    const b = (await store.createProject({ name: 'b' })).projectId;
    const ana = await store.createUser({ username: 'ana', passwordHash: 'x', email: null });
    const run = await store.startAiRun(a, { kind: 'report', startedBy: ana.id, model: 'm' }, window({ now: NOW - 3_600_000 }));
    if (!run.ok) throw new Error(run.limit);
    await store.updateAiRun(a, run.run.id, { inputTokens: 500, outputTokens: 100, toolCalls: [] });
    expect(await store.failStaleAiRuns(a, NOW - 60_000, 'interrupted', 'stopped', NOW)).toBe(1);
    // 600 used in project a: over a month of 500 in another project
    expect(await store.startAiRun(b, { kind: 'report', startedBy: ana.id, model: 'm' }, window({ monthlyTokens: 500 }))).toEqual({ ok: false, limit: 'monthly' });
    // its late end changes nothing: 600, not 1200
    expect(await store.finishAiRun(a, run.run.id, { status: 'done', result: null, error: null, errorCode: null, finishedAt: NOW, inputTokens: 500, outputTokens: 100, toolCalls: [] })).toBe(false);
    expect((await store.startAiRun(b, { kind: 'report', startedBy: ana.id, model: 'm' }, window({ monthlyTokens: 1100 }))).ok).toBe(true);
  });
});
