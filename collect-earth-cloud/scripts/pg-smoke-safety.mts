// Smoke test of the server page's safety and communication (stage D of docs/plans/2026-11-12-server-admin.md,
// migration 042) on a THROWAWAY PostgreSQL (it drops and creates the database `cesafety` and the role `ce_safety_app`):
// 042 twice, the new settings read back, the lock after failed sign-ins (two failures at once never miss it), unlocked
// by an administrator and by a right password's clearing, alerts kept, listed, marked seen, the message's
// once-an-hour rule read from the activity log.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:safety -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { TestMailer } from '../src/mail.js';
import { hashPassword } from '../src/password.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://cesafetyown:pw@${host}/cesafety`;
const appUrl = `postgres://ce_safety_app:apppw@${host}/cesafety`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: superUrl });
for (let i = 0; ; i++) {
  try {
    await sup.connect();
    break;
  } catch (err) {
    if (i > 30) throw err;
    await new Promise((r) => setTimeout(r, 500));
  }
}
await sup.query('DROP DATABASE IF EXISTS cesafety');
await sup.query('DROP ROLE IF EXISTS ce_safety_app');
await sup.query("DO $$ BEGIN CREATE ROLE cesafetyown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cesafety OWNER cesafetyown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
await owner.query("DELETE FROM schema_migrations WHERE name = '042_alerts_and_locks.sql'");
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
check('042 applied twice (idempotent)', (await owner.query("SELECT to_regclass('owner_alerts') AS t")).rows[0].t !== null);

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const mailer = new TestMailer();
const app = await buildServer({
  store,
  mailer,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0, qualityMinIntervalMs: 0, stateStaleMs: 0, publicBaseUrl: 'https://ce.example.org' } as any,
  webDir: null,
  webhookFetch: async () => ({ ok: true, status: 200 }),
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
const ownerToken = res.json().token as string;
const ownerId = res.json().userId as string;
const admin = (method: any, url: string, payload?: unknown) => app.inject({ method, url, headers: bearer(ownerToken), payload: payload as any });
const login = (username: string, password: string) => app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });

// Settings
res = await admin('PUT', '/v1/admin/settings', {
  loginLockFailures: 3, loginLockMinutes: 10, minPasswordLength: 12, signupDomains: 'fao.org', alertFailedLogins: 4,
  alertWebhookUrl: 'https://hooks.slack.com/services/T/B/SECRET',
});
const read = (await admin('GET', '/v1/admin/settings')).json();
check('settings kept and read back, the webhook as its host only', res.statusCode === 200 && read.loginLockFailures === 3 && read.minPasswordLength === 12 && read.signupDomains === 'fao.org' && read.alertWebhook?.host === 'hooks.slack.com' && !JSON.stringify(read).includes('SECRET'), read);

// The lock
const ana = (await store.createUser({ username: 'ana', passwordHash: await hashPassword('ana-password-long'), email: null })).id;
await Promise.all([login('ana', 'wrong'), login('ana', 'wrong'), login('ana', 'wrong')]);
res = await login('ana', 'ana-password-long');
check('three failures at once lock the account', res.statusCode === 429 && res.json().error === 'account_locked', res.body);
const users = (await admin('GET', '/v1/admin/users?filter=locked')).json();
check('listed as locked', users.total === 1 && users.users[0].username === 'ana' && users.users[0].lockedUntil > Date.now() + 9 * 60_000, users);
res = await admin('POST', `/v1/admin/users/${ana}/unlock`);
check('unlocked by an administrator', res.json().unlocked === true && (await login('ana', 'ana-password-long')).statusCode === 200, res.body);
const row = (await owner.query('SELECT failed_logins, locked_until FROM users WHERE id = $1', [ana])).rows[0];
check('the count and the lock are cleared', row.failed_logins === 0 && row.locked_until === null, row);
await login('ana', 'wrong');
check('a right password clears the count', (await login('ana', 'ana-password-long')).statusCode === 200 && (await owner.query('SELECT failed_logins FROM users WHERE id = $1', [ana])).rows[0].failed_logins === 0);

// Alerts: four failed logins (threshold 4) raised one, kept
await new Promise((r) => setTimeout(r, 300));
let alerts = (await admin('GET', '/v1/admin/alerts')).json();
check('the alert is kept, with the thresholds in force', alerts.total >= 1 && alerts.unseen >= 1 && alerts.alerts[0].kind === 'failed_logins' && alerts.thresholds.failedLogin === 4, alerts);
res = await admin('POST', '/v1/admin/alerts/seen', { ids: [alerts.alerts[0].id] });
alerts = (await admin('GET', '/v1/admin/alerts')).json();
check('marked seen by its id', res.json().marked === 1 && alerts.alerts[0].seenBy === 'owner' && alerts.alerts[0].seenAt !== null, alerts);
check('a bad id marks nothing', (await store.markOwnerAlertsSeen(['x'], ownerId, Date.now())) === 0);

// The message: once an hour, from the log
await owner.query("UPDATE users SET email = 'owner@fao.org', email_confirmed_at = now() WHERE id = $1", [ownerId]);
const msg = { audience: 'everyone', subject: 'Hello', text: 'Maintenance tonight.' };
const preview = (await admin('POST', '/v1/admin/messages/preview', msg)).json();
check('the preview counts the confirmed addresses', preview.recipients === 1, preview);
res = await admin('POST', '/v1/admin/messages', { ...msg, recipients: 1 });
await app.mailWork?.idle();
check('sent', res.statusCode === 202 && mailer.sent.some((m) => m.tag === 'server.message.everyone' && m.to === 'owner@fao.org'), res.body);
res = await admin('POST', '/v1/admin/messages', { ...msg, recipients: 1 });
check('a second one within the hour is refused (read from the activity log)', res.statusCode === 429 && res.json().error === 'message_too_soon', res.body);

await app.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
