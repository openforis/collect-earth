import { describe, expect, it } from 'vitest';
import { makeContext } from './helpers.js';
import { DESKTOP_SENTRY_DSN, NO_TELEMETRY, scrubEvent, telemetryConfigOf } from '../src/telemetry.js';

describe('telemetry settings', () => {
  it('is off unless TELEMETRY=1; then the desktop app\'s Sentry project', () => {
    expect(telemetryConfigOf({})).toEqual(NO_TELEMETRY);
    expect(telemetryConfigOf({ TELEMETRY: '0', SENTRY_DSN: 'https://x@s.io/1' })).toEqual(NO_TELEMETRY);
    expect(telemetryConfigOf({ TELEMETRY: '1' })).toEqual({ sentryDsn: DESKTOP_SENTRY_DSN, environment: 'production' });
    expect(telemetryConfigOf({ TELEMETRY: 'true', SENTRY_DSN: 'https://k@o.io/2', SENTRY_ENVIRONMENT: 'staging' })).toEqual({
      sentryDsn: 'https://k@o.io/2',
      environment: 'staging',
    });
    expect(() => telemetryConfigOf({ TELEMETRY: 'yes' })).toThrow(/TELEMETRY/);
  });

  it('sends Sentry no body, header, query string nor user', () => {
    const event = scrubEvent({ request: { url: 'https://c.org/join/TOKEN?x=1', method: 'POST', data: '{"password":"x"}', headers: { authorization: 'Bearer t' } }, user: { username: 'ana' } });
    expect(event).toEqual({ request: { url: 'https://c.org/join/<redacted>', method: 'POST' } });
  });

  it("keeps the link tokens of the address out of Sentry's reports", () => {
    for (const path of ['/v1/join/T1', '/v1/auth/reset/T2', '/v1/public/progress/T3', '/v1/collect-backup/T4', '/v1/unsubscribe/T5']) {
      const event = scrubEvent({ request: { url: `https://ce.example.org${path}`, method: 'GET' }, transaction: `GET ${path}` });
      expect(JSON.stringify(event), path).not.toMatch(/T[1-5]/);
    }
    // other addresses are kept as they are, for the report to say where it happened
    expect(scrubEvent({ request: { url: 'https://c.org/v1/projects/p1/cep', method: 'PUT' } }).request).toEqual({ url: 'https://c.org/v1/projects/p1/cep', method: 'PUT' });
  });

  it('the dashboard gets no telemetry settings while telemetry is off', async () => {
    const ctx = await makeContext();
    try {
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/server-info' });
      expect(res.json().telemetry).toBeNull();
    } finally {
      await ctx.app.close();
    }
  });
});
