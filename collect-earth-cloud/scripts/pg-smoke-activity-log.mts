// Smoke test of the Activity tab (Task 10, migration 017) on a THROWAWAY PostgreSQL (it drops
// and creates the database `celog` and the role `ce_log_app`): 017 twice, the server as a
// NOSUPERUSER NOBYPASSRLS app role, the bell's read state (RLS between two projects, gone with
// the member), and the log on 100,000 record events and 2,000 audit entries: every page read
// once by its cursor (nothing lost or repeated), a person, a kind, a date window, with timings;
// the weekly summary and the daily activity download on it.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:activity -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://celogown:pw@${host}/celog`;
const appUrl = `postgres://ce_log_app:apppw@${host}/celog`;
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
await sup.query('DROP DATABASE IF EXISTS celog');
await sup.query('DROP ROLE IF EXISTS ce_log_app');
await sup.query("DO $$ BEGIN CREATE ROLE celogown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE celog OWNER celogown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const rls = (await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'attention_reads'")).rows[0];
check('017: attention_reads with RLS (twice, idempotent)', rls?.relrowsecurity === true, rls);

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, qualityMinIntervalMs: 0, stateStaleMs: 0 } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
check('setup', res.statusCode === 201, res.body);
const ownerToken = res.json().token as string;
const ownerId = res.json().userId as string;
const project = async (name: string) => (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name } })).json().projectId as string;
const a = await project('Alpha');
const b = await project('Beta');
const call = (method: any, pid: string, path: string, payload?: unknown, headers: Record<string, string> = {}, token = ownerToken) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as any });
async function join(pid: string, username: string, role = 'operator') {
  const inv = await call('POST', pid, '/invites', { role, maxUses: 1 });
  const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: inv.json().inviteToken } });
  return { token: r.json().token as string, userId: r.json().userId as string };
}
const maria = await join(a, 'maria');
const rita = await join(a, 'rita', 'reviewer');
check('CEP', (await call('PUT', a, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
res = await call('PUT', a, '/csv-files/plots.csv', ['id,lat,lon', ...Array.from({ length: 200 }, (_, i) => `${i + 1},0,0`)].join('\n'), { 'content-type': 'text/csv' });
const fileId = res.json().id as string;
await call('PUT', a, '/assignments', { assignments: [{ userId: maria.userId, csvFileId: fileId }] });
await batchRequest(app, a, maria.token, [envelope({ recordKey: '1,1', operator: 'maria', modifiedOn: Date.now() - 3600_000 })]);

// --- The bell. ---
res = await call('GET', a, '/attention');
check('GET /attention (coordinator)', res.statusCode === 200 && Array.isArray(res.json().items), res.body);
const items = res.json().items as { key: string }[];
res = await call('POST', a, '/attention/read', { all: true });
check('all read, kept in attention_reads', res.statusCode === 200 && res.json().unread === 0 && (await store.listAttentionReads(a, ownerId)).length === items.length, res.body);
check('a reviewer: 403', (await call('GET', a, '/attention', undefined, {}, rita.token)).statusCode === 403);
const c = new pg.Client({ connectionString: appUrl });
await c.connect();
await c.query('BEGIN');
await c.query("SELECT set_config('app.current_project', $1, true)", [b]);
check("with B set: A's reads not seen", (await c.query('SELECT count(*)::int AS n FROM attention_reads')).rows[0].n === 0);
let refused = false;
try {
  await c.query('INSERT INTO attention_reads (project_id, user_id, item_key) VALUES ($1, $2, $3)', [a, ownerId, 'x:1']);
} catch {
  refused = true;
}
check("with B set: a row of A refused", refused);
await c.query('ROLLBACK');
await c.query('BEGIN');
await c.query("SELECT set_config('app.current_project', '', true)");
check("with '': no rows, no error", (await c.query('SELECT count(*)::int AS n FROM attention_reads')).rows[0].n === 0);
await c.query('COMMIT');
await c.end();
await store.setAttentionReads(a, maria.userId, ['quiet:1']);
await call('DELETE', a, `/members/${maria.userId}`);
check('removeMember drops their reads', (await owner.query('SELECT count(*)::int AS n FROM attention_reads WHERE user_id = $1', [maria.userId])).rows[0].n === 0);

// --- 100,000 record events and 2,000 audit entries in project "Big". ---
const big = await project('Big');
const N = 100_000;
await owner.query(`INSERT INTO users (id, username, password_hash) SELECT gen_random_uuid(), 'op' || k, 'x' FROM generate_series(0, 39) k`);
await owner.query(`INSERT INTO project_members (project_id, user_id, role) SELECT $1, id, 'operator' FROM users WHERE username LIKE 'op%'`, [big]);
const t0 = Date.UTC(2026, 8, 1);
// One event every 90 s over ~104 days; every 10th a draft, every 997th deleted; many at the same time (pairs).
await owner.query(
  `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change)
   SELECT $1::uuid, i::text, 'op' || (i % 40), to_timestamp(($2::bigint + (i / 2)::bigint * 180000) / 1000.0), to_timestamp(($2::bigint + (i / 2)::bigint * 180000 + 60000) / 1000.0),
          i % 10 <> 0, 0, i % 997 = 0,
          CASE WHEN i % 997 = 0 THEN 'deleted' WHEN i % 10 = 0 THEN 'updated' ELSE 'submitted' END
     FROM generate_series(1, $3::int) i`,
  [big, t0, N],
);
await owner.query(
  `INSERT INTO audit_log (project_id, at, actor_user_id, action, details)
   SELECT $1::uuid, to_timestamp(($2::bigint + i::bigint * 4500000) / 1000.0), $3::uuid, CASE WHEN i % 2 = 0 THEN 'decision.set' ELSE 'csv.uploaded' END,
          CASE WHEN i % 2 = 0 THEN jsonb_build_object('plot', i::text, 'decision', 'first') ELSE jsonb_build_object('csvFileId', gen_random_uuid()::text, 'plots', 10) END
     FROM generate_series(1, 2000) i`,
  [big, t0, ownerId],
);
await owner.query('ANALYZE record_events; ANALYZE audit_log');
await call('GET', big, '/activity?limit=1'); // the project state, built once

const seen = new Set<string>();
let cursor = '';
let pages = 0;
const times: number[] = [];
let total = 0;
for (;;) {
  const [r, ms] = await timed(() => call('GET', big, `/activity?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
  if (r.statusCode !== 200) {
    check('a page of the log', false, r.body);
    break;
  }
  times.push(ms);
  const body = r.json();
  for (const item of body.items) seen.add(item.id);
  total += body.items.length;
  pages += 1;
  if (!body.next) break;
  cursor = body.next;
}
const sorted = [...times].sort((x, y) => x - y);
check(`every row once over ${pages} pages of 200 (100,000 events + 2,000 actions)`, total === N + 2000 && seen.size === N + 2000, { total, unique: seen.size });
console.log(`     pages of 200: median ${sorted[sorted.length >> 1]} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]} ms, max ${sorted.at(-1)} ms, first ${times[0]} ms, last ${times.at(-1)} ms`);
for (const [what, query] of [
  ['first page of 50', ''],
  ['a person', '?person=op7'],
  ['a kind (deleted, rare)', '?kind=deleted'],
  ['a kind (decisions)', '?kind=decisions'],
  ['a date window', `?from=${t0 + 50 * 86_400_000}&to=${t0 + 51 * 86_400_000}`],
  ['a person and a kind', '?person=op10&kind=draft'],
] as const) {
  const runs: number[] = [];
  let body: any;
  for (let i = 0; i < 5; i++) {
    const [r, ms] = await timed(() => call('GET', big, `/activity${query}`));
    body = r.json();
    runs.push(ms);
  }
  runs.sort((x, y) => x - y);
  check(`${what}: ${body.items.length} rows, median ${runs[2]} ms (5 runs: ${runs.join(', ')})`, Array.isArray(body.items) && body.items.length > 0, body);
}
const deep = await call('GET', big, `/activity?kind=deleted&limit=200`);
check('kind=deleted: only deletions, all of them (100 of 100,000)', deep.json().items.length === 100 && deep.json().items.every((i: any) => i.change === 'deleted'), deep.json().items.length);
check('a refused cursor: 400', (await call('GET', big, '/activity?cursor=1.99999999999999999999_s')).statusCode === 400);

let [r, ms] = await timed(() => call('GET', big, '/weekly?week=2026-W40&tz=Europe/Rome'));
check(`GET /weekly on it (${ms} ms)`, r.statusCode === 200 && r.json().week === '2026-W40', r.body.slice(0, 300));
[r, ms] = await timed(() => call('GET', big, '/exports/daily?tz=Europe/Rome'));
const daily = r.json().rows as { drafts: number; deleted: number }[];
check(
  `daily activity download (${ms} ms, ${daily.length} rows): the drafts and deletions add up`,
  r.statusCode === 200 && daily.reduce((s, d) => s + d.drafts, 0) === (await owner.query("SELECT count(*)::int AS n FROM record_events WHERE project_id = $1 AND change = 'updated'", [big])).rows[0].n &&
    daily.reduce((s, d) => s + d.deleted, 0) === 100,
  r.body.slice(0, 300),
);
check('audited as export.downloaded { kind: daily }', (await store.listAudit(big, { limit: 1, action: 'export.downloaded' }))[0]?.details.kind === 'daily');

await app.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
