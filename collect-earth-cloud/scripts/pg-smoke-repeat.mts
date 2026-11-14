// Smoke test of the repeat survey (docs/plans/2026-11-11-repeat-survey.md, migration 037) on a THROWAWAY PostgreSQL (it
// drops and creates the database `cerepeat` and the role `ce_repeat_app`): the migration twice, the server as a
// NOSUPERUSER NOBYPASSRLS app role, a project with answers repeated (the earlier answers stored apart, the settings),
// the routes that read them, a repeat of the repeat, and RLS between the projects.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55483:5432 postgres:16
//   npm run smoke:pg:repeat -- 55483        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55483';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cerepeat`;
const appUrl = `postgres://ce_repeat_app:apppw@${host}/cerepeat`;
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
await sup.query('DROP DATABASE IF EXISTS cerepeat');
await sup.query('DROP ROLE IF EXISTS ce_repeat_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cerepeat OWNER ceown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const rls = (await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'period_answers'")).rows[0];
const policies = (await owner.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'period_answers'")).rows[0].n;
const column = (await owner.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'repeat_settings'")).rows[0].n;
check('037 (twice): period_answers under RLS, one policy; projects.repeat_settings', rls?.relrowsecurity === true && policies === 1 && column === 1, { rls, policies, column });

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, stateStaleMs: 0, qualityMinIntervalMs: 0 } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
check('setup', res.statusCode === 201, res.body);
const ownerToken = res.json().token as string;
const call = (method: any, pid: string, path: string, payload?: unknown, headers: Record<string, string> = {}, token = ownerToken) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as any });

const a = (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name: 'Land 2020' } })).json().projectId as string;
await call('PUT', a, '/cep', idOnlyCep(), { 'content-type': 'application/zip' });
const csv = await call('PUT', a, '/csv-files/plots.csv', ['id,lat,lon', ...Array.from({ length: 6 }, (_, i) => `${i + 1},0,0`)].join('\n'), { 'content-type': 'text/csv' });
const invite = await call('POST', a, '/invites', { role: 'operator', maxUses: 1 });
res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'maria', password: 'password12', inviteToken: invite.json().inviteToken } });
const maria = res.json() as { token: string; userId: string };
await call('PUT', a, '/assignments', { assignments: [{ userId: maria.userId, csvFileId: csv.json().id }] });
const LAND = 'collect_code_land_use_category';
const uses = ['F', 'C', 'G', 'S', 'W', 'O'];
res = await batchRequest(app, a, maria.token, uses.map((u, i) => envelope({ recordKey: `${i + 1},1`, operator: 'maria', modifiedOn: Date.UTC(2020, 5, i + 1), activelySaved: i < 5, summary: { [LAND]: u, collect_code_round: '1' } })));
check('records of 2020', res.statusCode === 200, res.body);

res = await call('POST', a, '/repeat/preview', {});
check('preview: 5 submitted plots, labelled 2020', res.statusCode === 200 && res.json().plots === 5 && res.json().earlierLabel === '2020', res.body);
res = await call('POST', a, '/repeat', { name: 'Land 2025', label: '2025', earlierLabel: '2020', members: true });
check('repeated', res.statusCode === 201, res.body);
const b = res.json().projectId as string;
check('the earlier answers stored apart (5 plots), none as records', (await store.listPeriodAnswers(b, '2020')).length === 5 && (await store.listRecords(b)).length === 0);
const settings = await store.getRepeatSettings(b);
check('the settings', settings?.label === '2025' && settings.earlier[0]?.label === '2020' && settings.earlier[0]?.plots === 5 && settings.headerQuestions.includes(LAND), settings);
res = await call('GET', b, '/periods/plots/2', undefined, {}, maria.token);
check("a collector reads a plot's earlier answers, not who gave them", res.statusCode === 200 && res.json().periods[0]?.answers[LAND] === 'C' && !('operator' in res.json().periods[0]), res.body);
res = await call('PUT', b, '/periods/header', { headerQuestions: [LAND] });
check('the header changed', res.statusCode === 200 && (await store.getRepeatSettings(b))?.headerQuestions.join() === LAND, res.body);

// A repeat of the repeat carries 2020 along
await call('PUT', b, '/status', { status: 'active' });
res = await batchRequest(app, b, maria.token, [envelope({ recordKey: '1,1', operator: 'maria', modifiedOn: Date.UTC(2025, 5, 1), summary: { [LAND]: 'S', collect_code_round: '1' } })]);
res = await call('POST', b, '/repeat', { name: 'Land 2030', label: '2030', earlierLabel: '2025' });
check('repeated again', res.statusCode === 201, res.body);
const c = res.json().projectId as string;
const plot1 = await store.getPlotPeriodAnswers(c, '1');
check('both earlier periods, oldest first', plot1.map((r) => `${r.label}:${r.answers[LAND]}`).join() === '2020:F,2025:S', plot1);

// RLS: the app role sees no project's rows without its project set
const app2 = new pg.Client({ connectionString: appUrl });
await app2.connect();
const seen = (await app2.query('SELECT count(*)::int AS n FROM period_answers')).rows[0].n;
await app2.query("SELECT set_config('app.current_project', $1, false)", [a]);
const ofA = (await app2.query('SELECT count(*)::int AS n FROM period_answers')).rows[0].n;
check('RLS: no rows without a project, none of B and C from A', seen === 0 && ofA === 0, { seen, ofA });
await app2.end();
check('deleting the project deletes its earlier answers', await (async () => {
  await store.deleteProject(c);
  return (await owner.query('SELECT count(*)::int AS n FROM period_answers WHERE project_id = $1', [c])).rows[0].n === 0;
})());

await app.close();
await owner.end();
await store.close?.();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
