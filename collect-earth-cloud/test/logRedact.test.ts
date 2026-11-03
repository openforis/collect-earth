import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/logRedact.js';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/store/memory.js';

describe('secrets in the request log (Task 18 review)', () => {
  it('redactUrl hides the token segment of every link that carries one', () => {
    expect(redactUrl('/v1/public/progress/AbC_9-x?tz=Europe/Rome')).toBe('/v1/public/progress/<redacted>?tz=Europe/Rome');
    expect(redactUrl('/p/AbC_9-x')).toBe('/p/<redacted>');
    expect(redactUrl('/v1/join/tok123')).toBe('/v1/join/<redacted>');
    expect(redactUrl('/join/tok123')).toBe('/join/<redacted>');
    expect(redactUrl('/reset/tok123')).toBe('/reset/<redacted>');
    expect(redactUrl('/v1/collect-backup/payload.sig')).toBe('/v1/collect-backup/<redacted>');
    expect(redactUrl('/v1/unsubscribe/payload.sig')).toBe('/v1/unsubscribe/<redacted>');
    expect(redactUrl('/unsubscribe/payload.sig')).toBe('/unsubscribe/<redacted>');
    expect(redactUrl('/confirm-email/payload.sig')).toBe('/confirm-email/<redacted>');
    expect(redactUrl('/v1/auth/reset?token=abc&x=1')).toBe('/v1/auth/reset?token=<redacted>&x=1');
    expect(redactUrl('/x?inviteToken=abc')).toBe('/x?inviteToken=<redacted>');
    // Other paths stay as they are.
    expect(redactUrl('/v1/projects/p1/progress?tz=UTC')).toBe('/v1/projects/p1/progress?tz=UTC');
    expect(redactUrl('/projects/p1/plots/f2')).toBe('/projects/p1/plots/f2');
    expect(redactUrl('/p')).toBe('/p');
  });

  it("the server's log lines carry no token of a link", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = await buildServer({
      store: new InMemoryStore(),
      config: { port: 0, host: '127.0.0.1', storeBackend: 'memory', rateLimitPerMinute: 0 },
      webDir: null,
      logger: { stream, level: 'info' },
    });
    const secret = 'S3cretT0kenS3cretT0kenS3cretT0kenS3cretT0k';
    try {
      for (const url of [`/v1/public/progress/${secret}?tz=UTC`, `/p/${secret}`, `/v1/join/${secret}`, `/join/${secret}`, `/reset/${secret}`, `/v1/collect-backup/${secret}`, `/v1/unsubscribe/${secret}`, `/unsubscribe/${secret}`, `/confirm-email/${secret}`]) {
        await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } });
      }
      await app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token: secret, password: 'new-password-1' } });
      await app.inject({ method: 'POST', url: `/v1/unsubscribe/${secret}`, payload: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    } finally {
      await app.close();
    }
    const log = lines.join('');
    expect(log).toContain('incoming request');
    expect(log).toContain('/v1/public/progress/<redacted>');
    expect(log).toContain('/v1/collect-backup/<redacted>');
    expect(log).toContain('/v1/unsubscribe/<redacted>');
    expect(log).not.toContain(secret);
  });
});
