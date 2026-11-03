// Smoke test of the Collect Earth backup (Task 17) on a THROWAWAY PostgreSQL (it drops and creates the
// database `cebak` and the role `ce_bak_app`): the server as a NOSUPERUSER NOBYPASSRLS app role, the
// store's getRecordXml and listRecordKeysWithoutXml under RLS (another project's rows are invisible,
// asked by key or by the raw SQL), the summary, a download link used once, the zip's entries; then
// 100,000 records of 17 KB of XML written by SQL and the backup streamed and timed.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55483:5432 postgres:16
//   npm run smoke:pg:backup -- 55483        (the superuser is postgres / pw on localhost)
import { unzipSync } from 'fflate';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55483';
const big = Number(process.argv[3] ?? 100_000);
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cebak`;
const appUrl = `postgres://ce_bak_app:apppw@${host}/cebak`;
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
await sup.query('DROP DATABASE IF EXISTS cebak');
await sup.query('DROP ROLE IF EXISTS ce_bak_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cebak OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });

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
const project = async (name: string) => {
  const r = (await app.inject({ method: 'POST', url: '/v1/projects', headers: { 'x-admin-key': 'k' }, payload: { name } })).json();
  await store.addMembership(r.projectId, res.json().userId, 'admin');
  return r as { projectId: string; projectToken: string };
};
const a = await project('Alpha');
const b = await project('Beta');
const call = (method: any, pid: string, path: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(ownerToken), ...headers }, payload: payload as any });
for (const p of [a, b]) check('project file', (await call('PUT', p.projectId, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
const xmlOf = (id: string, who: string) => `<?xml version='1.0' standalone='yes' ?>\n<plot><id><value>${id}</value></id><operator><value>${who}</value></operator><note><value>Ñandú &amp; co</value></note></plot>\n`;
for (const [p, who] of [[a, 'ana'], [b, 'ben']] as const) {
  res = await batchRequest(app, p.projectId, p.projectToken, [
    envelope({ recordKey: '1,1', operator: who, modifiedOn: 1000, xml: xmlOf('1', who) }),
    envelope({ recordKey: '2,1', operator: who, modifiedOn: 1000, xml: xmlOf('2', who) }),
    envelope({ recordKey: '1,2', operator: `${who}2`, modifiedOn: 1000, xml: xmlOf('1', `${who}2`) }),
  ]);
  check(`records of ${who}`, res.statusCode === 200, res.body);
}
// A record with no XML in each project (written as the owner: the API always has XML).
const own = new pg.Client({ connectionString: ownerUrl });
await own.connect();
for (const p of [a, b]) {
  await own.query("INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml) VALUES ($1, '3,1', 'nox', now(), now(), true, 1, NULL)", [p.projectId]);
}

// The store under RLS.
const keys = [{ recordKey: '1,1', operator: 'ana' }, { recordKey: '1,1', operator: 'ben' }, { recordKey: '2,1', operator: 'ana' }];
const fromA = await store.getRecordXml(a.projectId, keys);
check('getRecordXml: only A\'s rows, asked with B\'s keys too', fromA.map((r) => `${r.recordKey}/${r.operator}`).sort().join(' ') === '1,1/ana 2,1/ana' && fromA.every((r) => r.xml?.includes('Ñandú') && r.step === 1 && r.deleted === false), fromA);
const fromB = await store.getRecordXml(b.projectId, [{ recordKey: '1,1', operator: 'ana' }]);
check("getRecordXml: B's setting cannot read A's row", fromB.length === 0, fromB);
const noXmlA = await store.listRecordKeysWithoutXml(a.projectId);
check('listRecordKeysWithoutXml: A\'s one', JSON.stringify(noXmlA) === JSON.stringify([{ recordKey: '3,1', operator: 'nox' }]), noXmlA);
const appClient = new pg.Client({ connectionString: appUrl });
await appClient.connect();
await appClient.query('BEGIN');
await appClient.query("SELECT set_config('app.current_project', $1, true)", [b.projectId]);
const raw = await appClient.query('SELECT xml FROM records WHERE project_id = $1', [a.projectId]);
await appClient.query('COMMIT');
check("raw SQL as the app role with B's setting: none of A's XML", raw.rowCount === 0, raw.rows);
await appClient.query('BEGIN');
const unset = await appClient.query('SELECT count(*)::int AS n FROM records');
await appClient.query('COMMIT');
check('raw SQL as the app role with no setting: no rows', unset.rows[0].n === 0, unset.rows);
await appClient.end();

// The routes.
const summary = (await call('GET', a.projectId, '/exports/collect-backup/summary')).json();
check('summary: 2 first assessments, 1 check left out, 1 without XML', summary.rounds['1'].records === 2 && summary.rounds['1'].otherRounds === 1 && summary.rounds['1'].noXml === 1 && summary.rounds.all.records === 3, summary);
const link = (await call('POST', a.projectId, '/exports/collect-backup/link', { rounds: 'all' })).json();
res = await app.inject({ method: 'GET', url: link.url });
const names = Object.keys(unzipSync(res.rawPayload));
check('the link: the zip of A only', res.statusCode === 200 && names.join(' ') === 'idml.xml 1/1.xml 1/2.xml 1/3.xml' && !res.rawPayload.includes(Buffer.from('ben')), names);
check('the link is used once', (await app.inject({ method: 'GET', url: link.url })).statusCode === 410);

// 100,000 records of 17 KB, written by SQL, then the backup timed.
const xml17 = `<?xml version='1.0' standalone='yes' ?>\n<plot>${Array.from({ length: 400 }, (_, i) => `<a${i}>${(i * 7919) % 1000}-x</a${i}>`).join('')}</plot>\n`.padEnd(17_000, ' ');
let t0 = performance.now();
await own.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml)
   SELECT $1, (100000 + g)::text || ',1', 'op' || (g % 40), now(), now(), true, 1, replace($2, '<a0>', '<a0>' || g)
     FROM generate_series(1, $3) g`,
  [a.projectId, xml17, big],
);
console.log(`     ${big} records written in ${Math.round(performance.now() - t0)} ms`);
await own.end();
t0 = performance.now();
const s2 = (await call('GET', a.projectId, '/exports/collect-backup/summary')).json();
console.log(`     summary in ${Math.round(performance.now() - t0)} ms: ${s2.rounds['1'].records} records, about ${Math.round(s2.rounds['1'].estimatedBytes / 1e6)} MB`);
const base = await app.listen({ port: 0, host: '127.0.0.1' });
const url = (await call('POST', a.projectId, '/exports/collect-backup/link', { rounds: '1' })).json().url;
let peak = 0;
const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
t0 = performance.now();
const response = await fetch(base + url);
let bytes = 0;
for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) bytes += chunk.length;
const ms = Math.round(performance.now() - t0);
clearInterval(timer);
check(`the backup of ${big + 2} records streamed: ${Math.round(bytes / 1e6)} MB in ${ms} ms, peak RSS ${Math.round(peak / 1048576)} MB`, response.status === 200 && bytes > big * 1000);
await app.close();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
