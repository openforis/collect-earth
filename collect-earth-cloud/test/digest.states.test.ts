import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';
import { runDigests } from '../src/digest.js';
import { TestMailer } from '../src/mail.js';
import { ProjectStateCache } from '../src/projectState.js';
import { QualityService } from '../src/qualityService.js';
import { InMemoryStore } from '../src/store/memory.js';

const quiet = { warn() {}, info() {}, error() {}, debug() {}, child() { return quiet; } } as unknown as FastifyBaseLogger;

describe('weekly digest run', () => {
  it('builds each project state once per run, however the subscribers are ordered', async () => {
    const store = new InMemoryStore();
    const projects: string[] = [];
    for (let p = 0; p < 5; p++) projects.push((await store.createProject({ name: `p${p}` })).projectId);
    const monthAgo = Date.now() - 30 * 86_400_000;
    // 15 coordinators, each of one project in turn: in user order the projects come round-robin.
    for (let i = 0; i < 15; i++) {
      const email = `c${String(i).padStart(2, '0')}@example.org`;
      const u = await store.createUser({ username: `c${String(i).padStart(2, '0')}`, passwordHash: 'x', email });
      await store.confirmEmail(u.id, email, monthAgo);
      await store.addMembership(projects[i % 5], u.id, 'admin');
      await store.setDigest(u.id, 'coordinator', true, monthAgo);
    }
    const states = new ProjectStateCache(store);
    await runDigests(
      { store, quality: new QualityService(store, null), states, mailer: new TestMailer(), secret: Buffer.alloc(32, 1), log: quiet, now: Date.now },
      { baseUrl: 'https://ce.example.org' },
    );
    expect(states.built).toBeGreaterThan(0);
    expect(states.built).toBeLessThanOrEqual(5);
  });
});
