// Smoke test of the reference plots (Task 14, migration 020) on a THROWAWAY PostgreSQL (it drops
// and creates the database `ceref` and the role `ce_ref_app`): the migration twice, the server as
// a NOSUPERUSER NOBYPASSRLS app role, marking plots (the assessor's main holding, a copy for every
// collector, the figures' version bumped, the audit), what a collector is served (round 2), the
// accuracy worked out by the quality worker (and the reference plots left out of the agreement),
// removing, a collector who joins later, whole again, RLS between two projects, and on a project
// of 100,000 plots (40 collectors) 50 reference plots checked by everyone, timed.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55482:5432 postgres:16
//   npm run smoke:pg:reference -- 55482        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55482';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/ceref`;
const appUrl = `postgres://ce_ref_app:apppw@${host}/ceref`;
const DAY = 86_400_000;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};
const timed = async <T,>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
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
await sup.query('DROP DATABASE IF EXISTS ceref');
await sup.query('DROP ROLE IF EXISTS ce_ref_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceref OWNER ceown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const rls = (await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'reference_plots'")).rows[0];
const policies = (await owner.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'reference_plots'")).rows[0].n;
const triggers = (await owner.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'reference_plots'::regclass AND NOT tgisinternal")).rows[0].n;
check('020 (twice): reference_plots under RLS, one policy, three version triggers', rls?.relrowsecurity === true && policies === 1 && triggers === 3, { rls, policies, triggers });

let clock = Date.now();
const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, stateStaleMs: 0, qualityMinIntervalMs: 0 } as any,
  webDir: null,
  ai: { now: () => clock },
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
check('setup', res.statusCode === 201, res.body);
const ownerToken = res.json().token as string;
const ownerId = res.json().userId as string;
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
const jose = await join(a, 'jose');
const ana = await join(a, 'ana');
const rita = await join(a, 'rita', 'reviewer');
await join(b, 'pedro');
const name = new Map([[ownerId, 'owner'], [maria.userId, 'maria'], [jose.userId, 'jose'], [ana.userId, 'ana'], [rita.userId, 'rita']]);

check('CEP', (await call('PUT', a, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
const rows = Array.from({ length: 12 }, (_, i) => `${i + 1};-10;${20 + i}`).join('\r\n');
res = await call('PUT', a, '/csv-files/north.csv', `id;lat;lon\r\n${rows}\r\n`, { 'content-type': 'text/csv' });
const fileId = res.json().id as string;
res = await call('PUT', a, `/csv-files/${fileId}/distribution`, { mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
check('north.csv divided: maria 1-6, jose 7-12', res.statusCode === 200, res.body);
const held = async (pid: string, file: string, plots: string[]) =>
  (await store.listPlotAssignments(pid, file))
    .filter((h) => plots.includes(h.plotKey))
    .map((h) => `${h.plotKey}:${name.get(h.userId) ?? h.userId}:${h.overlap ? 'copy' : 'main'}${h.sampledAt !== undefined ? ':drawn' : ''}`)
    .sort();
const version = async (pid: string) => Number((await owner.query('SELECT records_version FROM projects WHERE id = $1', [pid])).rows[0].records_version);

check('GET /reference refused to a collector', (await call('GET', a, '/reference', undefined, {}, maria.token)).statusCode === 403);
check('marking refused to a reviewer', (await call('POST', a, '/reference/plots', { csvFileId: fileId, assessorUserId: ownerId, plots: ['1'] }, {}, rita.token)).statusCode === 403);
const v0 = await version(a);
let t = await timed(() => call('POST', a, '/reference/plots', { csvFileId: fileId, assessorUserId: ownerId, plots: ['1', '7'] }));
check('mark plots 1 and 7: 2 marked, 4 copies added', t.value.statusCode === 200 && t.value.json().result.marked === 2 && t.value.json().result.copiesAdded === 4, t.value.body);
console.log(`     POST /reference/plots (2 plots, the state built): ${t.ms} ms`);
const after = await held(a, fileId, ['1', '7']);
check(
  'the owner holds them as main, every collector a copy, not the reviewer',
  after.join() === ['1:ana:copy', '1:jose:copy', '1:maria:copy', '1:owner:main', '7:ana:copy', '7:jose:copy', '7:maria:copy', '7:owner:main'].join(),
  after,
);
check('the figures\' version was bumped (009 triggers, 020 too)', (await version(a)) > v0);
const audit = await store.listAudit(a, { limit: 3, action: 'reference.changed' });
check('audited reference.changed with ids and counts', audit.length === 1 && audit[0].actorUserId === ownerId && audit[0].details.added === 2 && audit[0].details.copiesAdded === 4, audit);
const anaList = (await call('GET', a, '/my-assignment', undefined, {}, ana.token)).json().assignments as { filename: string; downloadPath: string }[];
const anaBody = (await app.inject({ method: 'GET', url: anaList[0].downloadPath, headers: bearer(ana.token) })).body;
check("ana's plot file: plots 1 and 7 with round 2, nothing says reference", anaBody.includes('\r\n1;2;-10;') && anaBody.includes('\r\n7;2;-10;') && !/referen/i.test(JSON.stringify(anaList)), { anaList, anaBody });
const refused = await call('POST', a, '/reference/plots', { csvFileId: fileId, assessorUserId: maria.userId, plots: ['2'] });
check('a collector cannot be the reference assessor (400 bad_assessor)', refused.statusCode === 400 && refused.json().code === 'bad_assessor', refused.body);

// The accuracy, worked out by the quality worker (Postgres: the worker reads the records itself).
// Records sent by each person's session (stored under their username).
const send = async (operator: string, token: string, round: number, plots: number[], landUse: (p: number) => string = () => 'F') => {
  const r = await batchRequest(app, a, token, plots.map((p) => envelope({ recordKey: `${p},${round}`, operator, modifiedOn: clock, activelySaved: true, summary: { collect_code_land_use: landUse(p), collect_code_round: String(round) } })));
  check(`${operator}'s records stored`, r.statusCode === 200, r.body);
};
await send('owner', ownerToken, 1, [1, 7]);
await send('ana', ana.token, 2, [1, 7], (p) => (p === 7 ? 'G' : 'F'));
await send('maria', maria.token, 2, [1]);
let figures: any = null;
for (let i = 0; i < 100; i++) {
  const r = await call('GET', a, '/reference');
  figures = r.json().figures;
  if (r.statusCode === 200 && figures && !figures.stale && figures.checks === 3) break;
  await sleep(100);
}
check(
  'the worker measures the checks against the reference: ana 1 of 2, maria 1 of 1',
  figures?.checks === 3 &&
    figures.people.find((p: any) => p.username === 'ana')?.plots.agreeing === 1 &&
    figures.people.find((p: any) => p.username === 'maria')?.plots.compared === 1,
  figures,
);
const quality = (await call('GET', a, '/quality')).json();
check('the reference plots are not in the agreement figures', quality.plotsChecked === 0 && quality.differences.length === 0, { plotsChecked: quality.plotsChecked });
const forRita = (await call('GET', a, '/reference', undefined, {}, rita.token)).json();
check('a reviewer reads the accuracy, not the plots', forRita.coordinator === false && forRita.plots === undefined && forRita.figures?.byPlot === undefined && forRita.figures?.checks === 3, forRita);
const anaWork = JSON.stringify((await call('GET', a, '/my-work?tz=UTC', undefined, {}, ana.token)).json());
check("ana's My work says nothing of reference plots or accuracy", !/referen|accura/i.test(anaWork));

// A collector who joins later gets the copies on their next plot list.
const bruno = await join(a, 'bruno');
name.set(bruno.userId, 'bruno');
t = await timed(() => call('GET', a, '/my-assignment', undefined, {}, bruno.token));
check('bruno joins: his first plot list holds plots 1 and 7', t.value.json().assignments[0]?.plotCount === 2 && (await held(a, fileId, ['1', '7'])).filter((h) => h.includes('bruno')).length === 2, t.value.body);
console.log(`     GET /my-assignment that added the reference copies: ${t.ms} ms`);

// Removing: copies not checked go, checks made stay.
res = await call('POST', a, '/reference/remove', { plots: [{ csvFileId: fileId, plot: '7' }] });
check('remove plot 7: unmarked, the copies of jose, maria and bruno dropped, ana\'s (checked) kept', res.statusCode === 200 && res.json().result.unmarked === 1 && (await held(a, fileId, ['7'])).join() === '7:ana:copy,7:owner:main', { body: res.body, held: await held(a, fileId, ['7']) });

// RLS: the app role sees another project's reference plots only under its setting.
const appClient = new pg.Client({ connectionString: appUrl });
await appClient.connect();
await appClient.query('BEGIN');
await appClient.query("SELECT set_config('app.current_project', $1, true)", [b]);
const seen = (await appClient.query('SELECT project_id FROM reference_plots')).rows;
check("with B set, A's reference plots are not read", seen.length === 0, seen);
let insertRefused = false;
try {
  await appClient.query('SAVEPOINT s');
  await appClient.query('INSERT INTO reference_plots (project_id, csv_file_id, plot_key, assessor_user_id) VALUES ($1, $2, $3, $4)', [a, fileId, '3', ownerId]);
} catch {
  insertRefused = true;
  await appClient.query('ROLLBACK TO SAVEPOINT s');
}
check('with B set, a reference plot of A is refused', insertRefused);
const updated = await appClient.query('UPDATE reference_plots SET assessor_user_id = $2 WHERE project_id = $1', [a, maria.userId]);
const deleted = await appClient.query('DELETE FROM reference_plots WHERE project_id = $1', [a]);
check("with B set, A's reference plots are neither changed nor deleted", updated.rowCount === 0 && deleted.rowCount === 0);
await appClient.query('ROLLBACK');
await appClient.query('BEGIN');
await appClient.query("SELECT set_config('app.current_project', '', true)");
check("with '' set: no rows, no error", (await appClient.query('SELECT 1 FROM reference_plots')).rows.length === 0);
await appClient.query('ROLLBACK');
await appClient.end();
const fromB = await store.changeReferencePlots(b, {
  unmark: [{ csvFileId: fileId, plotKey: '1' }],
  dropCopies: [{ csvFileId: fileId, plotKey: '1', userId: ana.userId }],
  mark: [{ csvFileId: fileId, plotKey: '2', assessorUserId: ownerId }],
  addCopies: [{ csvFileId: fileId, plotKey: '1', userId: rita.userId }],
  at: clock,
  by: null,
});
check("changeReferencePlots under B changes nothing of A", fromB.unmarked + fromB.marked + fromB.copiesAdded + fromB.copiesDropped === 0 && (await store.listReferencePlots(a)).length === 1, fromB);
check('listReferencePlots under B: none of A', (await store.listReferencePlots(b)).length === 0);

// Whole again drops the reference plots; deleting the project deletes them.
await call('PUT', a, `/csv-files/${fileId}/distribution`, { mode: 'whole' });
check('whole again: no reference plot left', (await owner.query('SELECT count(*)::int AS n FROM reference_plots WHERE project_id = $1', [a])).rows[0].n === 0);

// --- 100,000 plots, 40 collectors, every fifth plot copied and checked; 50 reference plots. ---
const big = await project('Big');
const N = 100_000;
check('CEP (big)', (await call('PUT', big, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
const csv = ['id,lat,lon', ...Array.from({ length: N }, (_, i) => `${i + 1},0,0`)].join('\n') + '\n';
res = await call('PUT', big, '/csv-files/big.csv', csv, { 'content-type': 'text/csv' });
check('a plot file of 100,000 plots', res.statusCode === 201, res.body);
const bigFile = res.json().id as string;
const now = clock;
await owner.query(`INSERT INTO users (id, username, password_hash) SELECT gen_random_uuid(), 'op' || k, 'x' FROM generate_series(0, 39) k`);
await owner.query(`INSERT INTO project_members (project_id, user_id, role) SELECT $1, id, 'operator' FROM users WHERE username ~ '^op[0-9]+$'`, [big]);
await owner.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`, [big, ownerId]);
await owner.query(`UPDATE csv_files SET distribution = '{"mode": "manual"}' WHERE id = $1`, [bigFile]);
await owner.query(
  `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap)
   SELECT $1::uuid, $2::uuid, i::text, u.id, false FROM generate_series(1, $3::int) i JOIN users u ON u.username = 'op' || (i % 40)
   UNION ALL
   SELECT $1::uuid, $2::uuid, i::text, u.id, true FROM generate_series(1, $3::int) i JOIN users u ON u.username = 'op' || ((i + 1) % 40) WHERE i % 5 = 0`,
  [big, bigFile, N],
);
// First assessments of 99 % of the plots (every hundredth not started: those can be reference
// plots), checks of every fifth.
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on)
   SELECT $1::uuid, i || ',1', 'op' || (i % 40), to_timestamp(($2::bigint - (i % 90) * $3::bigint) / 1000.0), to_timestamp(($2::bigint - (i % 90) * $3::bigint) / 1000.0),
          true, 1, '<r/>', jsonb_build_object('collect_code_land_use', 'forest', 'collect_real_canopy', '50'), false, NULL::timestamptz
     FROM generate_series(1, $4::int) i WHERE i % 100 <> 0
   UNION ALL
   SELECT $1::uuid, i || ',2', 'op' || ((i + 1) % 40), to_timestamp(($2::bigint - (i % 60) * $3::bigint) / 1000.0), to_timestamp(($2::bigint - (i % 60) * $3::bigint) / 1000.0),
          true, 1, '<r/>', jsonb_build_object('collect_code_land_use', 'forest', 'collect_real_canopy', '50'), false, NULL::timestamptz
     FROM generate_series(1, $4::int) i WHERE i % 5 = 0 AND i % 100 <> 0`,
  [big, now, DAY, N],
);
await owner.query(
  `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change, summary)
   SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, false, 'submitted', NULL FROM records WHERE project_id = $1`,
  [big],
);
await owner.query('ANALYZE records; ANALYZE record_events; ANALYZE plot_assignments');
t = await timed(() => call('POST', big, '/reference/plots', { csvFileId: bigFile, assessorUserId: ownerId, random: 50 }));
const marked = t.value.json();
check('50 reference plots picked at random among the plots nobody started; 40 collectors hold a copy of each', t.value.statusCode === 200 && marked.result.marked === 50 && marked.plots.every((p: any) => Number(p.plot) % 100 === 0 && p.copies === 40), { status: t.value.statusCode, result: marked.result });
console.log(`     POST /reference/plots random 50 on 100,000 plots (state built, holdings read, ${marked.result.copiesAdded} copies added): ${t.ms} ms`);
const refPlots: string[] = marked.plots.map((p: any) => p.plot);
// The owner assesses them; every collector checks them, op0-op9 differ on land use on all, the others on one plot in ten.
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on)
   SELECT $1::uuid, p || ',1', 'owner', now(), now(), true, 1, '<r/>', jsonb_build_object('collect_code_land_use', 'forest', 'collect_real_canopy', '50'), false, NULL::timestamptz FROM unnest($2::text[]) p
   UNION ALL
   SELECT $1::uuid, u.p || ',2', 'op' || k, now(), now(), true, 1, '<r/>',
          jsonb_build_object('collect_code_land_use', CASE WHEN k < 10 OR u.n % 10 = k % 10 THEN 'cropland' ELSE 'forest' END, 'collect_real_canopy', '52'), false, NULL::timestamptz
     FROM unnest($2::text[]) WITH ORDINALITY AS u(p, n) CROSS JOIN generate_series(0, 39) k`,
  [big, refPlots],
);
await owner.query('ANALYZE records');
let bigFigures: any = null;
const cold = await timed(async () => {
  for (let i = 0; i < 600; i++) {
    const r = await call('GET', big, '/reference');
    bigFigures = r.json().figures;
    if (r.statusCode === 200 && bigFigures && !bigFigures.stale && bigFigures.checks === 2000) return r;
    await sleep(100);
  }
  return null;
});
check('the worker measures 2,000 checks of 50 reference plots by 40 collectors', bigFigures?.checks === 2000 && bigFigures.people.length === 40 && bigFigures.assessed === 50, { checks: bigFigures?.checks, people: bigFigures?.people?.length });
console.log(`     GET /reference cold (worker job: 100,000 + 22,000 records, the report, the tables and the accuracy): ${cold.ms} ms`);
const op0 = bigFigures?.people.find((p: any) => p.username === 'op0');
const op15 = bigFigures?.people.find((p: any) => p.username === 'op15');
check('op0 (differs on every plot) 0 of 50; op15 45 of 50; numbers within the margin match', op0?.plots.agreeing === 0 && op15?.plots.agreeing === 45 && op15?.plots.rate === 0.9, { op0: op0?.plots, op15: op15?.plots });
const warm = await timed(() => call('GET', big, '/reference'));
console.log(`     GET /reference warm: ${warm.ms} ms`);
const bigQuality = (await call('GET', big, '/quality')).json();
check('the agreement figures leave the 2,000 reference checks out (19,000 checked plots)', bigQuality.plotsChecked === 19_000, bigQuality.plotsChecked);
// A collector's plot list (2,500 plots, 2,500 division copies, 50 reference copies).
const op10 = (await owner.query("SELECT id FROM users WHERE username = 'op10'")).rows[0].id as string;
const session = await store.createSession(op10);
const list = await timed(() => call('GET', big, '/my-assignment', undefined, {}, session));
const again = await timed(() => call('GET', big, '/my-assignment', undefined, {}, session));
check("op10's plot list", list.value.statusCode === 200 && list.value.json().assignments.length === 1, list.value.body);
console.log(`     GET /my-assignment for op10 (5,050 holdings, its copies' records read by key): ${list.ms} ms, again ${again.ms} ms`);
// A new collector joins: their first plot list adds the 50 copies.
await owner.query(`INSERT INTO users (id, username, password_hash) VALUES (gen_random_uuid(), 'newcomer', 'x')`);
const newcomer = (await owner.query("SELECT id FROM users WHERE username = 'newcomer'")).rows[0].id as string;
await owner.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'operator')`, [big, newcomer]);
const newSession = await store.createSession(newcomer);
const first = await timed(() => call('GET', big, '/my-assignment', undefined, {}, newSession));
check('a collector who joins gets the 50 reference plots on their first plot list', first.value.json().assignments[0]?.plotCount === 50, first.value.body);
console.log(`     GET /my-assignment adding 50 reference copies on 100,000 plots: ${first.ms} ms`);
// The check sampling never draws a reference plot.
await call('PUT', big, '/sampling', { firstN: 10, percent: 30 });
const draw = await timed(() => call('POST', big, '/sampling/draw'));
const drawnRef = (await owner.query('SELECT count(*)::int AS n FROM plot_assignments WHERE project_id = $1 AND sampled_at IS NOT NULL AND plot_key = ANY($2::text[])', [big, refPlots])).rows[0].n;
check('Draw now on 100,000 plots draws no reference plot', draw.value.statusCode === 200 && draw.value.json().draw.drawn > 5000 && drawnRef === 0, { draw: draw.value.json().draw, drawnRef });
console.log(`     POST /sampling/draw with 50 reference plots: ${draw.ms} ms (${draw.value.json().draw.drawn} copies)`);
// Removing them all.
const removeAll = await timed(() => call('POST', big, '/reference/remove', { all: true }));
check('remove all 50: the checked copies stay (every collector checked)', removeAll.value.statusCode === 200 && removeAll.value.json().result.unmarked === 50 && removeAll.value.json().result.copiesDropped === 50, removeAll.value.json().result);
console.log(`     POST /reference/remove all: ${removeAll.ms} ms`);
// Deleting a project deletes its reference plots.
await call('PUT', a, `/csv-files/${fileId}/distribution`, { mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
await call('POST', a, '/reference/plots', { csvFileId: fileId, assessorUserId: ownerId, plots: ['3'] });
const before = (await owner.query('SELECT count(*)::int AS n FROM reference_plots WHERE project_id = $1', [a])).rows[0].n;
await store.deleteProject(a);
const gone = (await owner.query('SELECT count(*)::int AS n FROM reference_plots WHERE project_id = $1', [a])).rows[0].n;
check('deleteProject deletes its reference plots', before === 1 && gone === 0, { before, gone });

await app.close();
await store.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
