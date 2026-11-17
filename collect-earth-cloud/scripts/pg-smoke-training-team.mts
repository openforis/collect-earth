// Smoke test of training the team (docs/plans/2026-11-17-training-the-team.md, migration 046) on a THROWAWAY
// PostgreSQL (it drops and creates the database `cetrain` and the role `ce_train_app`): the migrations twice, the server
// as a NOSUPERUSER NOBYPASSRLS app role, a set for everyone (whoever joins included, coordinators not), training records
// taken while the project is a draft and its other records refused, plots copied from a plot file with new ids,
// finishing (scores kept, answers deleted, Collect Earth told, a late record discarded), a deleted set's plots retired,
// and RLS between two projects.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:training-team -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cetrain`;
const appUrl = `postgres://ce_train_app:apppw@${host}/cetrain`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: superUrl });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS cetrain');
await sup.query('DROP ROLE IF EXISTS ce_train_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cetrain OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const rls = (await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'training_retired_plots'")).rows[0];
const columns = (await owner.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'training_sets' AND column_name IN ('everyone', 'finished_at', 'finished_by', 'results') ORDER BY 1")).rows.map((r) => r.column_name);
check('046 (twice): the new columns, training_retired_plots under RLS', rls?.relrowsecurity === true && columns.join() === 'everyone,finished_at,finished_by,results', { rls, columns });

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, stateStaleMs: 0, qualityMinIntervalMs: 0 } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
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
check('CEP', (await call('PUT', a, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
res = await call('PUT', a, '/csv-files/north.csv', 'id;lat;lon\r\n1;-10;20\r\n2;-10;21\r\n3;-10;22\r\n4;-10;23\r\n', { 'content-type': 'text/csv' });
const fileId = res.json().id as string;
const status = (r: { json: () => { results: { status: string }[] } }) => r.json().results.map((x) => x.status).join();
// The answers: the first choice question training compares, its first option (set below, once a set gives the questions)
let question = { key: 'none', yes: '', no: '' };
const send = (token: string, who: string, plots: string[]) =>
  batchRequest(app, a, token, plots.map((p) => envelope({ recordKey: p, operator: who, modifiedOn: Date.now() - 60_000, activelySaved: true, summary: { [question.key]: question.yes } })));

// Copied from the plot file, for everyone
res = await call('POST', a, '/training-sets/from-plot-file', { csvFileId: fileId, count: 2, name: 'Day 1', kind: 'learning', passMark: 50 });
const setId = res.json().id as string;
const choice = (await call('GET', a, `/training/${setId}`)).json().questions.find((q: { kind: string; options: { code: string }[] | null }) => q.kind === 'choice' && (q.options?.length ?? 0) > 1);
question = { key: choice.key, yes: choice.options[0].code, no: choice.options[1].code };
check('a set copied from north.csv for everyone: T-1, T-3', res.statusCode === 201 && res.json().everyone === true && (await store.getTrainingSet(a, setId))!.plotKeys.join() === 'T-1,T-3', res.body);
const rita = await join(a, 'rita', 'reviewer');
const people = (await store.getTrainingSet(a, setId))!.memberIds.sort();
check('everyone: maria, jose and rita who joined after, not the owner', people.join() === [maria.userId, jose.userId, rita.userId].sort().join(), people);
const assignment = (await call('GET', a, '/my-assignment', undefined, {}, rita.token)).json();
check("rita's Collect Earth gets the set", assignment.assignments.some((x: { filename: string }) => x.filename === 'Learning – Day 1.csv'), assignment);

// A draft takes the training's records only
await store.setProjectStatus(a, 'draft');
res = await send(maria.token, 'maria', ['T-1', '1']);
check('draft: the training record stored, the project\'s kept for later', status(res) === 'stored,error', res.body);
res = await send(maria.token, 'maria', ['2']);
check('draft: none of the training: 409 project_draft', res.statusCode === 409 && res.json().error === 'project_draft', res.body);
await store.setProjectStatus(a, 'active');
res = await call('PUT', a, `/training/${setId}/golden/T-1`, { answers: { [question.key]: question.yes } });
check('golden answers set', res.statusCode === 200 && (await call('PUT', a, `/training/${setId}/golden/T-3`, { answers: { [question.key]: question.no } })).statusCode === 200, res.body);
check('jose: both training plots stored', status(await send(jose.token, 'jose', ['T-1', 'T-3'])) === 'stored,stored');

// Finished
res = await call('POST', a, `/training/${setId}/finish`);
check('finished: 3 training records deleted', res.statusCode === 200 && res.json().recordsDeleted === 3, res.body);
check('no training record left', (await store.listTrainingRecords(a)).length === 0);
const view = (await call('GET', a, `/training/${setId}`)).json();
const jo = view.scores.find((s: { username: string }) => s.username === 'jose');
check('the scores as they were: jose 50 %, passed', jo?.score.answers.rate === 0.5 && jo?.score.passed === true, jo);
const attempts = await store.listTrainingAttempts(a, setId);
check('every participant\'s attempt closed (rita\'s written, she never had one)', attempts.length === 3 && attempts.every((x) => x.results !== null), attempts);
const told = (await call('GET', a, '/my-assignment', undefined, {}, maria.token)).json();
check('Collect Earth told: no training file, its file and plots to clean up', told.assignments.length === 0 && told.finishedTraining.files.join() === 'Learning – Day 1.csv' && told.finishedTraining.plots.sort().join() === 'T-1,T-3', told);
check('a record sent late is discarded', status(await send(maria.token, 'maria', ['T-3'])) === 'stale' && (await store.listTrainingRecords(a)).length === 0);
const states = (await store.listRecordStates(a)).map((r) => r.recordKey).sort();
check('the project has no record: plot 1, sent while it was a draft, waits in Collect Earth', states.length === 0, states);

// A second day from the same plot file: the plots the finished set does not have
res = await call('POST', a, '/training-sets/from-plot-file', { csvFileId: fileId, count: 2, name: 'Day 2', everyone: false });
check('a second day copied from north.csv: T-2, T-4 (T-1 and T-3 are the finished set\'s)', res.statusCode === 201 && (await store.getTrainingSet(a, res.json().id))!.plotKeys.join() === 'T-2,T-4', res.body);

// Deleted: retired
res = await call('PUT', a, '/training-sets/c.csv?everyone=true', 'id;lat;lon\r\n90;-10;20\r\n', { 'content-type': 'text/csv' });
const other = res.json().id as string;
check('a training record of plot 90', status(await send(maria.token, 'maria', ['90'])) === 'stored');
await call('DELETE', a, `/training/${other}`);
check('deleted: plot 90 retired, its late record discarded', (await store.listRetiredTrainingPlots(a)).join() === '90' && status(await send(maria.token, 'maria', ['90'])) === 'stale');
res = await call('PUT', a, '/training-sets/c2.csv', 'id;lat;lon\r\n90;-10;20\r\n', { 'content-type': 'text/csv' });
check('a new set takes plot 90 again', res.statusCode === 201 && (await store.listRetiredTrainingPlots(a)).length === 0, res.body);

// RLS
const ownerSees = (await owner.query('SELECT count(*)::int AS n FROM training_retired_plots')).rows[0].n;
const appClient = new pg.Client({ connectionString: appUrl });
await appClient.connect();
await appClient.query("SELECT set_config('app.current_project', $1, false)", [b]);
const bSees = (await appClient.query('SELECT count(*)::int AS n FROM training_sets')).rows[0].n;
const bWrite = await appClient.query('INSERT INTO training_retired_plots (project_id, plot_key) VALUES ($1, $2)', [a, 'x']).then(() => 'written', (e) => String(e.message));
check("RLS: project Beta sees none of Alpha's sets, and cannot retire its plots", bSees === 0 && bWrite.includes('row-level security'), { ownerSees, bSees, bWrite });
await appClient.end();

await app.close();
await owner.end();
await store.close();
console.log(failures === 0 ? 'all ok' : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
