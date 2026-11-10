// Smoke test of the sign-ins' expiry on a THROWAWAY PostgreSQL (it drops and creates the database `cesessions` and the
// role `ce_sessions_app`): migration 029 (sessions.last_used_at), then, as the app role: a session used within 90 days
// is kept and its use written down (at most once an hour), one unused for longer is refused and deleted; a coordinator
// signs a member out everywhere (audited, RLS), and a person signs out everywhere else.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npx tsx scripts/pg-smoke-sessions.mts 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const ownerUrl = `postgres://ceown:pw@${host}/cesessions`;
const appUrl = `postgres://ce_sessions_app:apppw@${host}/cesessions`;
const DAY = 24 * 3_600_000;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 500));
};

const sup = new pg.Client({ connectionString: `postgres://postgres:pw@${host}/postgres` });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS cesessions');
await sup.query('DROP ROLE IF EXISTS ce_sessions_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cesessions OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0, databaseUrl: appUrl } as any, webDir: null });
const owner = (await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } })).json();
const db = new pg.Client({ connectionString: ownerUrl });
await db.connect();
const lastUsed = async () => (await db.query('SELECT last_used_at FROM sessions')).rows.map((r) => r.last_used_at as Date | null);

check('a new session has no use written down', (await lastUsed()).every((d) => d === null));
const start = Date.now();
check('used half an hour later: kept', (await store.resolveSession(owner.token, start + 1_800_000))?.userId === owner.userId);
check('...and not written down', (await lastUsed()).every((d) => d === null));
check('used 80 days later: kept', (await store.resolveSession(owner.token, start + 80 * DAY))?.userId === owner.userId);
const used = (await lastUsed())[0];
check('...and that use written down', used !== null && Math.abs(used.getTime() - (start + 80 * DAY)) < 1000, used);
check('160 days after it was made, 80 after its use: kept', (await store.resolveSession(owner.token, start + 160 * DAY))?.userId === owner.userId);
check('then 91 days unused: refused', (await store.resolveSession(owner.token, start + 251 * DAY)) === null);
check('...and deleted', (await db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n === 0);
const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${owner.token}` } });
check('the server refuses it', me.statusCode === 401, me.statusCode);

// Signing out: a coordinator, a member's two sessions, the audit entry under RLS; then oneself, everywhere else
const owner2 = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'owner', password: 'owner-password' } })).json();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const project = (await app.inject({ method: 'POST', url: '/v1/projects', headers: auth(owner2.token), payload: { name: 'Lost laptop' } })).json();
const pid = project.projectId ?? project.id;
const inv = (await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: auth(owner2.token), payload: { role: 'operator', maxUses: 1 } })).json();
const ana = (await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana', password: 'password12', inviteToken: inv.inviteToken } })).json();
const anaLaptop = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'ana', password: 'password12' } })).json().token;
const out = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/members/${ana.userId}/sign-out`, headers: auth(owner2.token) });
check('a coordinator signs a member out everywhere', out.statusCode === 204, out.body);
const status = async (t: string) => (await app.inject({ method: 'GET', url: '/v1/me', headers: auth(t) })).statusCode;
check('...both of their sessions end', (await status(ana.token)) === 401 && (await status(anaLaptop)) === 401);
const log = await app.inject({ method: 'GET', url: `/v1/projects/${pid}/activity`, headers: auth(owner2.token) });
check('...audited (member.signed_out, allowed by the constraint)', log.body.includes('member.signed_out'), log.body.slice(0, 300));
const other = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'owner', password: 'owner-password' } })).json().token;
const others = await app.inject({ method: 'POST', url: '/v1/auth/logout-others', headers: auth(owner2.token) });
check('signing out everywhere else keeps this session only', others.statusCode === 204 && (await status(owner2.token)) === 200 && (await status(other)) === 401);

await db.end();
await app.close();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
