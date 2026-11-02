// Smoke test of the Progress tab (migration 013 and GET /progress) on a THROWAWAY
// PostgreSQL (it drops and creates the database `ceprog` and the role `ce_prog_app`):
// the migration, the server as a NOSUPERUSER NOBYPASSRLS app role through the routes,
// the first submissions read with the records (kept through a resubmission), the days of
// the bars in five time zones (Rome across a DST change), the median waits as the memory
// store's, the settings, RLS between two projects, and GET /progress on a project of
// 100,000 records of which 20,000 checks, then the People tab and My work on it, cold and warm,
// and the Quality tab's answers per person (Task 4) and pattern flags (Task 5) on it.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:progress -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { InMemoryStore } from '../src/store/memory.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { localDate } from '../src/days.js';
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
// Plot 1 taken back and submitted again: it stays on the day of its first submission.
await batchRequest(app, a, maria.token, [envelope({ recordKey: '1', modifiedOn: at('2026-10-28T10:00:00Z'), activelySaved: false })]);
await batchRequest(app, a, maria.token, [envelope({ recordKey: '1', modifiedOn: at('2026-10-29T10:00:00Z') })]);
await batchRequest(app, b, pedro.token, [envelope({ recordKey: '1', operator: 'pedro', modifiedOn: at('2026-10-25T12:00:00Z') })]);

const states = (await store.listRecordStates(a)).sort((x, y) => (x.recordKey < y.recordKey ? -1 : 1));
check(
  'listRecordStates: the first submission from the events, kept through a resubmission; null for a draft',
  JSON.stringify(states.map((s) => [s.recordKey, s.activelySaved, s.modifiedOn, s.firstSubmittedOn])) ===
    JSON.stringify([
      ['1', true, at('2026-10-29T10:00:00Z'), at('2026-10-24T22:30:00Z')],
      ['2', true, at('2026-10-25T22:30:00Z'), at('2026-10-25T22:30:00Z')],
      ['3', true, at('2026-10-25T23:30:00Z'), at('2026-10-25T23:30:00Z')],
      ['4', false, at('2026-10-26T10:00:00Z'), null],
    ]),
  states,
);
const bars = async (tz: string) =>
  ((await call('GET', a, `/progress?days=366&tz=${encodeURIComponent(tz)}`)).json().daily as { date: string; submitted: number }[])
    .filter((d) => d.submitted > 0)
    .map((d) => [d.date, d.submitted]);
check('days in Rome, across the DST change', JSON.stringify(await bars('Europe/Rome')) === JSON.stringify([['2026-10-25', 2], ['2026-10-26', 1]]), await bars('Europe/Rome'));
check('days in UTC', JSON.stringify(await bars('UTC')) === JSON.stringify([['2026-10-24', 1], ['2026-10-25', 2]]), await bars('UTC'));
for (const tz of ['America/Sao_Paulo', 'Asia/Kolkata', 'Australia/Lord_Howe']) {
  const want = new Map<string, number>();
  for (const s of states) if (s.firstSubmittedOn !== null) want.set(localDate(s.firstSubmittedOn, tz), (want.get(localDate(s.firstSubmittedOn, tz)) ?? 0) + 1);
  const expected = [...want].sort(([x], [y]) => (x < y ? -1 : 1));
  check(`${tz}: the bars are the local days of the first submissions`, JSON.stringify(await bars(tz)) === JSON.stringify(expected), { got: await bars(tz), expected });
}

// Median waits: Postgres's percentile_cont and the memory store's, over the same events.
const events = (await store.listRecordEvents(a, { from: 0, to: 1e13, limit: 100 })).reverse();
const memory = new InMemoryStore();
const { projectId: m } = await memory.createProject({ name: 'mirror' });
for (const e of events) {
  const { id: _id, ...rest } = e;
  await memory.appendRecordEvent({ ...(rest as RecordEventInput), projectId: m });
}
const pDelays = await store.unsentDelays(a, 0);
const mDelays = await memory.unsentDelays(m, 0);
check('median waits as the memory store', JSON.stringify(pDelays.map((d) => [d.operator, Math.round(d.medianMs), d.uploads])) === JSON.stringify(mDelays.map((d) => [d.operator, Math.round(d.medianMs), d.uploads])), { pDelays, mDelays });
check('... per operator, only A', pDelays.length === 1 && pDelays[0].operator === 'maria' && pDelays[0].uploads === 6, pDelays);

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

// --- 100,000 records, 20 % of the plots checked: GET /progress. ---
const big = await project('Big');
const N = 100_000;
const csv = ['id,lat,lon', ...Array.from({ length: N }, (_, i) => `${i + 1},0,0`)].join('\n') + '\n';
res = await call('PUT', big, '/csv-files/big.csv', csv, { 'content-type': 'text/csv' });
check('a plot file of 100,000 plots', res.statusCode === 201, res.body);
const bigFile = res.json().id as string;
const now = Date.now();
// 40 collectors; the file divided between them (op<i % 40> holds plot i), and every fifth
// plot also given as a quality-check copy to the next one, who submitted the check.
await owner.query(
  `INSERT INTO users (id, username, password_hash) SELECT gen_random_uuid(), 'op' || k, 'x' FROM generate_series(0, 39) k`,
);
await owner.query(`INSERT INTO project_members (project_id, user_id, role) SELECT $1, id, 'operator' FROM users WHERE username LIKE 'op%'`, [big]);
await owner.query(`UPDATE csv_files SET distribution = '{"mode": "manual"}' WHERE id = $1`, [bigFile]);
await owner.query(
  `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap)
   SELECT $1::uuid, $2::uuid, i::text, u.id, false FROM generate_series(1, $3::int) i JOIN users u ON u.username = 'op' || (i % 40)
   UNION ALL
   SELECT $1::uuid, $2::uuid, i::text, u.id, true FROM generate_series(1, $3::int) i JOIN users u ON u.username = 'op' || ((i + 1) % 40) WHERE i % 5 = 0`,
  [big, bigFile, N],
);
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on)
   SELECT $1::uuid, i::text, 'op' || (i % 40), to_timestamp(($2::bigint - (i % 90) * $3::bigint - (i % 1000) * 1000) / 1000.0), to_timestamp(($2::bigint - (i % 90) * $3::bigint) / 1000.0),
          i % 10 <> 0, 1, '<r/>', jsonb_build_object('land_use', 'forest', 'trees', (i % 30)::text), false, NULL::timestamptz
     FROM generate_series(1, $4::int) i
   UNION ALL
   SELECT $1::uuid, i::text, 'op' || ((i + 1) % 40), to_timestamp(($2::bigint - (i % 60) * $3::bigint) / 1000.0), to_timestamp(($2::bigint - (i % 60) * $3::bigint) / 1000.0),
          true, 1, '<r/>', jsonb_build_object('land_use', 'forest', 'trees', (i % 30)::text), false, NULL::timestamptz
     FROM generate_series(1, $4::int) i WHERE i % 5 = 0`,
  [big, now, DAY, N],
);
await owner.query(
  `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change, summary)
   SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, false,
          CASE WHEN actively_saved THEN 'submitted' ELSE 'created' END, CASE WHEN actively_saved THEN summary END
     FROM records WHERE project_id = $1`,
  [big],
);
await owner.query('ANALYZE records; ANALYZE record_events; ANALYZE plot_assignments');
const times: number[] = [];
let last: any = null;
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  res = await call('GET', big, '/progress?days=90&tz=Europe/Rome');
  times.push(Math.round(performance.now() - t0));
  last = res.json();
}
// Every tenth plot is a draft; the 20,000 checks are not counted.
check('100,000 records and 20,000 checks: GET /progress counts the plots only', res.statusCode === 200 && last.totals.plots === N && last.totals.submitted === N - N / 10, last?.totals);
const sum = last.daily.reduce((s: number, d: { submitted: number }) => s + d.submitted, 0);
check('... the bars add up to the plots submitted (all were first submitted in the last 90 days)', sum === last.totals.submitted, { sum, submitted: last.totals.submitted });
check('... the cumulative line ends at the plots submitted', last.daily.at(-1).cumulative === last.totals.submitted);
console.log(`     GET /progress on 100,000 records with 20,000 checks: ${times.join(' ms, ')} ms`);
const t1 = performance.now();
await store.listRecordStates(big);
console.log(`     listRecordStates alone (with the first submissions): ${Math.round(performance.now() - t1)} ms`);

// --- The People tab on the same project (Task 3): GET /people and a person's page. ---
const peopleTimes: number[] = [];
let people: any = null;
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  res = await call('GET', big, '/people?tz=Europe/Rome');
  peopleTimes.push(Math.round(performance.now() - t0));
  people = res.json();
}
const rows = people?.people ?? [];
const sumSubmitted = rows.reduce((s: number, r: any) => s + r.plots.submitted, 0);
const sumChecks = rows.reduce((s: number, r: any) => s + r.checks.submitted, 0);
check('GET /people: one row per person (40 collectors and the owner)', res.statusCode === 200 && rows.length === 41, { status: res.statusCode, rows: rows.length });
check("... the plots submitted per person add up to the Progress tab's", sumSubmitted === last.totals.submitted, { sumSubmitted, submitted: last.totals.submitted });
check('... the 20,000 checks are counted apart, as checks', sumChecks === N / 5, sumChecks);
check('... op1 holds 2,500 plots and 2,500 copies', rows.find((r: any) => r.username === 'op1')?.plots.assigned === N / 40 && rows.find((r: any) => r.username === 'op1')?.checks.assigned === N / 40, rows.find((r: any) => r.username === 'op1'));
console.log(`     GET /people on 100,000 records with 20,000 checks: ${peopleTimes.join(' ms, ')} ms`);
const op1 = rows.find((r: any) => r.username === 'op1')?.userId as string;
const personTimes: number[] = [];
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  res = await call('GET', big, `/people/${op1}?tz=Europe/Rome`);
  personTimes.push(Math.round(performance.now() - t0));
}
const person = res.json();
check("GET /people/:userId: op1's page, their file and plots", res.statusCode === 200 && person.files.length === 1 && person.files[0].plots.total === N / 40 && person.files[0].checks.total === N / 40, { status: res.statusCode, files: person.files?.map((f: any) => ({ ...f, list: f.list.length })) });
check('... the calendar adds up to their plots and checks submitted', person.calendar.reduce((s: number, d: any) => s + d.plots + d.checks, 0) === person.person.plots.submitted + person.person.checks.submitted);
console.log(`     GET /people/:userId on the same project: ${personTimes.join(' ms, ')} ms`);
// Coordinators only; a collector of the project gets 403 (and sees only their own My work).
const collector = await join(big, 'collector1');
check('a collector: 403 on /people and /people/:userId', (await call('GET', big, '/people', undefined, {}, collector.token)).statusCode === 403 && (await call('GET', big, `/people/${op1}`, undefined, {}, collector.token)).statusCode === 403);
res = await call('GET', big, '/my-work', undefined, {}, collector.token);
check('... and their own My work', res.statusCode === 200 && res.json().person.username === 'collector1');

// --- Cold and warm: each route on a fresh server (an empty project state cache), then
// asked again (the state kept; activity, settings and the time zone read each time). ---
const op1Session = await store.createSession(op1);
const timed = async (label: string, paths: string[], token = ownerToken) => {
  const fresh = await buildServer({
    store,
    config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0 } as any,
    webDir: null,
  });
  const ms: number[] = [];
  let status = 0;
  for (const path of paths) {
    const t0 = performance.now();
    const r = await fresh.inject({ method: 'GET', url: `/v1/projects/${big}${path}`, headers: bearer(token) });
    ms.push(Math.round(performance.now() - t0));
    status = r.statusCode;
  }
  await fresh.close();
  const warm = ms.slice(1);
  console.log(`     ${label}: cold ${ms[0]} ms, warm ${warm.join(', ')} ms (median ${[...warm].sort((a, b) => a - b)[warm.length >> 1]} ms)`);
  return { status, warm };
};
// Other time zones each time, so My work's 5-second answer cache is not what is measured.
const zones = ['Europe/Rome', 'UTC', 'America/Lima', 'Asia/Kolkata', 'Africa/Nairobi', 'Australia/Lord_Howe'];
const routes = [
  await timed('GET /progress', zones.map((z) => `/progress?days=90&tz=${z}`)),
  await timed('GET /people', zones.map((z) => `/people?tz=${z}`)),
  await timed('GET /people/:userId', zones.map((z) => `/people/${op1}?tz=${z}`)),
  await timed('GET /my-work (op1)', zones.map((z) => `/my-work?tz=${z}`), op1Session),
];
check('cold and warm: every route answers 200', routes.every((r) => r.status === 200), routes.map((r) => r.status));
res = await call('GET', big, '/my-work?tz=UTC', undefined, {}, op1Session);
check("My work of op1 (2,500 plots, 2,500 copies) never says which are checks", res.statusCode === 200 && !/check|cop(y|ies)|overlap|"kind":"main"/i.test(res.body) && res.json().person.plots.assigned === N / 20, res.json().person?.plots);

// --- Answers per person (Task 4) on the same 100,000 records: 40 answers each (25
// choices of 4-8 codes, 5 numbers, 10 texts), the quality worker computing the report and
// the answer table from one read, then the answers for a few filters. ---
const answerKeys: string[] = [];
// Plot i is op(i % 40)'s; k = i / 40 runs through each person's plots, so everyone answers
// alike, except op3, who answers q0 "a" on half of their plots.
const k = '(record_key::int / 40)';
answerKeys.push(`'collect_code_q0', CASE WHEN record_key::int % 80 = 3 THEN 'a' ELSE (ARRAY['a','b','c','d'])[1 + (${k} * 7) % 4] END`);
for (let q = 1; q < 25; q++) answerKeys.push(`'collect_code_q${q}', (ARRAY['a','b','c','d','e','f','g','h'])[1 + (${k} * ${q + 7}) % ${4 + (q % 5)}]`);
for (let q = 0; q < 5; q++) answerKeys.push(`'collect_real_n${q}', ((${k} * ${q + 3}) % 97)::text`);
for (let q = 0; q < 10; q++) answerKeys.push(`'collect_text_t${q}', 'some words ' || record_key`);
// jsonb_build_object takes at most 100 arguments: chunks of 20 pairs, merged.
const chunks: string[] = [];
for (let c = 0; c < answerKeys.length; c += 20) chunks.push(`jsonb_build_object(${answerKeys.slice(c, c + 20).join(', ')})`);
await owner.query(`UPDATE records SET summary = ${chunks.join(' || ')} WHERE project_id = $1`, [big]);
await owner.query('ANALYZE records');
{
  const fresh = await buildServer({
    store,
    config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0 } as any,
    webDir: null,
  });
  const get = async (path: string) => {
    const t0 = performance.now();
    const r = await fresh.inject({ method: 'GET', url: `/v1/projects/${big}${path}`, headers: bearer(ownerToken) });
    return { ms: Math.round(performance.now() - t0), res: r };
  };
  const cold = await get('/quality/answers');
  const body = cold.res.json();
  check('GET /quality/answers on 100,000 records: 90,000 first assessments, 25 choices and 5 numbers', cold.res.statusCode === 200 && body.plots === N - N / 10 && body.choices.length === 25 && body.numbers.length === 5, { status: cold.res.statusCode, plots: body.plots, choices: body.choices?.length, numbers: body.numbers?.length });
  check('... op3 answers q0 apart from the rest (flagged), the others not', body.flags.some((f: any) => f.username === 'op3') && body.flags.every((f: any) => f.username === 'op3'), body.flags?.slice(0, 3));
  check('... the checks are not counted: each choice has at most the plots', body.choices.every((c: any) => c.answered <= N - N / 10));
  console.log(`     GET /quality/answers cold (worker: read 100,000 records, report + answer table, hand over): ${cold.ms} ms`);
  const warm: string[] = [];
  for (const [label, path] of [
    ['no filter, kept', '/quality/answers'],
    ['person', '/quality/answers?person=op1'],
    ['plot file', `/quality/answers?file=${bigFile}`],
    ['days', '/quality/answers?from=2000-01-01&to=2100-01-01&tz=Europe/Rome'],
    ['days, other zone', '/quality/answers?from=2000-01-01&to=2100-01-01&tz=America/Lima'],
    ['person, kept', '/quality/answers?person=op1'],
  ] as const) {
    const r = await get(path);
    if (r.res.statusCode !== 200) check(`answers ${label}`, false, r.res.body.slice(0, 300));
    warm.push(`${label} ${r.ms} ms`);
  }
  console.log(`     GET /quality/answers then: ${warm.join(', ')}`);
  const report = await get('/quality');
  console.log(`     GET /quality (same figures, kept): ${report.ms} ms`);
  // Pattern flags (Task 5): from the same worker job and cache, the threshold applied here.
  const flags = await get('/quality/flags');
  const fb = flags.res.json();
  check('GET /quality/flags from the same figures: 90,000 first assessments, the counts add up', flags.res.statusCode === 200 && fb.plots === N - N / 10 && fb.total === Object.values(fb.counts as Record<string, number>).reduce((a: number, b: number) => a + b, 0) && fb.flags.length <= 500, { status: flags.res.statusCode, plots: fb.plots, counts: fb.counts });
  const flagTimes = [`all ${flags.ms} ms`];
  for (const [label, path] of [['again', '/quality/flags'], ['a person', '/quality/flags?person=op1'], ['a kind', '/quality/flags?kind=very_fast']] as const) {
    const r = await get(path);
    if (r.res.statusCode !== 200) check(`flags ${label}`, false, r.res.body.slice(0, 300));
    flagTimes.push(`${label} ${r.ms} ms`);
  }
  console.log(`     GET /quality/flags: ${flagTimes.join(', ')}`);
  const put = await fresh.inject({ method: 'PUT', url: `/v1/projects/${big}/quality/settings`, headers: bearer(ownerToken), payload: { fastSeconds: 40 } });
  const after = await get('/quality/flags');
  check('the threshold is stored with the margins (quality_settings) and applied without a new computation', put.statusCode === 200 && after.res.json().fastSeconds === 40 && after.res.json().computedAt === fb.computedAt && (await store.getQualitySettings(big)).fastSeconds === 40, { put: put.body.slice(0, 200), fastSeconds: after.res.json().fastSeconds });
  // A decision keeps what the figures showed of its plot (migration 014), never sent to clients.
  const decided = await fresh.inject({ method: 'PUT', url: `/v1/projects/${big}/quality/decisions/1`, headers: bearer(ownerToken), payload: { decision: 'first' } });
  const kept = (await store.listQualityDecisions(big)).find((d) => d.plot === '1');
  check('a decision keeps the records it saw (quality_decisions.seen), not in its answer', decided.statusCode === 200 && !('seen' in decided.json()) && Array.isArray(kept?.seen) && kept!.seen!.length > 0, { status: decided.statusCode, seen: kept?.seen });
  // The first submissions come with the summaries for the worker (the events' join).
  const withFirst = await store.listRecordSummaries(big, { firstSubmissions: true });
  check('listRecordSummaries with firstSubmissions: every submitted record has its first submission', withFirst.filter((r) => r.activelySaved).every((r) => typeof r.firstSubmittedOn === 'number'), withFirst.slice(0, 2).map((r) => r.firstSubmittedOn));
  await fresh.close();
  // The worker's two parts on this thread, for the record.
  const { answerTable } = await import('../src/answerStats.js');
  const { qualityReport } = await import('../src/quality.js');
  const { loadPlotContext } = await import('../src/qualityService.js');
  const t2 = performance.now();
  const summaries = await store.listRecordSummaries(big);
  const t3 = performance.now();
  const context = await loadPlotContext(store, big, { warn() {}, error() {} });
  const t4 = performance.now();
  qualityReport({ ...context, records: summaries, outline: null, margins: {} });
  const t5 = performance.now();
  const table = answerTable({ ...context, records: summaries, outline: null, margins: {} });
  const t6 = performance.now();
  const bytes = table.choices.reduce((s2, c) => s2 + c.values.byteLength + (c.rows?.byteLength ?? 0), 0) + table.numbers.reduce((s2, c) => s2 + c.values.byteLength + c.rows.byteLength, 0) + table.operator.byteLength + table.unit.byteLength + table.time.byteLength;
  const { firstAssessments } = await import('../src/answerStats.js');
  const { flagTable } = await import('../src/flags.js');
  const flagInput = { ...context, records: summaries, outline: null, margins: {} };
  const t7 = performance.now();
  flagTable(flagInput, firstAssessments(flagInput), table);
  const t8 = performance.now();
  console.log(`     on this thread: read summaries ${Math.round(t3 - t2)} ms, plot context ${Math.round(t4 - t3)} ms, report ${Math.round(t5 - t4)} ms, answer table ${Math.round(t6 - t5)} ms (${(bytes / 1e6).toFixed(1)} MB of arrays), flag table ${Math.round(t8 - t7)} ms (first assessments resolved again)`);
}

await app.close();
await store.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
