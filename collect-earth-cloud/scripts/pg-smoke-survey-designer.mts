// Smoke test of the survey designer's changes (docs/plans/2026-11-18-survey-designer.md, stage 2, migration 048) on a
// THROWAWAY PostgreSQL (it drops and creates the database `cesurvey` and the role `ce_survey_app`): the migrations
// twice, the server as a NOSUPERUSER NOBYPASSRLS app role, a label changed (both project files), the versions kept
// (gzipped, the last 20 only), a restore, an upload forgetting them, the activity log's survey.edited, RLS between two
// projects.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:survey-designer -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { strFromU8, unzipSync } from 'fflate';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { demoCep } from '../test/fixtures/cep.js';
import { SURVEY_VERSIONS_KEPT } from '../src/types.js';
import { createFakeClient } from '../src/ai/fake.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cesurvey`;
const appUrl = `postgres://ce_survey_app:apppw@${host}/cesurvey`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: superUrl });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS cesurvey');
await sup.query('DROP ROLE IF EXISTS ce_survey_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cesurvey OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const rls = (await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'survey_versions'")).rows[0];
check('048 (twice): survey_versions under RLS', rls?.relrowsecurity === true, rls);

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0, stateStaleMs: 0, qualityMinIntervalMs: 0, aiConfigured: true, aiVertexApiKey: 'x' } as any,
  webDir: null,
  ai: { client: createFakeClient() },
} as any);
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
const ownerToken = res.json().token as string;
const project = async (name: string) =>
  (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name } })).json().projectId as string;
const a = await project('Alpha');
const b = await project('Beta');
const call = (method: any, pid: string, path: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(ownerToken), ...headers }, payload: payload as any });
for (const pid of [a, b]) {
  res = await call('PUT', pid, '/cep', demoCep(), { 'content-type': 'application/zip' });
  check(`project file uploaded (${pid === a ? 'A' : 'B'})`, res.statusCode < 300, res.body);
}

const design = async (pid: string) => (await call('GET', pid, '/survey/design')).json();
const first = await design(a);
const question = first.design.pages.flatMap((p: any) => p.items).find((i: any) => i.kind === 'question');
const language = first.design.languages[0];
res = await call('POST', a, '/survey/design', { revision: first.revision, operations: [{ op: 'setText', target: { kind: 'node', id: question.id }, part: 'label', language, text: 'Changed in the designer' }] });
check('a label changed', res.statusCode === 200, res.body);
const surveyIn = (cep: Buffer | null) => (cep ? strFromU8(unzipSync(cep)['placemark.idm.xml']) : '');
check('in the served project file and the uploaded one', surveyIn(await store.getCep(a)).includes('Changed in the designer') && surveyIn(await store.getOriginalCep(a)).includes('Changed in the designer'));
let versions = (await call('GET', a, '/survey/versions')).json().versions;
check('one version kept, by the coordinator', versions.length === 1 && versions[0].by === 'owner' && versions[0].changes === 1, versions);
const stored = (await owner.query('SELECT octet_length(survey_gz) AS gz, octet_length(original_gz) AS ogz FROM survey_versions')).rows[0];
check('kept gzipped', stored && stored.gz > 0 && stored.gz < surveyIn(await store.getCep(a)).length / 3, stored);

// More saves than are kept
let revision = res.json().revision;
for (let i = 0; i < SURVEY_VERSIONS_KEPT + 3; i++) {
  res = await call('POST', a, '/survey/design', { revision, operations: [{ op: 'setText', target: { kind: 'title' }, part: 'label', language, text: `Title ${i}` }] });
  revision = res.json().revision;
}
versions = (await call('GET', a, '/survey/versions')).json().versions;
check(`the last ${SURVEY_VERSIONS_KEPT} kept, newest first, and the first`, versions.length === SURVEY_VERSIONS_KEPT + 1 && versions[0].createdAt >= versions[1].createdAt && versions[versions.length - 1].changes === 1, versions.length);

// Two saves made on the same survey at once: one is written, the other refused (replaceCep)
{
  const d = (await call('GET', a, '/survey/design')).json();
  const at = (text: string) => call('POST', a, '/survey/design', { revision: d.revision, operations: [{ op: 'setText', target: { kind: 'title' }, part: 'label', language, text }] });
  const codes = (await Promise.all([at('At once 1'), at('At once 2'), at('At once 3')])).map((r) => r.statusCode).sort();
  check('of three saves at once, one is written', JSON.stringify(codes) === JSON.stringify([200, 409, 409]), codes);
  revision = (await call('GET', a, '/survey/design')).json().revision;
}

// 050: the survey each record was made with
{
  const send = (key: string, surveyRevision: string | null) =>
    call('POST', a, '/records:batch', { records: [{ recordKey: key, surveyUri: 'x', operator: 'owner', modifiedOn: Date.now(), activelySaved: true, step: 1, xml: '<x/>', summary: {}, deleted: false, payloadVersion: 1, ...(surveyRevision ? { surveyRevision } : {}) }] });
  await call('PUT', a, '/status', { status: 'active' });
  const r1 = await send('101', 'aaaaaaaaaaaaaaaaaaaaaaaa');
  await send('102', revision);
  await send('103', null);
  const older = (await call('GET', a, '/survey/older')).json();
  check('050: plots of an earlier survey counted', older.plots === 1 && older.byRevision === 1, { older, status: r1.statusCode, body: r1.body.slice(0, 200) });
  const rows = (await owner.query('SELECT project_id, count(*)::int AS n FROM record_survey_revisions GROUP BY project_id')).rows;
  check('050: kept per project', rows.length === 1 && rows[0].project_id === a && rows[0].n === 2, rows);
  check("050: B reads none of A's", (await store.listRecordSurveyRevisions(b)).size === 0 && (await store.listRecordSurveyRevisions(a)).size === 2);
  const rlsOn = (await owner.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'record_survey_revisions'")).rows[0];
  check('050: row level security on', rlsOn?.relrowsecurity === true);
}

res = await call('POST', a, `/survey/versions/${versions[0].id}/restore`, { revision });
check('a restore brings the survey before back', res.statusCode === 200 && res.json().design.title[language] === `Title ${SURVEY_VERSIONS_KEPT + 1}`, res.body);

// RLS: project B sees none of A's, cannot restore one through its own path
check("B has no versions of A's", (await call('GET', b, '/survey/versions')).json().versions.length === 0);
res = await call('POST', b, `/survey/versions/${versions[1].id}/restore`, { revision: (await design(b)).revision });
check("B cannot restore A's version", res.statusCode === 404, res.body);
const crossRead = await store.getSurveyVersionData(b, versions[1].id);
check("the store does not read A's version from B", crossRead === null);

// Stage 4: a show-when from rows, saved (049: the assistant's help is a run of kind 'survey')
{
  const d = (await call('GET', a, '/survey/design')).json();
  const questions = d.design.pages.flatMap((p: any) => p.items).filter((i: any) => i.kind === 'question' && !i.fixed);
  const [target, other] = [questions[1], questions[0]];
  res = await call('POST', a, '/survey/design', { revision: d.revision, operations: [{ op: 'setShownWhen', id: target.id, when: { kind: 'all', parts: [{ question: other.name, test: 'answered', value: null }] } }] });
  check('a show-when from rows is saved', res.statusCode === 200, res.body);
  await app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(ownerToken), payload: { aiEnabled: true } });
  await call('PUT', a, '/ai', { enabled: true });
  res = await call('POST', a, '/survey/help', { task: 'suggest', language: 'en' });
  check('the survey help answers', res.statusCode === 200 && Array.isArray(res.json().suggestions), res.body);
  const kinds = (await owner.query('SELECT kind, status FROM ai_runs WHERE project_id = $1', [a])).rows;
  check('049: it is a run of kind survey, done', kinds.length === 1 && kinds[0].kind === 'survey' && kinds[0].status === 'done', kinds);
  check('not listed in the AI tab', (await call('GET', a, '/ai/runs')).json().runs.length === 0);
}

const log = (await call('GET', a, '/activity?kind=files')).json();
check('the activity log has survey.edited', JSON.stringify(log).includes('survey.edited'), Object.keys(log));

res = await call('PUT', a, '/cep', demoCep(), { 'content-type': 'application/zip' });
check('a new upload forgets the versions', res.statusCode < 300 && (await call('GET', a, '/survey/versions')).json().versions.length === 0);

res = await call('DELETE', b, '');
const left = (await owner.query('SELECT count(*)::int AS n FROM survey_versions WHERE project_id = $1', [b])).rows[0].n;
check('deleting a project deletes its versions', left === 0, { status: res.statusCode, left });

await owner.end();
await app.close();
await store.close();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
