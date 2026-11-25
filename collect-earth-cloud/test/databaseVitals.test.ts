import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseStruggled, DatabaseVitals, SLOW_WAIT_MS } from '../src/databaseVitals.js';
import { TestMailer } from '../src/mail.js';
import { alertForChannel, alertMail, databaseText, OwnerAlerts, THRESHOLDS, type AlertDatabase, type OwnerAlert } from '../src/ownerAlerts.js';
import { DatabaseBusyError } from '../src/store/busy.js';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

// How the database kept up, told with the alerts about errors: a database too small for its load first shows as
// requests waiting for it (cloud.collectearth.org, load tests of November 2026; DEPLOY.md, "Is the database big enough?").

const clock = (start = 1_800_000_000_000) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe('the database vitals', () => {
  it('say whether the database was busy this minute or the one before', () => {
    const c = clock();
    const v = new DatabaseVitals(c.now);
    expect(v.busyLately()).toBe(false);
    v.noteWait(SLOW_WAIT_MS * 3);
    expect(v.busyLately()).toBe(false);
    v.noteBusy();
    expect(v.busyLately()).toBe(true);
    c.advance(60_000);
    expect(v.busyLately()).toBe(true);
    c.advance(60_000);
    expect(v.busyLately()).toBe(false);
  });

  it('count the last hour\'s waits, the slow ones and the busy answers, a minute at a time', () => {
    const c = clock();
    const v = new DatabaseVitals(c.now);
    expect(v.summary()).toEqual({ waits: 0, slow: 0, busy: 0, maxWaitMs: 0, p95WaitMs: null });
    for (let i = 0; i < 95; i++) v.noteWait(3);
    for (let i = 0; i < 5; i++) v.noteWait(SLOW_WAIT_MS + 500 * i);
    v.noteBusy();
    expect(v.summary()).toEqual({ waits: 100, slow: 5, busy: 1, maxWaitMs: 3000, p95WaitMs: 5 });
    expect(databaseStruggled(v.summary())).toBe(true);
    // 59 minutes on: still the same hour
    c.advance(59 * 60_000);
    v.noteWait(2);
    expect(v.summary()).toMatchObject({ waits: 101, slow: 5, busy: 1 });
    // an hour after the first minute: only the last minute's wait is left
    c.advance(60_000);
    expect(v.summary()).toEqual({ waits: 1, slow: 0, busy: 0, maxWaitMs: 2, p95WaitMs: 5 });
    expect(databaseStruggled(v.summary())).toBe(false);
  });

  it('say the 95th percentile by the histogram\'s bounds, and the longest wait beyond the last one', () => {
    const v = new DatabaseVitals(clock().now);
    for (let i = 0; i < 10; i++) v.noteWait(40_000);
    expect(v.summary()).toMatchObject({ p95WaitMs: 40_000, maxWaitMs: 40_000, slow: 10 });
  });
});

const struggling: AlertDatabase = { waits: 900, slow: 42, busy: 17, maxWaitMs: 9_850, p95WaitMs: 2500, connectTimeoutMs: 10_000 };
const healthy: AlertDatabase = { waits: 900, slow: 0, busy: 0, maxWaitMs: 12, p95WaitMs: 5, connectTimeoutMs: 10_000 };

describe('the alerts about errors', () => {
  it('carry the database\'s hour when it did not keep up, and only then', () => {
    const told: OwnerAlert[] = [];
    let database = struggling;
    const alerts = new OwnerAlerts({ now: clock().now, notify: (a) => void told.push(a), database: () => database });
    alerts.note('serverError', THRESHOLDS.serverError);
    expect(told[0]).toMatchObject({ kind: 'server_errors', database: struggling });
    // refused records too; failed logins never (nothing to do with the database)
    alerts.note('syncError', THRESHOLDS.syncError);
    alerts.note('failedLogin', THRESHOLDS.failedLogin);
    expect(told.map((a) => [a.kind, a.database !== undefined])).toEqual([
      ['server_errors', true],
      ['sync_errors', true],
      ['failed_logins', false],
    ]);
    // a database that kept up: not said
    database = healthy;
    const later: OwnerAlert[] = [];
    const again = new OwnerAlerts({ now: clock().now, notify: (a) => void later.push(a), database: () => database });
    again.note('serverError', THRESHOLDS.serverError);
    expect(later[0].database).toBeUndefined();
  });

  it('say it in the mail and the webhook, in the administrator\'s language', () => {
    const alert: OwnerAlert = { kind: 'server_errors', at: 0, count: 23, database: struggling };
    const mail = alertMail(alert, 'en', 'CE Cloud', null);
    expect(mail.text).toContain('The server answered 23 requests with an error in the last hour.');
    expect(mail.text).toContain('17 requests found no free connection to the database within 10 s and were answered "busy".');
    expect(mail.text).toContain('42 requests waited more than a second for a connection, the longest 9.9 s');
    expect(mail.text).toContain('"Is the database big enough?"');
    expect(mail.html).toContain('Cloud SQL');
    // the decimal as the language writes it
    expect(databaseText(struggling, 'es')).toContain('la más larga 9,9 s');
    expect(databaseText(struggling, 'fr')).toContain('la plus longue 9,9 s');
    // only what happened: no busy answer, no sentence about them
    expect(databaseText({ ...struggling, busy: 0 }, 'en')).not.toContain('"busy"');
    expect(databaseText({ ...struggling, slow: 0 }, 'en')).not.toContain('more than a second');
    const channel = alertForChannel(alert, 'en', 'CE Cloud');
    expect(channel.text).toMatch(/with an error in the last hour\. .*\n\nThe database in the last hour/s);
    // an alert without it: the text as before
    expect(alertMail({ kind: 'server_errors', at: 0, count: 23 }, 'en', 'CE Cloud', null).text).not.toContain('database');
  });
});

describe('a running server whose database is busy', () => {
  let ctx: TestContext;
  afterEach(async () => {
    vi.restoreAllMocks();
    await ctx.app.close();
  });

  it('counts its busy answers and says them in the server errors alert it mails', async () => {
    const mailer = new TestMailer();
    const vitals = new DatabaseVitals();
    ctx = await makeContext({ publicBaseUrl: 'https://ce.example.org', dbConnectTimeoutMs: 10_000 }, { mailer, databaseVitals: vitals });
    const owner = await setupPlatformAdmin(ctx.app);
    await ctx.store.setEmail(owner.userId, 'owner@example.org');
    await ctx.store.confirmEmail(owner.userId, 'owner@example.org', Date.now());
    const p = await createProject(ctx.app, 'Busy');
    vi.spyOn(ctx.store, 'getProject').mockRejectedValue(new DatabaseBusyError());
    for (let i = 0; i < THRESHOLDS.serverError; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}`, headers: bearer(p.adminToken) })).statusCode).toBe(503);
    }
    expect(vitals.summary().busy).toBe(THRESHOLDS.serverError);
    await vi.waitFor(() => expect(mailer.sent.some((m) => m.tag === 'owner.alert.server_errors')).toBe(true));
    const mail = mailer.sent.find((m) => m.tag === 'owner.alert.server_errors')!;
    expect(mail.text).toContain(`${THRESHOLDS.serverError} requests found no free connection to the database within 10 s`);
  });
});
