import { afterEach, describe, expect, it } from 'vitest';
import { TestMailer } from '../src/mail.js';
import { alertMail, OwnerAlerts, STORAGE_PERCENT, THRESHOLDS, type OwnerAlert } from '../src/ownerAlerts.js';
import { bearer, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe('the owner alerts', () => {
  const clock = (start = 1_800_000_000_000) => {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  };

  it('raise an alert when an hour reaches the threshold, then rest six hours', () => {
    const c = clock();
    const told: OwnerAlert[] = [];
    const alerts = new OwnerAlerts({ now: c.now, notify: (a) => void told.push(a) });
    alerts.note('failedLogin', THRESHOLDS.failedLogin - 1);
    expect(told).toEqual([]);
    alerts.note('failedLogin');
    expect(told).toEqual([{ kind: 'failed_logins', at: c.now(), count: THRESHOLDS.failedLogin }]);
    // more of the same within six hours: not told again
    c.advance(3_600_000 * 2);
    alerts.note('failedLogin', THRESHOLDS.failedLogin);
    expect(told).toHaveLength(1);
    // after six hours: told again
    c.advance(3_600_000 * 5);
    alerts.note('failedLogin', THRESHOLDS.failedLogin);
    expect(told).toHaveLength(2);
    expect(alerts.recent().map((a) => a.kind)).toEqual(['failed_logins', 'failed_logins']);
  });

  it('count only the last hour', () => {
    const c = clock();
    const told: OwnerAlert[] = [];
    const alerts = new OwnerAlerts({ now: c.now, notify: (a) => void told.push(a) });
    alerts.note('serverError', THRESHOLDS.serverError - 1);
    c.advance(3_600_001);
    alerts.note('serverError');
    expect(told).toEqual([]);
    alerts.note('syncError', THRESHOLDS.syncError);
    expect(told.map((a) => a.kind)).toEqual(['sync_errors']);
  });

  it('check storage against the limit, a project at a time, once a day', () => {
    const c = clock();
    const told: OwnerAlert[] = [];
    const alerts = new OwnerAlerts({ now: c.now, notify: (a) => void told.push(a) });
    const mb = 1024 * 1024;
    alerts.checkStorage([{ projectId: 'p1', storageBytes: 95 * mb }, { projectId: 'p2', storageBytes: 50 * mb }], 0);
    expect(told).toEqual([]);
    alerts.checkStorage([{ projectId: 'p1', storageBytes: 95 * mb }, { projectId: 'p2', storageBytes: 50 * mb }], 100);
    expect(told).toEqual([{ kind: 'storage', at: c.now(), count: 95, projectId: 'p1' }]);
    alerts.checkStorage([{ projectId: 'p1', storageBytes: 99 * mb }], 100);
    expect(told).toHaveLength(1);
    c.advance(24 * 3_600_000);
    alerts.checkStorage([{ projectId: 'p1', storageBytes: STORAGE_PERCENT * mb }], 100);
    expect(told).toHaveLength(2);
  });

  it('write their mail in the administrator\'s language', () => {
    const en = alertMail({ kind: 'storage', at: 0, count: 93, projectId: 'p1' }, 'en', 'CE Cloud', 'Mozambique 2026');
    expect(en.subject).toBe('CE Cloud: a project is near its storage limit');
    expect(en.text).toContain('The project Mozambique 2026 uses 93% of its storage limit');
    expect(en.html).toContain('Mozambique 2026');
    expect(alertMail({ kind: 'failed_logins', at: 0, count: 50 }, 'es', 'CE', null).subject).toBe('CE: muchos inicios de sesión fallidos');
  });
});

describe('the alerts on a running server', () => {
  let ctx: TestContext;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('mail the confirmed administrators after a burst of failed logins, and list it on the server panel', async () => {
    const mailer = new TestMailer();
    ctx = await makeContext({ publicBaseUrl: 'https://ce.example.org' }, { mailer });
    const owner = await setupPlatformAdmin(ctx.app);
    await ctx.store.setEmail(owner.userId, 'owner@example.org');
    await ctx.store.confirmEmail(owner.userId, 'owner@example.org', Date.now());
    for (let i = 0; i < THRESHOLDS.failedLogin; i++) {
      await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: `nobody${i}`, password: 'wrong-password' } });
    }
    // the mail goes out without holding the request: give it a moment
    await new Promise((r) => setTimeout(r, 50));
    const sent = mailer.sent.filter((m) => m.tag === 'owner.alert.failed_logins');
    expect(sent.map((m) => m.to)).toEqual(['owner@example.org']);
    const panel = await ctx.app.inject({ method: 'GET', url: '/v1/admin/alerts', headers: bearer(owner.token) });
    expect(panel.json().alerts).toMatchObject([{ kind: 'failed_logins', count: THRESHOLDS.failedLogin }]);
    expect(panel.json().thresholds).toMatchObject({ failedLogin: 50, storagePercent: 90 });
    // for the administrators only
    const inv = await ctx.app.inject({ method: 'GET', url: '/v1/admin/alerts' });
    expect(inv.statusCode).toBe(401);
  });
});
