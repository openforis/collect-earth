import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorLog, MAX_BYTES } from '../src/errorLog.js';
import { TestMailer } from '../src/mail.js';
import { alertMail, errorLogAttachment, OwnerAlerts, STORAGE_PERCENT, THRESHOLDS, type OwnerAlert } from '../src/ownerAlerts.js';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

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

  it('say when the error log is attached, in every language', () => {
    for (const language of ['en', 'es', 'fr', 'pt', 'tr'] as const) {
      const without = alertMail({ kind: 'server_errors', at: 0, count: 20 }, language, 'CE', null);
      const withLog = alertMail({ kind: 'server_errors', at: 0, count: 20 }, language, 'CE', null, 'ce-errors.log');
      expect(without.text).not.toContain('ce-errors.log');
      expect(withLog.text).toContain('ce-errors.log');
      expect(withLog.html).toContain('ce-errors.log');
      expect(withLog.text).toContain('500');
    }
  });

  it('attach the error log to the server errors mail only', () => {
    const at = Date.UTC(2026, 10, 20, 1, 23);
    expect(errorLogAttachment({ kind: 'server_errors', at }, 'Collect Earth Cloud', 'a line\n')).toEqual({
      filename: 'collect-earth-cloud-errors-2026-11-20T01-23Z.log', content: 'a line\n', contentType: 'text/plain; charset=utf-8',
    });
    expect(errorLogAttachment({ kind: 'server_errors', at }, 'CE', null)).toBeNull();
    expect(errorLogAttachment({ kind: 'failed_logins', at }, 'CE', 'a line\n')).toBeNull();
    expect(errorLogAttachment({ kind: 'server_errors', at }, '¡¡', 'x')?.filename).toBe('server-errors-2026-11-20T01-23Z.log');
  });
});

describe('the error log the alert mail carries', () => {
  const line = (level: number, msg: string) => JSON.stringify({ level, time: 1, msg });

  it('keeps the warnings and errors only', () => {
    const log = new ErrorLog();
    log.add(line(30, 'request completed'));
    log.add(line(40, 'database busy'));
    log.add(line(50, 'boom'));
    log.add(line(60, 'fatal'));
    log.add('not json at all');
    expect(log.text()).toBe(`${line(40, 'database busy')}\n${line(50, 'boom')}\n${line(60, 'fatal')}\n`);
    expect(new ErrorLog().text()).toBeNull();
  });

  it('keeps at most 500 KB, the newest lines', () => {
    const log = new ErrorLog();
    const big = (n: number) => line(50, `${n} ${'x'.repeat(1000)}`);
    for (let n = 0; n < 2000; n++) log.add(big(n));
    const text = log.text()!;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_BYTES);
    expect(Buffer.byteLength(text)).toBeGreaterThan(MAX_BYTES - 1100);
    expect(text.endsWith(`${big(1999)}\n`)).toBe(true);
    expect(text).not.toContain(`"0 x`);
    // a line alone over the limit: its start
    const one = new ErrorLog(100);
    one.add(line(50, 'y'.repeat(500)));
    expect(Buffer.byteLength(one.text()!)).toBeLessThanOrEqual(100);
    expect(one.text()!.startsWith('{"level":50')).toBe(true);
  });

  it('passes every line on to the log as before', async () => {
    const log = new ErrorLog();
    const written: string[] = [];
    const target = new Writable({ write: (chunk, _e, cb) => { written.push(chunk.toString()); cb(); } });
    const tee = log.tee(target);
    await new Promise<void>((r) => tee.write(`${line(30, 'info')}\n`, () => r()));
    await new Promise<void>((r) => tee.write(`${line(50, 'error')}\n`, () => r()));
    expect(written.join('')).toBe(`${line(30, 'info')}\n${line(50, 'error')}\n`);
    expect(log.size()).toBe(1);
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

  it('attach the server\'s recent errors to the server errors mail, as the log wrote them', { timeout: 60_000 }, async () => {
    const mailer = new TestMailer();
    const logged: string[] = [];
    const stream = new Writable({ write: (chunk, _e, cb) => { logged.push(chunk.toString()); cb(); } });
    ctx = await makeContext({ publicBaseUrl: 'https://ce.example.org' }, { mailer, logger: { stream, level: 'info' } });
    const owner = await setupPlatformAdmin(ctx.app);
    await ctx.store.setEmail(owner.userId, 'owner@example.org');
    await ctx.store.confirmEmail(owner.userId, 'owner@example.org', Date.now());
    ctx.app.ownerAlerts!.setThresholds({ ...ctx.app.ownerAlerts!.currentThresholds(), serverError: 3 });
    const p = await createProject(ctx.app, 'Errors');
    vi.spyOn(ctx.store, 'getProject').mockRejectedValue(Object.assign(new Error('the disk is on fire'), { code: '23505', detail: 'Key (email)=(someone@example.org) already exists.' }));
    for (let i = 0; i < 3; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}?token=secret-in-the-address`, headers: bearer(p.adminToken) })).statusCode).toBe(500);
    }
    vi.restoreAllMocks();
    await new Promise((r) => setTimeout(r, 50));
    const sent = mailer.sent.filter((m) => m.tag === 'owner.alert.server_errors');
    expect(sent).toHaveLength(1);
    const [file] = sent[0].attachments!;
    expect(file.filename).toMatch(/-errors-\d{4}-\d\d-\d\dT\d\d-\d\dZ\.log$/);
    expect(file.content).toContain('the disk is on fire');
    expect(file.content.trim().split('\n').every((l) => JSON.parse(l).level >= 40)).toBe(true);
    // the log's own redaction: what the log says, nothing more
    expect(file.content).not.toContain('secret-in-the-address');
    // the error's name, message, code and stack, not the values a database error holds
    const failed = file.content.trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.message === 'request failed');
    expect(failed.failure).toMatchObject({ type: 'Error', message: 'the disk is on fire', code: '23505' });
    expect(failed.failure.stack).toContain('the disk is on fire');
    expect(file.content).not.toContain('someone@example.org');
    expect(logged.join('')).toContain('the disk is on fire');
    expect(sent[0].text).toContain(file.filename);
    // other alerts carry nothing
    for (let i = 0; i < THRESHOLDS.failedLogin; i++) {
      await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: `nobody${i}`, password: 'wrong-password' } });
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(mailer.sent.find((m) => m.tag === 'owner.alert.failed_logins')?.attachments).toBeUndefined();
  });
});
