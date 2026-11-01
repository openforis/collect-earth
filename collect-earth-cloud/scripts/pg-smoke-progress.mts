// Smoke test of the Progress tab (migration 013 and GET /progress) on a THROWAWAY
// PostgreSQL (it drops and creates the database `ceprog` and the role `ce_prog_app`):
// the migration, the server as a NOSUPERUSER NOBYPASSRLS app role through the routes,
// the days counted by Postgres (GROUP BY in the time zone, across a DST change) equal to
// the memory store's, the median waits, the settings, a time zone Postgres does not know,
// RLS between two projects, and GET /progress on a project of 100,000 records.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:progress -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { InMemoryStore } from '../src/store/memory.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import type { RecordEventInput } from '../src/types.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/ceprog`;
const appUrl = `postgres://ce_prog_app:apppw@${host}/ceprog`;
const DAY = 86_400_000;
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
await sup.query('DROP DATABASE IF EXISTS ceprog');
await sup.query('DROP ROLE IF EXISTS ce_prog_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceprog OWNER ceown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const column = (await owner.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'progress_settings'")).rows[0];
check('013: projects.progress_settings (twice, idempotent)', column?.data_type === 'jsonb', column);
const index = (await owner.query("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_record_events_project_received'")).rows.length;
check('013: the received_at index', index === 1);

// --- The server as the app role. ---
const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0 } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
check('setup', res.statusCode === 201, res.body);
const ownerToken = res.json().token as string;
const project = async (name: string) =>
  (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name } })).json().projectId as string;
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
const pedro = await join(b, 'pedro');

check('CEP', (await call('PUT', a, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
res = await call('PUT', a, '/csv-files/plots.csv', 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n4,0,0\n5,0,0\n', { 'content-type': 'text/csv' });
const fileId = res.json().id as string;
check('assignments', (await call('PUT', a, '/assignments', { assignments: [{ userId: maria.userId, csvFileId: fileId }] })).statusCode === 200);

// Rome: 25 October 2026 has 25 hours (CEST -> CET at 03:00 local).
const at = (iso: string) => Date.parse(iso);
await batchRequest(app, a, maria.token, [
  envelope({ recordKey: '1', modifiedOn: at('2026-10-24T22:30:00Z') }), // the 25th in Rome, the 24th in UTC
  envelope({ recordKey: '2', modifiedOn: at('2026-10-25T22:30:00Z') }), // still the 25th in Rome (CET)
  envelope({ recordKey: '3', modifiedOn: at('2026-10-25T23:30:00Z') }), // the 26th in Rome
  envelope({ recordKey: '4', modifiedOn: at('2026-10-26T10:00:00Z'), activelySaved: false }),
]);
await batchRequest(app, b, pedro.token, [envelope({ recordKey: '1', operator: 'pedro', modifiedOn: at('2026-10-25T12:00:00Z') })]);

const window = { from: at('2026-10-20T00:00:00Z'), to: at('2026-10-30T00:00:00Z') };
const rome = await store.countSubmittedByDay(a, { ...window, timeZone: 'Europe/Rome' });
check('days in Rome, across the DST change (GROUP BY in Postgres)', JSON.stringify(rome) === JSON.stringify([{ date: '2026-10-25', count: 2 }, { date: '2026-10-26', count: 1 }]), rome);
const utc = await store.countSubmittedByDay(a, { ...window, timeZone: 'UTC' });
check('days in UTC', JSON.stringify(utc) === JSON.stringify([{ date: '2026-10-24', count: 1 }, { date: '2026-10-25', count: 2 }]), utc);

// The same events in the memory store give the same days.
const events = (await store.listRecordEvents(a, { from: 0, to: 1e13, limit: 100 })).reverse();
const memory = new InMemoryStore();
const { projectId: m } = await memory.createProject({ name: 'mirror' });
for (const e of events) {
  const { id: _id, ...rest } = e;
  await memory.appendRecordEvent({ ...(rest as RecordEventInput), projectId: m });
}
for (const tz of ['Europe/Rome', 'UTC', 'America/Sao_Paulo', 'Asia/Kolkata', 'Australia/Lord_Howe']) {
  const p = await store.countSubmittedByDay(a, { ...window, timeZone: tz });
  const mem = await memory.countSubmittedByDay(m, { ...window, timeZone: tz });
  check(`${tz}: Postgres and the memory store count the same days`, JSON.stringify(p) === JSON.stringify(mem), { p, mem });
}
check('a time zone Postgres does not know: the days of UTC, no error', JSON.stringify(await store.countSubmittedByDay(a, { ...window, timeZone: 'Mars/Olympus' })) === JSON.stringify(utc));

// Median waits: Postgres's percentile_cont and the memory store's.
const pDelays = await store.unsentDelays(a, 0);
const mDelays = await memory.unsentDelays(m, 0);
check('median waits as the memory store', JSON.stringify(pDelays.map((d) => [d.operator, Math.round(d.medianMs), d.uploads])) === JSON.stringify(mDelays.map((d) => [d.operator, Math.round(d.medianMs), d.uploads])), { pDelays, mDelays });
check('... per operator, only A', pDelays.length === 1 && pDelays[0].operator === 'maria' && pDelays[0].uploads === 4, pDelays);

// The route.
res = await call('GET', a, '/progress?days=30&tz=Europe/Rome');
check('GET /progress (coordinator)', res.statusCode === 200, res.body);
const body = res.json();
check('totals per plot unit', JSON.stringify(body.totals) === JSON.stringify({ plots: 5, assigned: 5, notAssigned: 0, submitted: 3, started: 1, notStarted: 1 }), body.totals);
check('the cumulative line ends at the plots submitted now', body.daily.at(-1).cumulative === 3, body.daily.at(-1));
check('attention cards for a coordinator', Array.isArray(body.attention), body.attention);
res = await call('GET', a, '/progress', undefined, {}, rita.token);
check('a reviewer: figures, no cards', res.statusCode === 200 && res.json().attention === null, res.body);
check('a collector: refused', (await call('GET', a, '/progress', undefined, {}, maria.token)).statusCode === 403);

// Settings.
res = await call('PUT', a, '/progress/settings', { deadline: '2026-12-31', targetPlots: 4, quietDays: 7 });
check('settings saved', res.statusCode === 200, res.body);
check('settings read back', JSON.stringify(await store.getProgressSettings(a)) === JSON.stringify({ deadline: '2026-12-31', targetPlots: 4, quietDays: 7 }));
check("B's settings untouched (defaults)", JSON.stringify(await store.getProgressSettings(b)) === JSON.stringify({ deadline: null, targetPlots: null, quietDays: 3 }));
const audit = await store.listAudit(a, { limit: 10, action: 'settings.changed' });
check('audited as settings.changed { setting: progress }', audit.length === 1 && audit[0].details.setting === 'progress', audit);
check('the forecast uses them', (await call('GET', a, '/progress')).json().forecast.target === 4);

// RLS: with A set, as the app role, B's settings and events are not read or changed.
const c = new pg.Client({ connectionString: appUrl });
await c.connect();
await c.query('BEGIN');
await c.query("SELECT set_config('app.current_project', $1, true)", [a]);
const seen = (await c.query('SELECT progress_settings FROM projects WHERE id = $1', [b])).rows.length;
check("with A set: B's settings not read", seen === 0);
const changed = (await c.query(`UPDATE projects SET progress_settings = '{"quietDays": 9}' WHERE id = $1`, [b])).rowCount;
check("with A set: B's settings not changed", changed === 0);
const bEvents = (await c.query("SELECT count(*)::int AS n FROM record_events WHERE project_id = $1 AND change = 'submitted'", [b])).rows[0].n;
check("with A set: B's events not counted", bEvents === 0);
await c.query('COMMIT');
await c.end();
check('B counts only its own day', JSON.stringify(await store.countSubmittedByDay(b, { ...window, timeZone: 'UTC' })) === JSON.stringify([{ date: '2026-10-25', count: 1 }]));

// --- 100,000 records: GET /progress. ---
const big = await project('Big');
const N = 100_000;
const csv = ['id,lat,lon', ...Array.from({ length: N }, (_, i) => `${i + 1},0,0`)].join('\n') + '\n';
res = await call('PUT', big, '/csv-files/big.csv', csv, { 'content-type': 'text/csv' });
check('a plot file of 100,000 plots', res.statusCode === 201, res.body);
const now = Date.now();
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on)
   SELECT $1, i::text, 'op' || (i % 40), to_timestamp(($2::bigint - (i % 90) * $3::bigint - (i % 1000) * 1000) / 1000.0), to_timestamp(($2::bigint - (i % 90) * $3::bigint) / 1000.0),
          i % 10 <> 0, 1, '<r/>', jsonb_build_object('land_use', 'forest', 'trees', (i % 30)::text), false, NULL
     FROM generate_series(1, $4::int) i`,
  [big, now, DAY, N],
);
await owner.query(
  `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change, summary)
   SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, false,
          CASE WHEN actively_saved THEN 'submitted' ELSE 'created' END, CASE WHEN actively_saved THEN summary END
     FROM records WHERE project_id = $1`,
  [big],
);
await owner.query('ANALYZE records; ANALYZE record_events');
const times: number[] = [];
let last: any = null;
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  res = await call('GET', big, '/progress?days=90&tz=Europe/Rome');
  times.push(Math.round(performance.now() - t0));
  last = res.json();
}
check('100,000 records: GET /progress answers', res.statusCode === 200 && last.totals.plots === N && last.totals.submitted === N - N / 10, last?.totals);
check('100,000 records: the cumulative line ends at the plots submitted', last.daily.at(-1).cumulative === last.totals.submitted);
console.log(`     GET /progress on 100,000 records: ${times.join(' ms, ')} ms`);
const t1 = performance.now();
await store.countSubmittedByDay(big, { from: now - 91 * DAY, to: now + DAY, timeZone: 'Europe/Rome' });
console.log(`     the GROUP BY of the days alone: ${Math.round(performance.now() - t1)} ms`);

await app.close();
await store.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
