// Smoke test of the progress links for funders (Task 18) on a THROWAWAY PostgreSQL (it drops and
// creates the database `celink` and the role `ce_link_app`): migration 021 twice, the server as a
// NOSUPERUSER NOBYPASSRLS app role, share_links under RLS (another project's rows neither read nor
// written, none with no setting), share_link_lookup (SECURITY DEFINER, owned by the tables' owner,
// fixed search_path) giving only the link's and project's ids, the token kept as its sha256 only,
// the public route (no names, revoked and unknown both 404, last use noted), a deleted project's
// links gone; then the lookup timed for valid, revoked and unknown tokens, and the public page on
// 100,000 plots and records against the Progress tab.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55484:5432 postgres:16
//   npm run smoke:pg:links -- 55484        (the superuser is postgres / pw on localhost)
import { createHash } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55484';
const big = Number(process.argv[3] ?? 100_000);
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/celink`;
const appUrl = `postgres://ce_link_app:apppw@${host}/celink`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];

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
await sup.query('DROP DATABASE IF EXISTS celink');
await sup.query('DROP ROLE IF EXISTS ce_link_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE celink OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
check('021 ran twice', true);

const own = new pg.Client({ connectionString: ownerUrl });
await own.connect();
const fn = (
  await own.query(
    `SELECT p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_proc p, pg_class c WHERE p.proname = 'share_link_lookup' AND c.relname = 'share_links'`,
  )
).rows[0];
check('share_link_lookup: SECURITY DEFINER, owned by the owner, fixed search_path; share_links under RLS', fn.prosecdef === true && fn.owner === 'ceown' && String(fn.proconfig).includes('search_path=pg_catalog, pg_temp') && fn.relrowsecurity === true && fn.relforcerowsecurity === false, fn);

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', databaseUrl: appUrl, adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, stateStaleMs: 0, qualityMinIntervalMs: 0 } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
const ownerToken = res.json().token as string;
const ownerId = res.json().userId as string;
const project = async (name: string) => {
  const r = (await app.inject({ method: 'POST', url: '/v1/projects', headers: { 'x-admin-key': 'k' }, payload: { name } })).json();
  await store.addMembership(r.projectId, ownerId, 'admin');
  return r as { projectId: string; projectToken: string };
};
const a = await project('Alpha');
const b = await project('Beta');
const call = (method: any, pid: string, path: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(ownerToken), ...headers }, payload: payload as any });
const view = (token: string) => app.inject({ method: 'GET', url: `/v1/public/progress/${token}?tz=Europe/Rome` });

for (const p of [a, b]) check('project file', (await call('PUT', p.projectId, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
const csv = await call('PUT', a.projectId, '/csv-files/north-secret.csv', 'id,lat,lon\n1,11.111,-22.222\n2,11.111,-22.222\n3,11.111,-22.222\n', { 'content-type': 'text/csv' });
await call('PUT', a.projectId, '/assignments', { assignments: [{ userId: ownerId, csvFileId: csv.json().id }] });
res = await batchRequest(app, a.projectId, a.projectToken, [
  envelope({ recordKey: '1,1', operator: 'anaSecret', modifiedOn: Date.now() - 86_400_000, summary: { collect_code_land_use: 'ForestSecret' } }),
  envelope({ recordKey: '2,1', operator: 'anaSecret', modifiedOn: Date.now(), summary: { collect_code_land_use: 'ForestSecret' } }),
]);
check('records', res.statusCode === 200, res.body);

const la = (await call('POST', a.projectId, '/share-links', { label: 'For the donor' })).json();
const lb = (await call('POST', b.projectId, '/share-links', { label: 'Beta donor' })).json();
check('links made', typeof la.token === 'string' && typeof lb.token === 'string', [la, lb]);

// The token at rest: its sha256 only.
const rows = (await own.query('SELECT * FROM share_links ORDER BY created_at')).rows;
check('token kept as its sha256, never itself', rows.length === 2 && rows[0].token_hash === sha(la.token) && !JSON.stringify(rows).includes(la.token) && !JSON.stringify(rows).includes(lb.token), rows);

// RLS: the app role.
const appClient = new pg.Client({ connectionString: appUrl });
await appClient.connect();
await appClient.query('BEGIN');
await appClient.query("SELECT set_config('app.current_project', $1, true)", [b.projectId]);
const seen = await appClient.query('SELECT id FROM share_links WHERE project_id = $1', [a.projectId]);
const upd = await appClient.query('UPDATE share_links SET revoked_at = now() WHERE project_id = $1', [a.projectId]);
let insertRefused = false;
try {
  await appClient.query('SAVEPOINT s');
  await appClient.query("INSERT INTO share_links (id, project_id, token_hash) VALUES (gen_random_uuid(), $1, repeat('a', 64))", [a.projectId]);
} catch (err) {
  insertRefused = (err as { code?: string }).code === '42501';
  await appClient.query('ROLLBACK TO SAVEPOINT s');
}
await appClient.query('COMMIT');
check("with B's setting: none of A's links read, updated or inserted", seen.rowCount === 0 && upd.rowCount === 0 && insertRefused, { seen: seen.rowCount, upd: upd.rowCount, insertRefused });
await appClient.query('BEGIN');
const none = await appClient.query('SELECT count(*)::int AS n FROM share_links');
const viaFn = await appClient.query('SELECT * FROM share_link_lookup($1)', [sha(la.token)]);
const viaFnUnknown = await appClient.query('SELECT * FROM share_link_lookup($1)', [sha('nope')]);
await appClient.query('COMMIT');
check('with no setting: no rows; share_link_lookup gives the two ids of a known hash only', none.rows[0].n === 0 && viaFn.rowCount === 1 && Object.keys(viaFn.rows[0]).join() === 'link_id,link_project' && viaFn.rows[0].link_project === a.projectId && viaFnUnknown.rowCount === 0, { none: none.rows, viaFn: viaFn.rows });
await appClient.end();

// Nobody but the app role may call the lookup (021 revokes it from PUBLIC; prepareAppRole grants it).
const grants = (await own.query("SELECT has_function_privilege('ce_link_app', 'share_link_lookup(text)', 'EXECUTE') AS app, has_function_privilege('public', 'share_link_lookup(text)', 'EXECUTE') AS pub")).rows[0];
await own.query("DO $$ BEGIN CREATE ROLE ce_link_other LOGIN PASSWORD 'pw'; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await own.query('GRANT CONNECT ON DATABASE celink TO ce_link_other');
const other = new pg.Client({ connectionString: `postgres://ce_link_other:pw@${host}/celink` });
await other.connect();
let otherRefused = false;
try {
  await other.query('SELECT * FROM public.share_link_lookup($1)', [sha(la.token)]);
} catch (err) {
  otherRefused = (err as { code?: string }).code === '42501';
}
await other.end();
check('share_link_lookup: the app role may call it, PUBLIC and another role may not', grants.app === true && grants.pub === false && otherRefused, { grants, otherRefused });

// The public route.
res = await view(la.token);
const body = res.json();
check('public page: 200, project name, totals as the Progress tab', res.statusCode === 200 && body.project.name === 'Alpha' && body.totals.plots === 3 && body.totals.submitted === 2, body);
const progress = (await call('GET', a.projectId, '/progress?tz=Europe/Rome')).json();
check('the same numbers as the Progress tab', JSON.stringify([body.totals, body.daily, body.forecast]) === JSON.stringify([progress.totals, progress.daily, progress.forecast]));
check('no names, answers, file names, coordinates or ids in it', !['anaSecret', 'owner', 'ForestSecret', 'north-secret', '11.111', '-22.222', a.projectId, ownerId].some((s) => res.body.includes(s)), res.body);
check('headers: noindex, no referrer, no-store, no cookie', res.headers['x-robots-tag'] === 'noindex, nofollow' && res.headers['referrer-policy'] === 'no-referrer' && res.headers['cache-control'] === 'no-store' && res.headers['set-cookie'] === undefined, res.headers);
check("B's link shows Beta", (await view(lb.token)).json().project.name === 'Beta');
const used = (await own.query('SELECT last_used_at FROM share_links WHERE id = $1', [la.link.id])).rows[0];
check('last use noted', used.last_used_at !== null, used);
const listed = (await call('GET', a.projectId, '/share-links')).json();
check('the list: label, maker, last use', listed.links.length === 1 && listed.links[0].label === 'For the donor' && listed.links[0].createdBy === 'owner' && typeof listed.links[0].lastUsedAt === 'number', listed);
check("A cannot revoke B's link through its path", (await call('DELETE', a.projectId, `/share-links/${lb.link.id}`)).statusCode === 404 && (await view(lb.token)).statusCode === 200);
check('revoked', (await call('DELETE', a.projectId, `/share-links/${la.link.id}`)).statusCode === 204);
const revoked = await view(la.token);
const unknown = await view('Q'.repeat(43));
check('revoked and unknown: the same 404', revoked.statusCode === 404 && unknown.statusCode === 404 && revoked.body === unknown.body, [revoked.body, unknown.body]);
const audit = (await own.query("SELECT action, details FROM audit_log WHERE project_id = $1 AND action LIKE 'link.%' ORDER BY id", [a.projectId])).rows;
check('audited link.created and link.revoked (the CHECK allows them)', audit.map((r) => r.action).join() === 'link.created,link.revoked' && audit[1].details.label === 'For the donor', audit);
const laToken2 = (await call('POST', a.projectId, '/share-links', { label: 'second' })).json().token as string;
const la2 = () => laToken2;
// At most 20 links, made at once: counted and inserted under one lock.
const c = await project('Cap');
const made = await Promise.all(Array.from({ length: 25 }, (_, i) => call('POST', c.projectId, '/share-links', { label: `c${i}` })));
const capCount = (await own.query('SELECT count(*)::int AS n FROM share_links WHERE project_id = $1', [c.projectId])).rows[0].n;
check('25 links asked at once: 20 made, 5 refused', made.filter((r) => r.statusCode === 201).length === 20 && made.filter((r) => r.statusCode === 409).length === 5 && capCount === 20, made.map((r) => r.statusCode));

// The quality figure: stored when the figures are worked out, read on another instance.
check('no figure before the Quality tab was opened', (await view(la2())).json().quality.available === false);
for (let i = 0; i < 200; i++) {
  const q = (await call('GET', a.projectId, '/quality')).json();
  if (!q.stale) break;
  await sleep(20);
}
let stored: any = null;
for (let i = 0; i < 100 && !stored; i++) {
  stored = (await own.query('SELECT public_quality FROM projects WHERE id = $1', [a.projectId])).rows[0].public_quality;
  if (!stored) await sleep(20);
}
check('projects.public_quality stored after the figures were worked out', stored !== null && typeof stored.computedAt === 'number', stored);
const second = await buildServer({ store: new PostgresStore(appUrl), config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', databaseUrl: appUrl, setupCode: 'X', rateLimitPerMinute: 0 } as any, webDir: null });
const fromSecond = (await second.inject({ method: 'GET', url: `/v1/public/progress/${laToken2}` })).json().quality;
await second.close();
check('another instance (cold) shows the stored figure', fromSecond.available === true && fromSecond.computedAt === stored.computedAt && fromSecond.agreement.compared === stored.compared, fromSecond);

check('project deleted: its links go', (await call('DELETE', b.projectId, '', { confirmName: 'Beta' })).statusCode === 204 && (await view(lb.token)).statusCode === 404 && (await own.query('SELECT 1 FROM share_links WHERE project_id = $1', [b.projectId])).rowCount === 0);

// The lookup timed: valid, revoked and unknown tokens (100 links, 200 lookups each).
const tokens: string[] = [];
for (let i = 0; i < 100; i++) tokens.push((await store.createShareLink(a.projectId, { label: `l${i}`, createdBy: null, max: 1000 }))!.token);
const gone = (await store.createShareLink(a.projectId, { label: 'gone', createdBy: null, max: 1000 }))!;
await store.revokeShareLink(a.projectId, gone.link.id);
const time = async (token: string) => {
  const t0 = performance.now();
  await store.findShareLink(token);
  return performance.now() - t0;
};
for (let i = 0; i < 50; i++) await time(tokens[i % 100]);
const valid: number[] = [];
const rev: number[] = [];
const unk: number[] = [];
for (let i = 0; i < 200; i++) {
  valid.push(await time(tokens[i % 100]));
  rev.push(await time(gone.token));
  unk.push(await time(`${'Z'.repeat(40)}${String(i).padStart(3, '0')}`));
}
const f = (xs: number[]) => `${median(xs).toFixed(2)} ms median, ${Math.max(...xs).toFixed(2)} max`;
console.log(`     lookup: valid ${f(valid)}; revoked ${f(rev)}; unknown ${f(unk)}`);
check('lookup: revoked and unknown within 1 ms of each other (median)', Math.abs(median(rev) - median(unk)) < 1);

// The public page on `big` plots and records, against the Progress tab.
const ids = Array.from({ length: big }, (_, i) => 100_000 + i + 1);
const bigCsv = await call('PUT', a.projectId, '/csv-files/big.csv', `id,lat,lon\n${ids.map((id) => `${id},1,1`).join('\n')}\n`, { 'content-type': 'text/csv' });
check(`a plot file of ${big} plots`, bigCsv.statusCode < 300 && bigCsv.json().plotCount === big, bigCsv.body);
await call('PUT', a.projectId, '/assignments', { assignments: [{ userId: ownerId, csvFileId: csv.json().id }, { userId: ownerId, csvFileId: bigCsv.json().id }] });
let t0 = performance.now();
await own.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml)
   SELECT $1, (100000 + g)::text || ',1', 'op' || (g % 40), now() - (g % 60) * interval '1 day', now(), g % 5 <> 0, 1, '<plot/>'
     FROM generate_series(1, $2) g`,
  [a.projectId, big],
);
console.log(`     ${big} records written in ${Math.round(performance.now() - t0)} ms`);
const link = (await store.createShareLink(a.projectId, { label: 'big', createdBy: null, max: 1000 }))!;
const runs: number[] = [];
let last: any = null;
for (let i = 0; i < 5; i++) {
  t0 = performance.now();
  res = await view(link.token);
  runs.push(performance.now() - t0);
  last = res.json();
}
const tab = (await call('GET', a.projectId, '/progress?tz=Europe/Rome')).json();
check(`public page on ${big} records: the Progress tab's totals (${last.totals.submitted} submitted)`, res.statusCode === 200 && JSON.stringify(last.totals) === JSON.stringify(tab.totals) && last.totals.submitted === Math.floor(big * 0.8) + 2, [last.totals, tab.totals]);
console.log(`     public page: first ${Math.round(runs[0])} ms (the project state built), then ${runs.slice(1).map((r) => Math.round(r)).join(', ')} ms`);
check('public page body stays small', res.body.length < 20_000, res.body.length);

await own.end();
await app.close();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
