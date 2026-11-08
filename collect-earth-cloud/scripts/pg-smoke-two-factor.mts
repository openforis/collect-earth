// Smoke test of two-step sign-in on a THROWAWAY PostgreSQL (it drops and creates the database `cetwofactor` and the role
// `ce_twofactor_app`): migration 028 (user_two_factor), then the whole flow through the routes as the app role: setting
// it up, signing in with a code (once), a recovery code (once), the requirement for coordinators, the users list.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npx tsx scripts/pg-smoke-two-factor.mts 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { codeAt, stepOf } from '../src/twoFactor.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const ownerUrl = `postgres://ceown:pw@${host}/cetwofactor`;
const appUrl = `postgres://ce_twofactor_app:apppw@${host}/cetwofactor`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 500));
};

const sup = new pg.Client({ connectionString: `postgres://postgres:pw@${host}/postgres` });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS cetwofactor');
await sup.query('DROP ROLE IF EXISTS ce_twofactor_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cetwofactor OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0, databaseUrl: appUrl } as any, webDir: null });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (url: string, token: string | null, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url, headers: token ? bearer(token) : {}, payload });
const owner = (await post('/v1/setup', null, { setupCode: 'X', username: 'owner', password: 'owner-password' })).json();

const setup = await post('/v1/me/two-factor/setup', owner.token);
const secret = setup.json().secret as string;
const enabled = await post('/v1/me/two-factor/enable', owner.token, { code: codeAt(secret, stepOf(Date.now())) });
check('set up and turned on (028 as the app role)', enabled.statusCode === 200 && enabled.json().recoveryCodes.length === 10, enabled.body);
const codes = enabled.json().recoveryCodes as string[];
const raw = new pg.Client({ connectionString: ownerUrl });
await raw.connect();
const row = (await raw.query('SELECT secret_enc, recovery_hashes FROM user_two_factor')).rows[0];
check('the secret is kept encrypted, the recovery codes hashed', !String(row.secret_enc).includes(secret) && !row.recovery_hashes.includes(codes[0]), row);
await raw.end();
const login = (code?: string) => post('/v1/auth/login', null, { username: 'owner', password: 'owner-password', ...(code ? { code } : {}) });
check('the password alone asks for the code', (await login()).json().error === 'second_step_required');
const next = codeAt(secret, stepOf(Date.now()) + 1);
check('a code signs in', (await login(next)).statusCode === 200);
check('the same code twice does not', (await login(next)).statusCode === 401);
check('a recovery code signs in once', (await login(codes[3])).statusCode === 200 && (await login(codes[3])).statusCode === 401);
const put = await app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { twoFactorForCoordinators: true } });
check('the requirement is saved', put.statusCode === 200 && put.json().twoFactorForCoordinators === true, put.body);
const users = (await app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(owner.token) })).json().users;
check('the users list says who has it', users[0].twoFactor === true, users);
await app.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
