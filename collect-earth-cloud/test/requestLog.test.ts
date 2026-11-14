import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/store/memory.js';
import { batchRequest, bearer, envelope } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';

describe("the server's request log", () => {
  it('writes one line per request, none for the sync calls that went well', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const store = new InMemoryStore();
    const app = await buildServer({
      store,
      config: { port: 0, host: '127.0.0.1', storeBackend: 'memory', rateLimitPerMinute: 0 },
      webDir: null,
      logger: { stream, level: 'info' },
    });
    try {
      const project = await store.createProject({ name: 'Log' });
      const pid = project.projectId;
      await app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() });
      lines.length = 0;
      const quiet = [
        await batchRequest(app, pid, project.projectToken, [envelope()]),
        await app.inject({ method: 'GET', url: `/v1/projects/${pid}/plot-layout`, headers: bearer(project.projectToken) }),
        await app.inject({ method: 'GET', url: `/v1/projects/${pid}/imagery`, headers: bearer(project.projectToken) }),
        await app.inject({ method: 'GET', url: '/health' }),
      ];
      expect(quiet.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
      expect(lines.filter((l) => l.includes('request completed'))).toEqual([]);

      // A sync that fails is written, and so is any other request, once
      await batchRequest(app, pid, 'not-a-token', [envelope()]);
      await app.inject({ method: 'GET', url: `/v1/projects/${pid}/progress`, headers: bearer(project.adminToken) });
      const written = lines.filter((l) => l.includes('request completed')).map((l) => JSON.parse(l) as { req: { method: string; url: string }; res: { statusCode: number }; responseTime: number });
      expect(written.map((l) => `${l.req.method} ${l.req.url.replace(pid, ':pid')} ${l.res.statusCode}`)).toEqual([
        'POST /v1/projects/:pid/records:batch 401',
        'GET /v1/projects/:pid/progress 200',
      ]);
      expect(written.every((l) => typeof l.responseTime === 'number')).toBe(true);
      expect(lines.some((l) => l.includes('incoming request'))).toBe(false);
    } finally {
      await app.close();
    }
  });
});
