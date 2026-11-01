// Smoke test of the activity data (migration 012: record_events, member_activity,
// audit_log) on a THROWAWAY PostgreSQL (it drops and creates the database `ceact` and
// the roles `ceown` and `ce_act_app`): the backfill (once, as on a database that ran
// 001-011 with records), the server as a NOSUPERUSER NOBYPASSRLS app role through the
// routes, the store's reads, uploads of one record at once, removeMember / deleteUser /
// deleteProject cleaning the new tables, and with a forged project id, as the app role,
// no other project's rows read or written.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';
import { idOnlyCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/ceact`;
const appUrl = `postgres://ce_act_app:apppw@${host}/ceact`;
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
await sup.query('DROP DATABASE IF EXISTS ceact');
await sup.query('DROP ROLE IF EXISTS ce_act_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceact OWNER ceown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();

// --- The backfill: a database as 001-011 left it, with records of two projects. ---
await owner.query('DROP TABLE record_events');
const old = (await owner.query(
  "INSERT INTO projects (id, name) VALUES (gen_random_uuid(), 'Old one'), (gen_random_uuid(), 'Old two') RETURNING id",
)).rows.map((r) => r.id as string);
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on) VALUES
   ($1, '1', 'maria', to_timestamp(1000), to_timestamp(2000), true,  1, '<r/>', '{"a":"1"}', false, NULL),
   ($1, '2', 'maria', to_timestamp(1100), to_timestamp(2000), false, 1, '<r/>', '{"a":"2"}', false, NULL),
   ($1, '3', 'jose',  to_timestamp(1200), to_timestamp(2000), true,  1, '<r/>', '{"a":"3"}', true,  to_timestamp(1200)),
   ($2, '1', 'ana',   to_timestamp(1300), to_timestamp(2000), true,  1, '<r/>', '{"a":"4"}', false, NULL)`,
  old,
);
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const backfilled = (await owner.query(
  'SELECT project_id, record_key, operator, extract(epoch FROM modified_on)::int AS at, change, summary FROM record_events ORDER BY project_id, record_key',
)).rows;
const want = (p: string, key: string, op: string, at: number, change: string, summary: unknown) => ({ project_id: p, record_key: key, operator: op, at, change, summary });
const expected = [
  want(old[0], '1', 'maria', 1000, 'submitted', { a: '1' }),
  want(old[0], '2', 'maria', 1100, 'created', null),
  want(old[0], '3', 'jose', 1200, 'deleted', null),
  want(old[1], '1', 'ana', 1300, 'submitted', { a: '4' }),
].sort((x, y) => (x.project_id < y.project_id ? -1 : x.project_id > y.project_id ? 1 : x.record_key < y.record_key ? -1 : 1));
check('the backfill: one event per record, at its modified_on, with its change', JSON.stringify(backfilled) === JSON.stringify(expected), backfilled);
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
check('migrations again: no second backfill', (await owner.query('SELECT count(*)::int AS n FROM record_events')).rows[0].n === 4);
const grants = (await owner.query(
  "SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants WHERE grantee = 'ce_act_app' AND table_name IN ('record_events', 'member_activity', 'audit_log') GROUP BY table_name ORDER BY table_name",
)).rows;
check('the app role may use the new tables (and their sequences)', grants.length === 3 && grants.every((g) => g.p === 'DELETE,INSERT,SELECT,UPDATE'), grants);
const seq = (await owner.query("SELECT has_sequence_privilege('ce_act_app', 'audit_log_id_seq', 'USAGE') AND has_sequence_privilege('ce_act_app', 'record_events_id_seq', 'USAGE') AS ok")).rows[0];
check('... and their id sequences', seq.ok === true);

// --- The server as the app role. ---
const store = new PostgresStore(appUrl);
const rls = await store.rowLevelSecurity();
check('RLS binds the app role', rls.enforced, rls);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0 } as any,
  webDir: null,
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
const call = (method: any, pid: string, path: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(ownerToken), ...headers }, payload: payload as any });
async function join(pid: string, username: string) {
  const inv = await call('POST', pid, '/invites', { role: 'operator', maxUses: 1 });
  const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: inv.json().inviteToken } });
  if (r.statusCode !== 201) {
    const l = await app.inject({ method: 'POST', url: `/v1/auth/login`, payload: { username, password: 'password12' } });
    await app.inject({ method: 'POST', url: `/v1/join/${inv.json().inviteToken}/accept`, headers: bearer(l.json().token) });
    return { token: l.json().token as string, userId: l.json().userId as string };
  }
  return { token: r.json().token as string, userId: r.json().userId as string };
}
const maria = await join(a, 'maria');
const jose = await join(a, 'jose');
const pedro = await join(b, 'pedro');

check('CEP', (await call('PUT', a, '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode === 200);
res = await call('PUT', a, '/csv-files/plots.csv', 'id,lat,lon\n1,0,0\n2,0,0\n3,0,0\n4,0,0\n', { 'content-type': 'text/csv' });
check('plot file', res.statusCode === 201, res.body);
const fileId = res.json().id as string;
check('assignments', (await call('PUT', a, '/assignments', { assignments: [{ userId: maria.userId, csvFileId: fileId }] })).statusCode === 200);
const ua = { 'user-agent': 'CollectEarth/1.22.0 (smoke)' };
const as = (t: string, path: string) => app.inject({ method: 'GET', url: `/v1/projects/${a}${path}`, headers: { ...bearer(t), ...ua } });
check('maria: CEP', (await as(maria.token, '/cep')).statusCode === 200);
check('maria: my-assignment', (await as(maria.token, '/my-assignment')).statusCode === 200);
check('maria: plot file', (await as(maria.token, `/csv-files/${fileId}/content`)).statusCode === 200);
const sync = (t: string, pid: string, envs: any[]) => batchRequest(app, pid, t, envs);
await sync(maria.token, a, [envelope({ recordKey: '1', modifiedOn: 1000, activelySaved: false })]);
await sync(maria.token, a, [envelope({ recordKey: '1', modifiedOn: 2000, activelySaved: false })]);
await sync(maria.token, a, [envelope({ recordKey: '1', modifiedOn: 3000, activelySaved: true, summary: { q: 'final' } })]);
await sync(maria.token, a, [envelope({ recordKey: '1', modifiedOn: 4000, activelySaved: false })]);
await sync(maria.token, a, [envelope({ recordKey: '1', modifiedOn: 4200, activelySaved: true, summary: { q: 'again' } })]);
await sync(maria.token, a, [envelope({ recordKey: '1', modifiedOn: 5000, deleted: true })]);
res = await sync(maria.token, a, [envelope({ recordKey: '1', modifiedOn: 4500 }), envelope({ recordKey: '2', modifiedOn: 6000 }), envelope({ recordKey: '2', modifiedOn: 6000 })]);
check('a stale upload is refused', res.json().results[0].status === 'stale', res.body);
await sync(pedro.token, b, [envelope({ recordKey: '1', modifiedOn: 7000 })]);
const evs = await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 100 });
check(
  'record events through the routes (newest first; no stale, no re-send)',
  JSON.stringify(evs.map((e) => [e.recordKey, e.change, e.modifiedOn])) ===
    JSON.stringify([['2', 'submitted', 6000], ['1', 'deleted', 5000], ['1', 'resubmitted', 4200], ['1', 'unsubmitted', 4000], ['1', 'submitted', 3000], ['1', 'updated', 2000], ['1', 'created', 1000]]),
  evs.map((e) => [e.recordKey, e.change, e.modifiedOn]),
);
check(
  'the answers only on (re)submitted',
  evs.filter((e) => e.summary !== null).map((e) => e.change).join() === 'submitted,resubmitted,submitted' && evs[4].summary?.q === 'final' && evs[2].summary?.q === 'again',
  evs,
);
const p1 = await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 2 });
const p2 = await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 10, before: { at: p1[1].modifiedOn, id: p1[1].id } });
check('paged by cursor', p1.length === 2 && p2.length === 5 && p2[0].modifiedOn === 4200, { p1, p2 });
let refused = false;
try {
  await store.listRecordEvents(a, { from: 0, to: 1, limit: 1, before: { at: 1, id: 'x' } });
} catch (err) {
  refused = (err as Error).name === 'InvalidCursorError';
}
check('a cursor that is no cursor is refused', refused);
check('by operator and window', (await store.listRecordEvents(a, { from: 2000, to: 4000, operator: 'maria', limit: 10 })).length === 2);
check("B's events are B's", (await store.listRecordEvents(b, { from: 0, to: 10_000, limit: 10 })).map((e) => e.operator).join() === 'pedro');

await app.activity.flush();
const act = await store.listMemberActivity(a);
const m = act.find((x) => x.userId === maria.userId);
check(
  "maria's activity: syncs, records, downloads, the desktop's agent",
  !!m && m.syncsCount === 7 && m.recordsReceived === 8 && m.lastCepDownloadAt !== null && m.lastPlotsDownloadAt !== null && m.lastSyncAt !== null && m.clientAgent === 'CollectEarth/1.22.0 (smoke)' /* only Collect Earth's agent is kept (Task 21): batchRequest's inject default agent is not */,
  act,
);
await store.touchMemberActivity(a, maria.userId, { lastSeenAt: 1, syncs: 1, recordsReceived: 1, clientAgent: 'later' });
const m2 = (await store.listMemberActivity(a)).find((x) => x.userId === maria.userId)!;
check('an older time does not go back; counters add; the agent is replaced', m2.lastSeenAt === m!.lastSeenAt && m2.syncsCount === 8 && m2.clientAgent === 'later', m2);
await store.touchMemberActivity(b, maria.userId, { lastSeenAt: 1 });
check('no activity for a non-member', (await store.listMemberActivity(b)).every((x) => x.userId !== maria.userId));

// Uploads of one save at once (a retried batch racing the first): one event.
const race = envelope({ recordKey: 'race', modifiedOn: 8000 });
const raceRes = await Promise.all([sync(maria.token, a, [race]), sync(maria.token, a, [race]), sync(maria.token, a, [race])]);
check('three racing uploads of one save: all stored', raceRes.every((r) => r.json().results[0].status === 'stored'), raceRes.map((r) => r.body));
const raced = (await store.listRecordEvents(a, { from: 7999, to: 8001, limit: 10 })).filter((e) => e.recordKey === 'race');
check('... and logged once, as one submission', raced.length === 1 && raced[0].change === 'submitted', raced);

// The first write of the minute is in the request: no flush needed.
const lucia = await join(a, 'lucia');
await app.inject({ method: 'GET', url: `/v1/projects/${a}/my-quality`, headers: bearer(lucia.token) });
check("a member's first call is written before the answer", (await store.listMemberActivity(a)).some((x) => x.userId === lucia.userId));

// Audit through the routes.
check('decision', (await call('PUT', a, '/quality/decisions/1', { decision: 'first', comment: 'secret words' })).statusCode === 200);
check('decision deleted', (await call('DELETE', a, '/quality/decisions/1')).statusCode === 204);
check('rename', (await call('PATCH', a, '', { name: 'Alpha 2' })).statusCode === 200);
check('export', (await call('GET', a, '/export.csv')).statusCode === 200);
check('role', (await call('PUT', a, `/members/${jose.userId}`, { role: 'reviewer' })).statusCode === 200);
check('survey', (await call('PUT', a, '/survey', { surveyUri: 'http://x', idmlBase64: 'eA==' })).statusCode === 200);
const log = await store.listAudit(a, { limit: 100 });
check(
  'the audit log, newest first, by the owner',
  JSON.stringify(log.slice(0, 6).map((e) => e.action)) === JSON.stringify(['survey.replaced', 'member.role', 'export.downloaded', 'settings.changed', 'decision.deleted', 'decision.set']) &&
    log.every((e) => e.actorUserId === ownerId && e.actor === 'owner'),
  log,
);
check('no comment in the log', !JSON.stringify(log).includes('secret words'));
const invites = await store.listAudit(a, { limit: 100, action: 'invite.created' });
check('filtered by action; invites logged with their id', invites.length === 3 && invites.every((e) => typeof e.details.inviteId === 'string'), invites);
check('filtered by actor', (await store.listAudit(a, { limit: 100, actor: maria.userId })).length === 0 && (await store.listAudit(a, { limit: 100, actor: 'nope' })).length === 0);
const l1 = await store.listAudit(a, { limit: 1 });
const l2 = await store.listAudit(a, { limit: 1, before: { at: l1[0].at, id: l1[0].id } });
check('audit paged by cursor', l2[0]?.action === 'member.role', l2);

// removeMember and deleteUser.
await store.appendAudit(a, { actorUserId: jose.userId, action: 'cep.replaced', details: { bytes: 1 } });
await app.inject({ method: 'GET', url: `/v1/projects/${a}/my-quality`, headers: bearer(jose.token) });
await app.activity.flush();
check('jose has activity', (await store.listMemberActivity(a)).some((x) => x.userId === jose.userId));
check('remove jose', (await call('DELETE', a, `/members/${jose.userId}`)).statusCode === 204);
check("jose's activity gone", (await store.listMemberActivity(a)).every((x) => x.userId !== jose.userId));
check("jose's audit entry stays, with no actor", (await store.listAudit(a, { limit: 100, action: 'cep.replaced' })).some((e) => e.actorUserId === null && e.details.bytes === 1));
await store.appendAudit(a, { actorUserId: maria.userId, action: 'cep.replaced', details: { bytes: 2 } });
await store.deleteUser(maria.userId);
check("deleted maria: activity gone", (await store.listMemberActivity(a)).every((x) => x.userId !== maria.userId));
check("deleted maria: audit entry stays with no actor", (await store.listAudit(a, { limit: 100, action: 'cep.replaced' })).some((e) => e.actorUserId === null && e.details.bytes === 2));
check("deleted maria: her records' events stay", (await store.listRecordEvents(a, { from: 0, to: 10_000, limit: 100 })).filter((e) => e.operator === 'maria').length === 8);

// Forged project ids, as the app role, with the setting on A; and with ''.
await owner.query("INSERT INTO audit_log (project_id, action) VALUES ($1, 'cep.replaced')", [b]);
const c = new pg.Client({ connectionString: appUrl });
await c.connect();
await c.query('BEGIN');
await c.query("SELECT set_config('app.current_project', $1, true)", [a]);
for (const t of ['record_events', 'member_activity', 'audit_log']) {
  const seen = (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [b])).rows[0].n;
  const upd = (await c.query(`UPDATE ${t} SET project_id = project_id WHERE project_id = $1`, [b])).rowCount;
  const del = (await c.query(`DELETE FROM ${t} WHERE project_id = $1`, [b])).rowCount;
  const all = (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  const ownRows = (await owner.query(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [a])).rows[0].n;
  check(`${t}: B's rows not seen, updated or deleted with A set (sees only A's: ${all})`, seen === 0 && upd === 0 && del === 0 && all === ownRows, { seen, upd, del, all, ownRows });
}
for (const [t, sql, params] of [
  ['record_events', "INSERT INTO record_events (project_id, record_key, modified_on, received_at, change) VALUES ($1, 'x', now(), now(), 'created')", [b]],
  ['member_activity', 'INSERT INTO member_activity (project_id, user_id) VALUES ($1, $2)', [b, pedro.userId]],
  ['audit_log', "INSERT INTO audit_log (project_id, action) VALUES ($1, 'cep.replaced')", [b]],
  ['audit_log (moved)', 'UPDATE audit_log SET project_id = $1 WHERE project_id = $2', [b, a]],
] as const) {
  await c.query('SAVEPOINT s');
  let refused = false;
  try {
    await c.query(sql, params as any);
  } catch (err) {
    refused = /row-level security/.test((err as Error).message);
  }
  await c.query('ROLLBACK TO SAVEPOINT s');
  check(`${t}: a row for another project is refused`, refused);
}
await c.query('COMMIT');
// After a transaction-local setting the pooled connection holds '': no project, no error.
for (const t of ['record_events', 'member_activity', 'audit_log']) {
  let n = -1;
  try {
    n = (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  } catch (err) {
    n = -2;
  }
  check(`${t}: with '' set, no rows and no error`, n === 0, n);
}
await c.end();

// deleteProject.
const before = (await owner.query('SELECT (SELECT count(*) FROM record_events WHERE project_id = $1)::int AS e, (SELECT count(*) FROM audit_log WHERE project_id = $1)::int AS l, (SELECT count(*) FROM member_activity WHERE project_id = $1)::int AS m', [a])).rows[0];
check('A has events, activity and audit', before.e > 0 && before.l > 0 && before.m > 0, before);
res = await app.inject({ method: 'DELETE', url: `/v1/projects/${b}`, headers: bearer(ownerToken), payload: { confirmName: 'Beta' } });
check('delete project B (as the app role)', res.statusCode === 204, `${res.statusCode} ${res.body}`);
const left = (await owner.query('SELECT (SELECT count(*) FROM record_events WHERE project_id = $1)::int AS e, (SELECT count(*) FROM audit_log WHERE project_id = $1)::int AS l, (SELECT count(*) FROM member_activity WHERE project_id = $1)::int AS m', [b])).rows[0];
check("B's activity data gone", left.e === 0 && left.l === 0 && left.m === 0, left);
const still = (await owner.query('SELECT (SELECT count(*) FROM record_events WHERE project_id = $1)::int AS e, (SELECT count(*) FROM audit_log WHERE project_id = $1)::int AS l', [a])).rows[0];
check("A's untouched", still.e === before.e && still.l === before.l, still);

await app.close();
await store.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
