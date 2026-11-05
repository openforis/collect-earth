// Smoke test of the analysis page's server side on a THROWAWAY PostgreSQL (it drops and creates the database
// `ceanalysis` and the role `ce_analysis_app`): migration 027 (projects.analysis_views), GET /analysis as the app role,
// and the views shared with the team through the routes, kept apart between two projects by RLS.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npx tsx scripts/pg-smoke-analysis.mts 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { demoCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const ownerUrl = `postgres://ceown:pw@${host}/ceanalysis`;
const appUrl = `postgres://ce_analysis_app:apppw@${host}/ceanalysis`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: `postgres://postgres:pw@${host}/postgres` });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS ceanalysis');
await sup.query('DROP ROLE IF EXISTS ce_analysis_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceanalysis OWNER ceown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const column = (await owner.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'analysis_views'")).rows[0];
check('027: projects.analysis_views (twice, idempotent)', column?.data_type === 'jsonb', column);
await owner.end();

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0 } as any, webDir: null });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
const ownerToken = res.json().token as string;
const project = async (name: string) => (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name } })).json().projectId as string;
const a = await project('Alpha');
const b = await project('Beta');
const call = (method: any, pid: string, path: string, payload?: unknown, headers: Record<string, string> = {}, token = ownerToken) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as any });
const inv = await call('POST', a, '/invites', { role: 'operator', maxUses: 1 });
const maria = (await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'maria', password: 'password12', inviteToken: inv.json().inviteToken } })).json().token as string;

check('CEP', (await call('PUT', a, '/cep', demoCep(), { 'content-type': 'application/zip' })).statusCode === 200);
await batchRequest(app, a, maria, [
  envelope({ recordKey: '1,1', operator: 'maria', summary: { collect_text_id: '1', collect_code_land_use_category: 'F', 'collect_entity_land_cover[trees].integer_percentage': '40' } }),
  envelope({ recordKey: '2,1', operator: 'maria', summary: { collect_text_id: '2', collect_code_land_use_category: 'C' } }),
]);
res = await call('GET', a, '/analysis');
const body = res.json();
check('GET /analysis as the app role', res.statusCode === 200 && body.tables[0].rows === 2 && body.tables[1].rows === 1, { status: res.statusCode, rows: body.tables?.map((t: any) => t.rows) });

const view = { name: 'Land use', table: 'plot', language: 'en', config: { plugin: 'Y Bar', group_by: ['Land Use 2025'] } };
check('PUT a shared view', (await call('PUT', a, '/analysis/views', view)).statusCode === 200);
const seen = (await call('GET', a, '/analysis/views', undefined, {}, maria)).json().views;
check('the collector sees it, as saved', seen.length === 1 && seen[0].config.plugin === 'Y Bar' && seen[0].savedBy === 'owner', seen);
check("the other project's views are its own", (await call('GET', b, '/analysis/views')).json().views.length === 0);
check('DELETE it', (await call('DELETE', a, '/analysis/views?name=Land%20use&table=plot')).json().views.length === 0);

await app.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
