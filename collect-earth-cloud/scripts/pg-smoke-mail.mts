// Smoke test of the email digests (Task 19) on a THROWAWAY PostgreSQL (it drops and creates the
// database `cemail` and the role `ce_mail_app`): migration 023 twice, its checks, the account tables
// global as users (no RLS, the app role's rights), the account page's routes, a confirmation link,
// the weekly run through the server as a NOSUPERUSER NOBYPASSRLS app role (a test transport: no mail
// leaves), never twice (two instances at once), a failed mail put back, one-click unsubscribe, a
// deleted account's subscriptions gone; then a run timed over 40 subscribers of a project of
// 100,000 records and 10,000 subscriptions without a confirmed address.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55485:5432 postgres:16
//   npm run smoke:pg:mail -- 55485        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { dueWeek } from '../src/digest.js';
import { TestMailer } from '../src/mail.js';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { weekMonday } from '../src/weekly.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55485';
const big = Number(process.argv[3] ?? 100_000);
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cemail`;
const appUrl = `postgres://ce_mail_app:apppw@${host}/cemail`;
const SECRET = 'a-digest-secret-of-at-least-32-characters';
const DAY = 86_400_000;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sup = new pg.Client({ connectionString: superUrl });
for (let i = 0; ; i++) {
  try {
    await sup.connect();
    break;
  } catch (err) {
    if (i > 30) throw err;
    await sleep(500);
  }
}
await sup.query('DROP DATABASE IF EXISTS cemail');
await sup.query('DROP ROLE IF EXISTS ce_mail_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cemail OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
check('023 ran twice', true);

const own = new pg.Client({ connectionString: ownerUrl });
await own.connect();
const cols = (await own.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('email_confirmed_at', 'mail_language', 'mail_time_zone') ORDER BY 1")).rows.map((r) => r.column_name);
const rls = (await own.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('users', 'digest_subscriptions') ORDER BY 1")).rows;
check('users has the mail columns; digest_subscriptions and users are global (no RLS), as 002 says', cols.join() === 'email_confirmed_at,mail_language,mail_time_zone' && rls.length === 2 && rls.every((r) => r.relrowsecurity === false), { cols, rls });
const refused = async (sql: string, params: unknown[]) => {
  try {
    await own.query(sql, params);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'error';
  }
};

const mailer = new TestMailer();
const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
let clock = Date.now() + 10 * DAY;
const config = { port: 0, host: '127.0.0.1', storeBackend: 'postgres', databaseUrl: appUrl, adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, stateStaleMs: 0, qualityMinIntervalMs: 0, digestSecret: SECRET, publicBaseUrl: 'https://ce.example.org' } as any;
const app = await buildServer({ store, config, webDir: null, mailer, ai: { now: () => clock } });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
const ownerToken = res.json().token as string;
const ownerId = res.json().userId as string;
const created = (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name: 'Forest inventory' } })).json();
const pid = created.projectId as string;
const call = (method: any, path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as any });
const me = (method: any, path: string, token: string, payload?: unknown) => app.inject({ method, url: `/v1/me${path}`, headers: bearer(token), payload: payload as any });
const invite = (await call('POST', '/invites', ownerToken, { role: 'operator', maxUses: 1 })).json().inviteToken;
res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'maria', password: 'password12', inviteToken: invite } });
const maria = { token: res.json().token as string, userId: res.json().userId as string };
await call('PUT', '/cep', ownerToken, idOnlyCep(), { 'content-type': 'application/zip' });
const csv = (await call('PUT', '/csv-files/plots.csv', ownerToken, 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n', { 'content-type': 'text/csv' })).json().id;
await call('PUT', '/assignments', ownerToken, { assignments: [{ userId: maria.userId, csvFileId: csv }] });
const monday = Date.parse(`${weekMonday(dueWeek(clock, 'UTC'))}T12:00:00Z`);
res = await batchRequest(app, pid, maria.token, [
  envelope({ recordKey: '1', operator: 'maria', modifiedOn: monday + DAY, activelySaved: true, summary: { secret: 'ForestSecretAnswer' } }),
  envelope({ recordKey: '2', operator: 'maria', modifiedOn: monday + 2 * DAY, activelySaved: true }),
]);
check('records', res.statusCode === 200, res.body);

// The constraints.
check('a language other than the four is refused', (await refused("UPDATE users SET mail_language = 'xx' WHERE id = $1", [ownerId])) === '23514');
check('a week not written YYYY-Www is refused', (await refused("INSERT INTO digest_subscriptions (user_id, kind, last_sent_week) VALUES ($1, 'collector', 'week 44')", [ownerId])) === '23514');
check('a kind other than the two is refused', (await refused("INSERT INTO digest_subscriptions (user_id, kind) VALUES ($1, 'daily')", [ownerId])) === '23514');

// The account page: address, confirmation, digests.
// Subscribed a week before the server's clock (a week that ended before a subscription is never sent).
const subscribe = async (token: string, email: string, kinds: object, language = 'en') => {
  clock -= 7 * DAY;
  try {
    const set = await me('PUT', '/email', token, { email, language });
    const link = /\/confirm-email\/([A-Za-z0-9_.-]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1];
    const ok = await app.inject({ method: 'POST', url: '/v1/email/confirm', payload: { token: link } });
    const on = await me('PUT', '/notifications', token, { ...kinds, language, timeZone: 'UTC' });
    return { set: set.statusCode, confirmed: ok.statusCode, on: on.statusCode, body: on.json() };
  } finally {
    clock += 7 * DAY;
  }
};
const o = await subscribe(ownerToken, 'owner@example.org', { coordinator: true });
const m = await subscribe(maria.token, 'maria@example.org', { collector: true }, 'pt');
check('address saved, confirmed by its link, digests on', [o.set, o.confirmed, o.on, m.set, m.confirmed, m.on].every((s) => s === 200) && o.body.emailConfirmed === true && o.body.digests.coordinator.on === true && m.body.digests.collector.on === true, { o, m });
const row = (await own.query('SELECT email, email_confirmed_at, mail_language, mail_time_zone FROM users WHERE id = $1', [maria.userId])).rows[0];
check('stored: the address, when it was confirmed, the language and zone', row.email === 'maria@example.org' && row.email_confirmed_at !== null && row.mail_language === 'pt' && row.mail_time_zone === 'UTC', row);
await store.setEmail(maria.userId, 'maria@example.org');
check('the same address keeps its confirmation', (await store.getAccountMail(maria.userId))!.emailConfirmedAt !== null);

// The run.
const digest = (target = app) => target.inject({ method: 'POST', url: '/v1/internal/digest', headers: { 'x-digest-secret': SECRET } });
check('a wrong secret is refused', (await app.inject({ method: 'POST', url: '/v1/internal/digest', headers: { 'x-digest-secret': 'nope' } })).statusCode === 401);
const before = mailer.sent.length;
// A second instance on the same database, at the same time: each mail once.
const other = await buildServer({ store: new PostgresStore(appUrl), config, webDir: null, mailer, ai: { now: () => clock } });
const [r1, r2] = await Promise.all([digest(), digest(other)]);
const sent = mailer.sent.slice(before).filter((x) => x.tag.startsWith('digest.'));
check('two instances at once: two mails in all, one each', r1.statusCode === 200 && r2.statusCode === 200 && sent.length === 2 && new Set(sent.map((x) => x.to)).size === 2, [r1.json(), r2.json(), sent.map((x) => x.to)]);
const coord = sent.find((x) => x.to === 'owner@example.org')!;
const coll = sent.find((x) => x.to === 'maria@example.org')!;
check("the coordinator's mail: the week, the project, the link", coord.text.includes('Plots done this week: 2') && coord.text.includes(`/projects/${pid}/activity/week/`), coord.text);
check("the collector's mail (pt): her own week, nobody else's name, no answer", coll.text.includes('Parcelas que você enviou esta semana: 2') && !coll.text.includes('owner') && !coll.text.includes('ForestSecretAnswer'), coll.text);
const stored = (await own.query('SELECT kind, last_sent_week, last_sent_at FROM digest_subscriptions ORDER BY kind')).rows;
check('the week stored per account and kind', stored.length === 2 && stored.every((s) => s.last_sent_week === dueWeek(clock, 'UTC') && s.last_sent_at !== null), stored);
res = await digest();
check('again: nothing sent', res.json().sent === 0 && mailer.sent.length === before + 2, res.json());

// A failed mail is put back; the next run sends it.
clock += 7 * DAY;
mailer.fail = (x) => x.to === 'maria@example.org';
res = await digest();
check('a failed mail: counted, its week put back', res.json().failed === 1 && res.json().sent === 1, res.json());
mailer.fail = null;
res = await digest();
check('the next run sends it', res.json().sent === 1 && res.json().failed === 0, res.json());

// One-click unsubscribe.
const url = /^<(.+)>$/.exec(coll.headers!['List-Unsubscribe'])![1];
res = await app.inject({ method: 'POST', url: new URL(url).pathname, payload: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const left = (await own.query('SELECT kind FROM digest_subscriptions')).rows.map((r) => r.kind);
check('one click, no login: that digest off', res.statusCode === 200 && left.join() === 'coordinator', [res.body, left]);

// Confirmation mails: the per-account cap checked and counted at once (12 at the same moment: 3 pass).
const at = clock + DAY;
const reserved = await Promise.all(Array.from({ length: 12 }, () => store.reserveConfirmationSend(ownerId, at, { perHour: 3, perDay: 6 })));
const rows = (await own.query('SELECT count(*)::int AS n FROM email_confirmation_sends WHERE user_id = $1 AND sent_at = $2', [ownerId, new Date(at)])).rows[0].n;
check('confirmation cap: 12 at once, 3 counted and allowed', reserved.filter(Boolean).length === 3 && rows === 3, { reserved, rows });
check('confirmation cap: a day later the old ones are dropped and it allows again', (await store.reserveConfirmationSend(ownerId, at + DAY + 1, { perHour: 3, perDay: 6 })) === true && (await own.query('SELECT count(*)::int AS n FROM email_confirmation_sends WHERE user_id = $1 AND sent_at <= $2', [ownerId, new Date(at)])).rows[0].n === 0);

// Refusals for good: three in a row stop a subscription; it is no longer listed; turned on, it starts again.
const stops = [];
for (let i = 0; i < 3; i++) stops.push(await store.noteDigestFailure(ownerId, 'coordinator', clock, 3));
const listedStopped = (await store.listDueDigests({ before: '9999-W01', after: null, limit: 100 })).some((d) => d.userId === ownerId && d.kind === 'coordinator');
check('three refusals for good stop it, and the job no longer reads it', stops.join() === 'false,false,true' && !listedStopped, { stops, listedStopped });
await store.setDigest(ownerId, 'coordinator', true, clock);
const restarted = (await own.query("SELECT failures, stopped_at FROM digest_subscriptions WHERE user_id = $1 AND kind = 'coordinator'", [ownerId])).rows[0];
check('turned on again: no failures, not stopped', restarted.failures === 0 && restarted.stopped_at === null, restarted);
await store.markDigestSent(ownerId, 'coordinator', '2026-W40', clock);
const mailed = (await own.query("SELECT last_mailed_week FROM digest_subscriptions WHERE user_id = $1 AND kind = 'coordinator'", [ownerId])).rows[0];
check('the week a mail went for is stored apart', mailed.last_mailed_week === '2026-W40', mailed);

// A deleted account takes its subscriptions.
await me('PUT', '/notifications', maria.token, { collector: true, language: 'pt', timeZone: 'UTC' });
res = await app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(maria.token), payload: { password: 'password12' } });
const gone = (await own.query('SELECT count(*)::int AS n FROM digest_subscriptions WHERE user_id = $1', [maria.userId])).rows[0].n;
check("a deleted account's subscriptions go", res.statusCode === 204 && gone === 0, [res.statusCode, gone]);

// Timed: 40 collectors of a project of `big` records (and the coordinator), with 10,000 more
// subscriptions whose address is not confirmed (read and passed over).
const t0All = performance.now();
const names = Array.from({ length: 40 }, (_, i) => `op${i}`);
const ops: string[] = [];
for (const name of names) {
  const u = await store.createUser({ username: name, passwordHash: 'x', email: null });
  await store.addMembership(pid, u.id, 'operator');
  await store.setEmail(u.id, `${name}@example.org`);
  await store.confirmEmail(u.id, `${name}@example.org`, Date.now());
  await store.setDigest(u.id, 'collector', true, clock - 7 * DAY);
  ops.push(u.id);
}
const ids = Array.from({ length: big }, (_, i) => 100_000 + i + 1);
const bigCsv = (await call('PUT', '/csv-files/big.csv', ownerToken, `id,lat,lon\n${ids.map((id) => `${id},1,1`).join('\n')}\n`, { 'content-type': 'text/csv' })).json();
await call('PUT', '/assignments', ownerToken, { assignments: ops.map((userId) => ({ userId, csvFileId: bigCsv.id })) });
await own.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml)
   SELECT $1, (100000 + g)::text, 'op' || (g % 40), $3::timestamptz - (g % 30) * interval '1 day', now(), g % 5 <> 0, 1, '<plot/>'
     FROM generate_series(1, $2) g`,
  [pid, big, new Date(clock)],
);
await own.query(
  `INSERT INTO users (id, username, password_hash, email) SELECT gen_random_uuid(), 'idle' || g, 'x', 'idle' || g || '@example.org' FROM generate_series(1, 10000) g`,
);
await own.query(`INSERT INTO digest_subscriptions (user_id, kind) SELECT id, 'collector' FROM users WHERE username LIKE 'idle%'`);
console.log(`     set up in ${Math.round(performance.now() - t0All)} ms`);
clock += 7 * DAY;
const mailsBefore = mailer.sent.length;
let t0 = performance.now();
res = await digest();
const ms = performance.now() - t0;
const r = res.json();
check(`a run: 41 mails (40 collectors and the coordinator), 10,000 passed over`, r.sent === 41 && r.skipped === 10_000 && r.more === false && mailer.sent.length === mailsBefore + 41, r);
console.log(`     the run on ${big} records: ${Math.round(ms)} ms in all (${Math.round(ms / 41)} ms a mail, the project state built once)`);
const op0 = mailer.sent.slice(mailsBefore).find((x) => x.to === 'op0@example.org')!;
const work = (await store.listDueDigests({ before: '9999-W01', after: null, limit: 1 }))[0];
check("a collector's mail names nobody else", !/op1\b|op2\b|owner/.test(op0.text), op0.text);
t0 = performance.now();
res = await digest();
check('again at once: nothing to send, 10,000 passed over', res.json().sent === 0 && res.json().skipped === 10_000, res.json());
console.log(`     a run with nothing to send over 10,041 subscriptions: ${Math.round(performance.now() - t0)} ms`);
t0 = performance.now();
const page = await store.listDueDigests({ before: '9999-W01', after: { userId: work.userId, kind: work.kind }, limit: 50 });
console.log(`     a page of 50 due subscriptions: ${Math.round(performance.now() - t0)} ms (${page.length})`);
// A bounded run stops and says so.
clock += 7 * DAY;
res = await app.inject({ method: 'POST', url: '/v1/internal/digest', headers: { 'x-digest-secret': SECRET }, payload: { maxMails: 5 } });
check('a bounded run says there is more', res.json().sent === 5 && res.json().more === true, res.json());
res = await digest();
check('the next call sends the rest', res.json().sent === 36 && res.json().more === false, res.json());

await own.end();
await other.close();
await app.close();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
