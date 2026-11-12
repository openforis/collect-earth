// Smoke test of the server page's accounts (stage B of docs/plans/2026-11-12-server-admin.md, migration 040) on a
// THROWAWAY PostgreSQL (it drops and creates the database `ceaccounts` and the role `ce_accounts_app`): 040 twice and
// its backfill from the sessions there are, the server as a NOSUPERUSER NOBYPASSRLS app role, the accounts' dates
// (a sign-in, a session's use), the paged list and its CSV, accounts made with their links, a server administrator made
// and unmade, two administrators taking each other's role at the same time (one stays), signing out everywhere, and an
// account deleted with the project only it was in.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:accounts -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { SESSION_TOUCH_MS } from '../src/auth.js';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceaccountsown:pw@${host}/ceaccounts`;
const appUrl = `postgres://ce_accounts_app:apppw@${host}/ceaccounts`;
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
await sup.query('DROP DATABASE IF EXISTS ceaccounts');
await sup.query('DROP ROLE IF EXISTS ce_accounts_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceaccountsown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceaccounts OWNER ceaccountsown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
// 040's backfill: an account with a session made before the column, and 040 run again
await owner.query("INSERT INTO users (id, username, password_hash) VALUES ('11111111-1111-4111-8111-111111111111', 'old', 'x')");
await owner.query("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES ('h1', '11111111-1111-4111-8111-111111111111', now() - interval '3 days', now() - interval '2 days')");
await owner.query('UPDATE users SET last_active_at = NULL');
await owner.query("DELETE FROM schema_migrations WHERE name = '040_user_last_active.sql'");
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const back = (await owner.query("SELECT last_active_at FROM users WHERE username = 'old'")).rows[0].last_active_at as Date;
check('040: last_active_at filled from the sessions (twice, idempotent)', Math.abs(back.getTime() - (Date.now() - 2 * 86_400_000)) < 120_000, back);

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0, qualityMinIntervalMs: 0, stateStaleMs: 0, publicBaseUrl: 'https://ce.example.org' } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
check('setup', res.statusCode === 201, res.body);
const ownerToken = res.json().token as string;
const ownerId = res.json().userId as string;
const admin = (method: any, url: string, payload?: unknown, token = ownerToken) => app.inject({ method, url, headers: bearer(token), payload: payload as any });

// Accounts made by the administrator, their links, and the dates
res = await admin('POST', '/v1/admin/users', { accounts: [{ username: 'maria', email: 'maria@example.org' }, { username: 'ana' }, { username: 'old' }] });
const results = res.json().results;
check('accounts made: two, one name taken, links to pass on (no mail here)', res.statusCode === 201 && results.map((r: any) => r.status).join() === 'created,created,taken' && results.slice(0, 2).every((r: any) => /\/reset\//.test(r.setPasswordUrl)), res.body);
const token = results[0].setPasswordUrl.split('/reset/')[1];
res = await app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { token, newPassword: 'maria-password' } });
check('the link sets the password', res.statusCode < 300, res.body);
res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maria', password: 'maria-password' } });
const mariaToken = res.json().token as string;
const mariaId = results[0].userId as string;
let list = (await admin('GET', '/v1/admin/users?q=mar')).json();
const listed = list.users[0];
check('listed: made and last active now, the address not confirmed', list.total === 1 && listed.username === 'maria' && Date.now() - listed.createdAt < 60_000 && Date.now() - listed.lastActiveAt < 60_000 && listed.email === 'maria@example.org' && listed.emailConfirmed === false, list);
// a session's use writes the account's activity at most once per SESSION_TOUCH_MS
await owner.query("UPDATE users SET last_active_at = now() - interval '1 day' WHERE id = $1", [mariaId]);
await owner.query("UPDATE sessions SET created_at = now() - interval '1 day', last_used_at = now() - interval '1 day' WHERE user_id = $1", [mariaId]);
await store.resolveSession(mariaToken);
const touched = (await owner.query('SELECT last_active_at FROM users WHERE id = $1', [mariaId])).rows[0].last_active_at as Date;
check(`a session used after ${SESSION_TOUCH_MS / 60000} minutes: the account's activity is now`, Date.now() - touched.getTime() < 60_000, touched);
list = (await admin('GET', '/v1/admin/users?filter=inactive')).json();
check('inactive: none yet', list.total === 0, list);
res = await admin('GET', '/v1/admin/users.csv');
check('the CSV: every account', res.statusCode === 200 && res.body.split('\r\n').filter(Boolean).length === 1 + 4, res.body.slice(0, 300));

// Administrators: made, then two taking each other's role at the same time
res = await admin('POST', `/v1/admin/users/${mariaId}/platform-admin`, { on: true });
check('maria made an administrator', res.statusCode === 200 && res.json().user.isPlatformAdmin === true, res.body);
const [a, b] = await Promise.all([store.setPlatformAdmin(mariaId, false), store.setPlatformAdmin(ownerId, false)]);
const left = (await owner.query('SELECT count(*)::int AS n FROM users WHERE is_platform_admin AND disabled_at IS NULL')).rows[0].n;
check('racing role removals: one done, one refused, one administrator left', [a, b].sort().join() === 'last_platform_admin,ok' && left === 1, { a, b, left });
const stillAdmin = a === 'ok' ? ownerId : mariaId;
if (stillAdmin !== ownerId) await store.setPlatformAdmin(ownerId, true);
if (stillAdmin === ownerId) await store.setPlatformAdmin(mariaId, false);

// Signed out everywhere
const second = await store.createSession(mariaId);
res = await admin('POST', `/v1/admin/users/${mariaId}/sign-out`);
const sessions = (await owner.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [mariaId])).rows[0].n;
check('signed out everywhere: no session left', res.statusCode === 200 && sessions === 0 && (await store.resolveSession(second)) === null, { body: res.body, sessions });

// Deleted, with the project only she was in
const anaId = results[1].userId as string;
const { projectId } = await store.createProject({ name: 'Ana alone' });
await store.addMembership(projectId, anaId, 'admin');
res = await admin('DELETE', `/v1/admin/users/${anaId}`, { confirm: 'ana' });
const gone = (await owner.query('SELECT (SELECT count(*) FROM users WHERE id = $1)::int AS u, (SELECT count(*) FROM projects WHERE id = $2)::int AS p', [anaId, projectId])).rows[0];
check('deleted, and the project only she was in', res.statusCode === 200 && res.json().projectsDeleted === 1 && gone.u === 0 && gone.p === 0, { body: res.body, gone });

await app.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
