import { afterEach, describe, expect, it } from 'vitest';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin } from './helpers.js';
import { cleanParams, clientIdOf, DESKTOP_GA_MEASUREMENT_ID, DESKTOP_SENTRY_DSN, NO_TELEMETRY, scrubEvent, telemetry, telemetryConfigOf } from '../src/telemetry.js';

describe('telemetry settings', () => {
  it('is off unless TELEMETRY=1; then the desktop app\'s Sentry project and GA property, GA only with its secret', () => {
    expect(telemetryConfigOf({})).toEqual(NO_TELEMETRY);
    expect(telemetryConfigOf({ TELEMETRY: '0', SENTRY_DSN: 'https://x@s.io/1' })).toEqual(NO_TELEMETRY);
    expect(telemetryConfigOf({ TELEMETRY: '1' })).toEqual({ sentryDsn: DESKTOP_SENTRY_DSN, environment: 'production', gaMeasurementId: null, gaApiSecret: null });
    expect(telemetryConfigOf({ TELEMETRY: 'true', GA_API_SECRET: 's', SENTRY_DSN: 'https://k@o.io/2', SENTRY_ENVIRONMENT: 'staging' })).toEqual({
      sentryDsn: 'https://k@o.io/2',
      environment: 'staging',
      gaMeasurementId: DESKTOP_GA_MEASUREMENT_ID,
      gaApiSecret: 's',
    });
    expect(() => telemetryConfigOf({ TELEMETRY: 'yes' })).toThrow(/TELEMETRY/);
  });

  it('keeps only the parameters an event may carry, never free text', () => {
    expect(cleanParams('training_set_created', { kind: 'learning', plots: 12, name: 'Week 1' })).toEqual({ kind: 'learning', plots: 12 });
    expect(cleanParams('training_golden_set', { from: 'ana rodríguez', plots: 2 })).toEqual({ plots: 2 });
    expect(clientIdOf('p', 'u')).toMatch(/^[0-9a-f]{32}$/);
    expect(clientIdOf('p', 'u')).not.toBe(clientIdOf('p', 'v'));
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
});

describe('usage events of the training features', () => {
  afterEach(() => telemetry.reset());

  it('are sent for each action, with kinds and counts only', async () => {
    const sent: { url: string; body: { client_id: string; events: { name: string; params: Record<string, unknown> }[] } }[] = [];
    telemetry.setSender(async (url, body) => void sent.push({ url, body: JSON.parse(body) }), { gaMeasurementId: 'G-TEST', gaApiSecret: 'secret' });
    const ctx = await makeContext();
    try {
      const owner = await setupPlatformAdmin(ctx.app);
      const { projectId: pid } = await createProject(ctx.app, 'Training');
      await ctx.store.addMembership(pid, owner.userId, 'admin');
      const call = (method: 'GET' | 'PUT' | 'POST' | 'PATCH', path: string, payload?: unknown, headers: Record<string, string> = {}) =>
        ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(owner.token), ...headers }, payload: payload as never });
      const set = (await call('PUT', '/training-sets/secret-name.csv?kind=calibration&name=Northern%20team', 'id,lat,lon\n10,1,1\n11,1,1\n', { 'content-type': 'text/csv' })).json();
      await call('PUT', `/training/${set.id}/members`, { userIds: [owner.userId] });
      await batchRequest(ctx.app, pid, owner.token, [envelope({ recordKey: '10', operator: 'owner', summary: { collect_code_lu: 'F' } })]);
      await call('POST', `/training/${set.id}/golden`, { from: 'consensus' });
      await call('PATCH', `/training/${set.id}`, { kind: 'learning' });
      await call('POST', `/training/${set.id}/attempts`, { all: true });
      await call('GET', '/training/figures');
      await call('GET', '/training/mine');
      expect((await call('POST', '/telemetry', { name: 'training_report_printed', params: { kind: 'learning' } })).statusCode).toBe(204);
      expect((await call('POST', '/telemetry', { name: 'export_everything' })).statusCode).toBe(400);
      await new Promise((r) => setTimeout(r, 10));
      const names = sent.map((s) => s.body.events[0].name);
      expect(names).toEqual([
        'training_set_created',
        'training_members_set',
        'training_records_synced',
        'training_golden_set',
        'training_set_changed',
        'training_attempts_started',
        'training_figures_viewed',
        'my_training_viewed',
        'training_report_printed',
      ]);
      expect(sent[0].url).toContain('measurement_id=G-TEST');
      expect(sent[0].body.events[0].params).toMatchObject({ kind: 'calibration', plots: 2, app: 'cloud' });
      expect(sent[3].body.events[0].params).toMatchObject({ from: 'consensus', plots: 1 });
      const all = JSON.stringify(sent.map((s) => s.body));
      for (const leak of ['owner', 'Northern', 'secret-name', pid, owner.userId, 'collect_code_lu']) expect(all).not.toContain(leak);
    } finally {
      await ctx.app.close();
    }
  });

  it('nothing is sent while telemetry is off', async () => {
    const ctx = await makeContext();
    try {
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/server-info' });
      expect(res.json().telemetry).toBeNull();
    } finally {
      await ctx.app.close();
    }
  });
});
