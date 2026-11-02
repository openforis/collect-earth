// Smoke test of the server owner's panel (Task 11, migration 018) on a THROWAWAY PostgreSQL (it
// drops and creates the database `cepanel` and the role `ce_panel_app`): 018 twice and the
// migrations it records, the server as a NOSUPERUSER NOBYPASSRLS app role (RLS still binds it,
// and with one project set it sees no other's rows), GET /v1/admin/overview on 100,000 records
// and their events in 5 projects (totals checked against SQL, no project name, person or answer
// in the answer, timings), and disabling an account: its sessions, its login, enabling it again,
// and two platform admins disabling each other at the same time (one of them stays).
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:panel -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { hashToken } from '../src/auth.js';
import { PostgresStore } from '../src/store/postgres.js';
import { migrationFiles, runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://cepanelown:pw@${host}/cepanel`;
const appUrl = `postgres://ce_panel_app:apppw@${host}/cepanel`;
const DAY = 86_400_000;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};
const timed = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const r = await fn();
  return [r, Math.round(performance.now() - t)];
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
await sup.query('DROP DATABASE IF EXISTS cepanel');
await sup.query('DROP ROLE IF EXISTS ce_panel_app');
await sup.query("DO $$ BEGIN CREATE ROLE cepanelown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cepanel OWNER cepanelown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const cols = (await owner.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name LIKE 'disabled%' ORDER BY 1")).rows.map((r) => r.column_name);
check('018: users.disabled_at and disabled_by (twice, idempotent)', cols.join() === 'disabled_at,disabled_by', cols);
const recorded = (await owner.query('SELECT name, first_applied_at < last_applied_at AS again FROM schema_migrations ORDER BY name')).rows;
check(`schema_migrations: the ${migrationFiles().length} files, the second run noted`, recorded.length === migrationFiles().length && recorded.every((r) => r.again), recorded.length);

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0, qualityMinIntervalMs: 0, stateStaleMs: 0 } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
check('setup', res.statusCode === 201, res.body);
const ownerToken = res.json().token as string;
const ownerId = res.json().userId as string;
const project = async (name: string) => (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name } })).json().projectId as string;
const call = (method: any, pid: string, path: string, payload?: unknown, token = ownerToken) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: bearer(token), payload: payload as any });
async function join(pid: string, username: string) {
  const inv = await call('POST', pid, '/invites', { role: 'operator', maxUses: 1 });
  const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: inv.json().inviteToken } });
  return { token: r.json().token as string, userId: r.json().userId as string };
}

// --- 5 projects, 100,000 records and their events (received over the last 60 days). ---
const names = ['Secret Alpha', 'Secret Beta', 'Secret Gamma', 'Secret Delta', 'Secret Epsilon'];
const pids: string[] = [];
for (const name of names) pids.push(await project(name));
const maria = await join(pids[0], 'maria');
res = await batchRequest(app, pids[0], maria.token, [envelope({ recordKey: '1', operator: 'maria', summary: { land_use: 'Forest-XYZ' }, modifiedOn: Date.now() })]);
check('a sync through the server', res.statusCode === 200, res.body);
const now = Date.now();
const N = 100_000;
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary)
   SELECT ($1::uuid[])[1 + i % 5], 'k' || i, 'op' || (i % 40), to_timestamp(($2::bigint - (i % 60)::bigint * 86400000) / 1000.0),
          to_timestamp(($2::bigint - (i % 60)::bigint * 86400000 + 60000) / 1000.0), true, 1,
          '<record><land_use>Forest-XYZ</land_use><n>' || i || '</n></record>', jsonb_build_object('land_use', 'Forest-XYZ')
     FROM generate_series(1, $3::int) i`,
  [pids.slice(0, 4).concat(pids[4]), now, N],
);
await owner.query(
  `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change)
   SELECT project_id, record_key, operator, modified_on, received_at, true, 1, false, 'submitted' FROM records WHERE record_key LIKE 'k%'`,
);
await owner.query('ANALYZE records; ANALYZE record_events');

const overview = () => app.inject({ method: 'GET', url: '/v1/admin/overview', headers: bearer(ownerToken) });
const times: number[] = [];
for (let i = 0; i < 5; i++) {
  const [r, ms] = await timed(overview);
  res = r;
  times.push(ms);
}
const o = res.json();
check('GET /v1/admin/overview', res.statusCode === 200, res.body);
console.log(`     overview on ${N} records in 5 projects: ${times.join(', ')} ms`);
for (const secret of [...names, 'maria', 'owner', 'op1', 'Forest-XYZ', 'land_use']) {
  check(`no "${secret}" in the answer`, !res.body.includes(secret));
}
const windowFrom = Math.floor(now / DAY) * DAY - 29 * DAY;
const sqlReceived = (await owner.query('SELECT count(*)::int AS n FROM record_events WHERE received_at >= $1', [new Date(windowFrom)])).rows[0].n;
check('records received in the 30 days = SQL', o.records.received === sqlReceived, { got: o.records.received, sqlReceived });
check('30 days, a count each', o.records.receivedByDay.length === 30 && o.records.receivedByDay.every((d: any) => d.count > 0), o.records.receivedByDay);
const sqlBytes = (await owner.query('SELECT sum(octet_length(xml) + octet_length(summary::text))::bigint AS b FROM records')).rows[0].b;
check('storage = SQL (records only, no files)', o.projects.storageBytes === Number(sqlBytes), { got: o.projects.storageBytes, sqlBytes });
check('5 projects, all active, largest by id and size only', o.projects.total === 5 && o.projects.active === 5 && o.projects.largest.length === 5 && o.projects.largest.every((p: any) => Object.keys(p).sort().join() === 'projectId,storageBytes' && pids.includes(p.projectId)), o.projects);
check('accounts: owner and maria, both active', o.users.total === 2 && o.users.active === 2 && o.users.platformAdmins === 1, o.users);
check('database: size, version, migrations all applied', o.database.backend === 'postgres' && o.database.sizeBytes > 0 && /^1\d/.test(o.database.version) && o.database.migrations.applied === migrationFiles().length && o.database.migrations.missing.length === 0, o.database);
const plan = (await owner.query(
  `EXPLAIN SELECT floor(extract(epoch FROM received_at) / 86400)::bigint AS d, COUNT(*)::int FROM record_events WHERE project_id = $1 AND received_at >= $2 GROUP BY d`,
  [pids[0], new Date(windowFrom)],
)).rows.map((r) => r['QUERY PLAN']).join(' ');
console.log(`     records per day, one project: ${plan.includes('idx_record_events_project_received') ? 'uses' : 'does not use'} the received_at index (${plan.slice(0, 160)}...)`);

// --- RLS still holds for the app role. ---
const c = new pg.Client({ connectionString: appUrl });
await c.connect();
await c.query('BEGIN');
await c.query("SELECT set_config('app.current_project', $1, true)", [pids[1]]);
const seenOfA = (await c.query('SELECT count(*)::int AS n FROM records WHERE project_id = $1', [pids[0]])).rows[0].n;
const eventsOfA = (await c.query('SELECT count(*)::int AS n FROM record_events WHERE project_id = $1', [pids[0]])).rows[0].n;
const seenOfB = (await c.query('SELECT count(*)::int AS n FROM records')).rows[0].n;
check("app role with B set: none of A's records or events, only B's", seenOfA === 0 && eventsOfA === 0 && seenOfB === N / 5, { seenOfA, eventsOfA, seenOfB });
await c.query('ROLLBACK');
await c.query('BEGIN');
await c.query("SELECT set_config('app.current_project', '', true)");
check("app role with '': no records", (await c.query('SELECT count(*)::int AS n FROM records')).rows[0].n === 0);
await c.query('COMMIT');
await c.end();

// --- Disabling an account. ---
res = await app.inject({ method: 'POST', url: `/v1/admin/users/${maria.userId}/disable`, headers: bearer(ownerToken) });
check('disable maria', res.statusCode === 200 && res.json().user.disabledBy === 'owner', res.body);
check('her sessions are gone', (await owner.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [maria.userId])).rows[0].n === 0);
check("Collect Earth's next sync: 401", (await batchRequest(app, pids[0], maria.token, [envelope({ recordKey: '2', operator: 'maria' })])).statusCode === 401);
res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maria', password: 'password12' } });
check('her login: 403 account_disabled', res.statusCode === 403 && res.json().error === 'account_disabled', res.body);
// A session made by hand (as if it raced the disabling) does not pass either.
await owner.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [hashToken('raced-session'), maria.userId]);
check('a session of a disabled account is refused', (await store.resolveSession('raced-session')) === null);
await owner.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken('raced-session')]);
res = await app.inject({ method: 'GET', url: '/v1/admin/users', headers: bearer(ownerToken) });
check('the list says who disabled her', res.json().users.find((u: any) => u.username === 'maria')?.disabledBy === 'owner', res.body);
res = await app.inject({ method: 'POST', url: `/v1/admin/users/${maria.userId}/enable`, headers: bearer(ownerToken) });
check('enable maria', res.statusCode === 200 && res.json().user.disabledAt === null, res.body);
res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maria', password: 'password12' } });
check('she logs in again and syncs', res.statusCode === 200 && (await batchRequest(app, pids[0], res.json().token, [envelope({ recordKey: '2', operator: 'maria' })])).statusCode === 200, res.body);

// Two platform admins disabling each other at the same time: one stays.
await owner.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [maria.userId]);
const [x, y] = await Promise.all([store.disableUser(maria.userId, ownerId), store.disableUser(ownerId, maria.userId)]);
const left = (await owner.query('SELECT count(*)::int AS n FROM users WHERE is_platform_admin AND disabled_at IS NULL')).rows[0].n;
check('racing disables: one done, one refused, one admin left', [x, y].sort().join() === 'last_platform_admin,ok' && left === 1, { x, y, left });

await app.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
