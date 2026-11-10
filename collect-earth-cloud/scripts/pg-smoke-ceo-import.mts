// Smoke test against a real Postgres: a new project from a Collect Earth Online project (src/routes/ceoImport.ts),
// through the app role and Row-Level Security: the project, its coordinator, its project file with the round added,
// the 'project.imported' entry the audit log's constraint (012, 015) allows, a second import with CEO's plot list
// (its plot file stored and logged), and a refused one that leaves nothing behind. Usage: npm run smoke:pg:ceo [port] (a Postgres on localhost with user postgres, password pw).
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { buildServer } from '../src/server.js';
import { runMigrations } from '../src/store/migrate.js';
import { PostgresStore } from '../src/store/postgres.js';

const port = process.argv[2] ?? '55487';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceceoown:pw@${host}/ceceo`;
const appUrl = `postgres://ce_ceo_app:apppw@${host}/ceceo`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: superUrl });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS ceceo');
await sup.query('DROP ROLE IF EXISTS ce_ceo_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceceoown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceceo OWNER ceceoown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });

const store = new PostgresStore(appUrl, { statementTimeoutMs: 60_000 });
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', databaseUrl: appUrl, setupCode: 'SMOKE-CODE-1234', rateLimitPerMinute: 0 },
  webDir: null,
});
const fixture = (id: number) => readFileSync(new URL(`../test/fixtures/ceo/project-${id}.json`, import.meta.url), 'utf8');

try {
  const setup = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'SMOKE-CODE-1234', username: 'owner', password: 'owner-password' } });
  const { token, userId } = setup.json() as { token: string; userId: string };
  const auth = { authorization: `Bearer ${token}` };

  const preview = await app.inject({ method: 'POST', url: '/v1/projects/from-ceo/preview', headers: auth, payload: { ceoProject: fixture(2616) } });
  check('the preview answers', preview.statusCode === 200 && preview.json().counts.questions === 29, preview.body.slice(0, 300));

  const made = await app.inject({ method: 'POST', url: '/v1/projects/from-ceo', headers: auth, payload: { ceoProject: fixture(2616) } });
  check('the project is made, its round added', made.statusCode === 201 && made.json().round === 'added', made.body.slice(0, 300));
  const projectId = made.json().projectId as string;
  const memberships = await store.listMemberships(userId);
  check('its caller is its coordinator', memberships.some((m) => m.projectId === projectId && m.role === 'admin'), memberships);

  const cep = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}/cep`, headers: auth });
  check('its project file downloads', cep.statusCode === 200 && cep.rawPayload.length > 1000, cep.statusCode);

  const log = await store.listAudit(projectId, { limit: 10 });
  const entry = log.find((e) => e.action === 'project.imported');
  check("the audit log has 'project.imported'", entry !== undefined && (entry.details as { ceoProjectId?: number }).ceoProjectId === 2616, log);

  const activity = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}/activity?kind=files`, headers: auth });
  check('the activity lists it under the project files', activity.statusCode === 200 && activity.body.includes('project.imported'), activity.body.slice(0, 300));

  const refused = await app.inject({ method: 'POST', url: '/v1/projects/from-ceo', headers: auth, payload: { ceoProject: fixture(64113) } });
  check('a simplified project is refused', refused.statusCode === 400 && refused.json().error === 'ceo_unreadable', refused.body);

  const plots = readFileSync(new URL('../test/fixtures/ceo/project-743-plots.json', import.meta.url), 'utf8');
  const second = await app.inject({ method: 'POST', url: '/v1/projects/from-ceo', headers: auth, payload: { ceoProject: fixture(743), ceoPlots: plots, name: 'Rome 2026' } });
  check('another with its plots, under its own name', second.statusCode === 201 && second.json().name === 'Rome 2026' && second.json().plotFile?.plots === 210, second.body.slice(0, 300));
  const files = await store.listCsvFiles(second.json().projectId as string);
  check('its plot file is stored with its 210 plots', files.length === 1 && files[0].plotCount === 210, files);
  const secondLog = await store.listAudit(second.json().projectId as string, { limit: 10 });
  check('and logged as uploaded', secondLog.some((e) => e.action === 'csv.uploaded'), secondLog);
  // With CEO's answers (Part C): records through the app role, their events, a named account joining
  const answers = readFileSync(new URL('../test/fixtures/ceo/project-20170-samples.csv', import.meta.url), 'utf8');
  const nepalPlots = readFileSync(new URL('../test/fixtures/ceo/project-20170-plots.json', import.meta.url), 'utf8');
  const withAnswers = await app.inject({ method: 'POST', url: '/v1/projects/from-ceo', headers: auth, payload: { ceoProject: fixture(20170), ceoPlots: nepalPlots, ceoAnswers: answers } });
  check('a project with its answers', withAnswers.statusCode === 201 && withAnswers.json().records === 5, withAnswers.body.slice(0, 300));
  const nepal = withAnswers.json().projectId as string;
  const records = await store.listRecords(nepal);
  check('five records, two collectors', records.length === 5 && new Set(records.map((r) => r.operator)).size === 2, records.map((r) => [r.recordKey, r.operator]));
  check('received when CEO saved them', records.every((r) => r.receivedAt === r.modifiedOn), records.map((r) => [r.receivedAt, r.modifiedOn]));
  const exported = await app.inject({ method: 'GET', url: `/v1/projects/${nepal}/export.csv`, headers: auth });
  check('the export holds the answers', exported.statusCode === 200 && exported.body.includes('logging road, near the river') && exported.body.includes('degradation'), exported.body.slice(0, 300));
  const progress = await app.inject({ method: 'GET', url: `/v1/projects/${nepal}/progress`, headers: auth });
  check('the progress counts them', progress.statusCode === 200, progress.body.slice(0, 200));
  check('and the two plot files', (await store.listCsvFiles(nepal)).map((f) => f.filename).sort().join() === 'ceo_20170_plots.csv,ceo_20170_plots_done.csv');

  const wrong = await app.inject({ method: 'POST', url: '/v1/projects/from-ceo', headers: auth, payload: { ceoProject: fixture(1), ceoPlots: plots } });
  check("another project's plots are refused", wrong.statusCode === 400, wrong.body);
  check('three projects, nothing half made', (await store.listMemberships(userId)).length === 3);
} finally {
  await app.close();
}

console.log(failures === 0 ? 'all passed' : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
