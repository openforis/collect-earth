// Smoke test of the automatic check sampling (Task 13, migration 019) on a THROWAWAY
// PostgreSQL (it drops and creates the database `cesamp` and the role `ce_samp_app`): the
// migration twice, the server as a NOSUPERUSER NOBYPASSRLS app role, a first submission that
// draws at once, the 10 minutes' coalescing and the plot list that draws after them, what the
// checker is served (round 2), the audit, two draws at once, RLS between two projects, and a
// draw on a project of 100,000 plots (40 collectors, 20 % already copied), timed.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:sampling -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cesamp`;
const appUrl = `postgres://ce_samp_app:apppw@${host}/cesamp`;
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
await sup.query('DROP DATABASE IF EXISTS cesamp');
await sup.query('DROP ROLE IF EXISTS ce_samp_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cesamp OWNER ceown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const column = (await owner.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'plot_assignments' AND column_name = 'sampled_at'")).rows[0];
check('019: plot_assignments.sampled_at (twice, idempotent)', column?.data_type === 'timestamp with time zone', column);
const rls = (await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'sampling_rules'")).rows[0];
const policies = (await owner.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'sampling_rules'")).rows[0].n;
check('019: sampling_rules under RLS, one policy', rls?.relrowsecurity === true && policies === 1, { rls, policies });

// --- The server as the app role, on a clock the smoke moves. ---
let clock = Date.now();
const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, stateStaleMs: 0 } as any,
  webDir: null,
  ai: { now: () => clock },
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
const jose = await join(a, 'jose');
const ana = await join(a, 'ana');
await join(b, 'pedro');

check('CEP', (await call('PUT', a, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
const rows = Array.from({ length: 12 }, (_, i) => `${i + 1};-10;${20 + i}`).join('\r\n');
res = await call('PUT', a, '/csv-files/north.csv', `id;lat;lon\r\n${rows}\r\n`, { 'content-type': 'text/csv' });
const fileId = res.json().id as string;
res = await call('PUT', a, `/csv-files/${fileId}/distribution`, { mode: 'even', people: [maria.userId, jose.userId], order: 'file' });
check('north.csv divided: maria 1-6, jose 7-12', res.statusCode === 200, res.body);
res = await call('PUT', a, '/sampling', { firstN: 2 });
check('PUT /sampling (coordinator)', res.statusCode === 200 && res.json().active === true, res.body);
check('GET /sampling refused to a collector', (await call('GET', a, '/sampling', undefined, {}, maria.token)).statusCode === 403);
const anaBefore = (await call('GET', a, '/my-assignment', undefined, {}, ana.token)).json().assignments;
const drawnOf = async (pid: string, file: string) => (await store.listPlotAssignments(pid, file)).filter((h) => h.sampledAt !== undefined);
const submit = (token: string, plots: number[]) =>
  batchRequest(app, a, token, plots.map((p) => envelope({ recordKey: `${p},1`, modifiedOn: clock, activelySaved: true, summary: { land_use: 'F', collect_code_round: '1' } })));

let t = await timed(() => submit(maria.token, [1, 2, 3]));
let drawn = await drawnOf(a, fileId);
check('a first submission draws at once: plots 1 and 2, never to maria', t.value.statusCode === 200 && drawn.map((h) => h.plotKey).sort().join() === '1,2' && drawn.every((h) => h.userId !== maria.userId), drawn);
console.log(`     records:batch that drew (state built, 2 copies): ${t.ms} ms`);
const audit = await store.listAudit(a, { limit: 3, action: 'sampling.drawn' });
check('audited sampling.drawn, automatic, with its counts', audit.length === 1 && audit[0].actorUserId === null && audit[0].details.drawn === 2 && audit[0].details.automatic === true, audit);
const tokenOf = new Map([[jose.userId, jose.token], [ana.userId, ana.token]]);
for (const h of drawn) {
  const token = tokenOf.get(h.userId)!;
  const list = (await call('GET', a, '/my-assignment', undefined, {}, token)).json().assignments as { filename: string; downloadPath: string; checksum: string }[];
  const entry = list.find((e) => e.filename === 'north.csv')!;
  const body = (await app.inject({ method: 'GET', url: entry.downloadPath, headers: bearer(token) })).body;
  check(`the checker's file has plot ${h.plotKey} with round 2`, body.includes(`\r\n${h.plotKey};2;-10;`), body);
}
if (drawn.some((h) => h.userId === ana.userId)) {
  const anaAfter = (await call('GET', a, '/my-assignment', undefined, {}, ana.token)).json().assignments;
  check("ana's plot list changed (a new file, its checksum)", JSON.stringify(anaAfter) !== JSON.stringify(anaBefore), anaAfter);
}
clock += 60_000;
t = await timed(() => submit(jose.token, [7, 8]));
drawn = await drawnOf(a, fileId);
const view = (await call('GET', a, '/sampling')).json();
check('within 10 minutes: no draw, a draw due', drawn.length === 2 && view.due === true && view.pending.drawn === 2, { drawn: drawn.length, due: view.due, pending: view.pending });
console.log(`     records:batch with a first submission, no draw (claim refused): ${t.ms} ms`);
clock += 10 * 60_000;
t = await timed(() => call('GET', a, '/my-assignment', undefined, {}, ana.token));
drawn = await drawnOf(a, fileId);
check('after 10 minutes, a plot list draws (7 and 8 checked, never by jose)', drawn.length === 4 && drawn.filter((h) => ['7', '8'].includes(h.plotKey)).every((h) => h.userId !== jose.userId), drawn);
console.log(`     GET /my-assignment that drew: ${t.ms} ms`);
const [d1, d2] = await Promise.all([call('POST', a, '/sampling/draw'), call('POST', a, '/sampling/draw')]);
const perPlot = (await owner.query('SELECT plot_key, count(*)::int AS n FROM plot_assignments WHERE project_id = $1 AND overlap GROUP BY plot_key HAVING count(*) > 1', [a])).rows;
check('two "Draw now" at once: 200 both, nothing more drawn, no plot with two copies', d1.statusCode === 200 && d2.statusCode === 200 && perPlot.length === 0 && (await drawnOf(a, fileId)).length === 4, { d1: d1.body, perPlot });

// --- RLS: the app role sees another project's rule only under its setting. ---
const appClient = new pg.Client({ connectionString: appUrl });
await appClient.connect();
await appClient.query('BEGIN');
await appClient.query("SELECT set_config('app.current_project', $1, true)", [b]);
const seen = (await appClient.query('SELECT project_id FROM sampling_rules')).rows;
check("with B set, A's sampling rule is not read", seen.length === 0, seen);
let refused = false;
try {
  await appClient.query('SAVEPOINT s');
  await appClient.query("INSERT INTO sampling_rules (project_id, rule) VALUES ($1, '{}')", [a]);
} catch {
  refused = true;
  await appClient.query('ROLLBACK TO SAVEPOINT s');
}
check('with B set, a rule for A is refused', refused);
const updated = await appClient.query("UPDATE sampling_rules SET due_since = now() WHERE project_id = $1", [a]);
check("with B set, A's rule is not changed", updated.rowCount === 0);
await appClient.query('ROLLBACK');
await appClient.query('BEGIN');
await appClient.query("SELECT set_config('app.current_project', '', true)");
const none = (await appClient.query('SELECT project_id FROM sampling_rules')).rows;
check("with '' set: no rows, no error", none.length === 0);
await appClient.query('ROLLBACK');
await appClient.end();
const fromB = await store.addSampledCopies(b, [{ csvFileId: fileId, plotKey: '5', userId: ana.userId, reason: 'firstN' }], { at: clock, byUserId: null, automatic: true, drawn: 0, firstN: 0, percent: 0, noChecker: 0 }, clock);
check("addSampledCopies under B adds nothing to A's file", fromB.length === 0 && (await drawnOf(a, fileId)).length === 4, fromB);

// --- 100,000 plots: 40 collectors, every fifth plot already copied (and checked). ---
const big = await project('Big');
const N = 100_000;
check('CEP (big)', (await call('PUT', big, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
const csv = ['id,lat,lon', ...Array.from({ length: N }, (_, i) => `${i + 1},0,0`)].join('\n') + '\n';
res = await call('PUT', big, '/csv-files/big.csv', csv, { 'content-type': 'text/csv' });
check('a plot file of 100,000 plots', res.statusCode === 201, res.body);
const bigFile = res.json().id as string;
const now = clock;
await owner.query(`INSERT INTO users (id, username, password_hash) SELECT gen_random_uuid(), 'op' || k, 'x' FROM generate_series(0, 39) k`);
await owner.query(`INSERT INTO project_members (project_id, user_id, role) SELECT $1, id, 'operator' FROM users WHERE username LIKE 'op%'`, [big]);
await owner.query(`UPDATE csv_files SET distribution = '{"mode": "manual"}' WHERE id = $1`, [bigFile]);
await owner.query(
  `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap)
   SELECT $1::uuid, $2::uuid, i::text, u.id, false FROM generate_series(1, $3::int) i JOIN users u ON u.username = 'op' || (i % 40)
   UNION ALL
   SELECT $1::uuid, $2::uuid, i::text, u.id, true FROM generate_series(1, $3::int) i JOIN users u ON u.username = 'op' || ((i + 1) % 40) WHERE i % 5 = 0`,
  [big, bigFile, N],
);
// Main assessments "<i>,1" over 90 days (every tenth a draft), checks "<i>,2" of every fifth plot.
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on)
   SELECT $1::uuid, i || ',1', 'op' || (i % 40), to_timestamp(($2::bigint - (i % 90) * $3::bigint - (i % 1000) * 1000) / 1000.0), to_timestamp(($2::bigint - (i % 90) * $3::bigint) / 1000.0),
          i % 10 <> 0, 1, '<r/>', jsonb_build_object('land_use', 'forest'), false, NULL::timestamptz
     FROM generate_series(1, $4::int) i
   UNION ALL
   SELECT $1::uuid, i || ',2', 'op' || ((i + 1) % 40), to_timestamp(($2::bigint - (i % 60) * $3::bigint) / 1000.0), to_timestamp(($2::bigint - (i % 60) * $3::bigint) / 1000.0),
          true, 1, '<r/>', jsonb_build_object('land_use', 'forest'), false, NULL::timestamptz
     FROM generate_series(1, $4::int) i WHERE i % 5 = 0`,
  [big, now, DAY, N],
);
await owner.query(
  `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change, summary)
   SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, false,
          CASE WHEN actively_saved THEN 'submitted' ELSE 'created' END, NULL
     FROM records WHERE project_id = $1`,
  [big],
);
await owner.query('ANALYZE records; ANALYZE record_events; ANALYZE plot_assignments');
// 30 % a week: plots already copied (20 %) count, so about 10 % more; and the first 10 of each.
res = await call('PUT', big, '/sampling', { firstN: 10, percent: 30 });
check('the rule (big)', res.statusCode === 200, res.body);
const preview = await timed(() => call('GET', big, '/sampling'));
const pending = preview.value.json().pending;
console.log(`     GET /sampling (preview of the draw, state built): ${preview.ms} ms; a draw would add ${pending.drawn} (${pending.firstN} first, ${pending.percent} share)`);
const draw = await timed(() => call('POST', big, '/sampling/draw'));
const drawnBig = draw.value.json().draw;
check('Draw now on 100,000 plots adds what the preview said', draw.value.statusCode === 200 && drawnBig.drawn === pending.drawn && drawnBig.drawn > 5000, drawnBig);
console.log(`     POST /sampling/draw on 100,000 plots: ${draw.ms} ms (${drawnBig.drawn} copies; the state, the holdings, the draw, the insert, the view after)`);
const doubled = (await owner.query('SELECT plot_key FROM plot_assignments WHERE project_id = $1 AND overlap GROUP BY plot_key HAVING count(*) > 1 LIMIT 5', [big])).rows;
const self = (await owner.query(
  `SELECT p.plot_key FROM plot_assignments p JOIN users u ON u.id = p.user_id
    JOIN records r ON r.project_id = p.project_id AND r.operator = u.username AND split_part(r.record_key, ',', 1) = p.plot_key
   WHERE p.project_id = $1 AND p.sampled_at IS NOT NULL LIMIT 5`,
  [big],
)).rows;
check('no plot with two copies, no checker with a record of their plot', doubled.length === 0 && self.length === 0, { doubled, self });
// The division's copies (8 collectors hold them all) are checked already: no open load, so the
// draw shares its copies evenly between the 40.
const load = (await owner.query('SELECT user_id, count(*)::int AS n FROM plot_assignments WHERE project_id = $1 AND sampled_at IS NOT NULL GROUP BY user_id', [big])).rows.map((r) => r.n as number);
console.log(`     copies drawn per collector: ${Math.min(...load)}-${Math.max(...load)} (40 collectors)`);
check('the load is balanced (drawn copies per collector within 2 of each other, all 40)', load.length === 40 && Math.max(...load) - Math.min(...load) <= 2, load);
const again = await timed(() => call('POST', big, '/sampling/draw'));
check('drawing again adds nothing (repeatable, no double copies)', again.value.json().draw?.drawn === 0, again.value.json().draw);
console.log(`     POST /sampling/draw again: ${again.ms} ms`);
// An automatic draw from a first submission after the interval.
clock += 11 * 60_000;
const op1 = (await owner.query("SELECT id FROM users WHERE username = 'op10'")).rows[0].id as string;
// op10 holds plot 10 (a draft): submitted now through a session.
const sessionToken = await store.createSession(op1);
const auto = await timed(() => batchRequest(app, big, sessionToken, [envelope({ recordKey: '10,1', modifiedOn: clock, activelySaved: true, summary: { land_use: 'forest' } })]));
const autoDraw = (await store.getSampling(big)).lastDraw;
check('records:batch with a first submission after 10 minutes draws automatically', auto.value.statusCode === 200 && autoDraw?.automatic === true && autoDraw.at === clock, { body: auto.value.body, autoDraw });
console.log(`     records:batch that drew on 100,000 plots: ${auto.ms} ms (the draw: ${JSON.stringify(autoDraw)})`);
const isolated = (await call('GET', big, '/sampling', undefined, {}, maria.token)).statusCode;
check("a member of another project cannot read this one's checks", isolated === 403 || isolated === 404, isolated);

await app.close();
await store.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
