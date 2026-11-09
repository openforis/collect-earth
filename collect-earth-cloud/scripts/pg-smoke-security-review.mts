// Smoke test of the security review's fixes (2026-11) on a THROWAWAY PostgreSQL (it drops and creates the
// database `cesecurity` and the role `ce_security_app`), as the app role under Row-Level Security:
// isAccountUsername for live and retired names; renameRecordOperator never deletes a row;
// two admins demoting or removing each other at once leave one (PROJECT_ADMINS_LOCK); the AI token
// ledger (migration 034) keeps a person's month when the project is deleted.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55487:5432 postgres:16
//   npm run smoke:pg:security -- 55487        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import type { AiRunWindow } from '../src/types.js';

const port = process.argv[2] ?? '55487';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://cesecown:pw@${host}/cesecurity`;
const appUrl = `postgres://ce_security_app:apppw@${host}/cesecurity`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: superUrl });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS cesecurity');
await sup.query('DROP ROLE IF EXISTS ce_security_app');
await sup.query("DO $$ BEGIN CREATE ROLE cesecown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cesecurity OWNER cesecown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const own = new pg.Client({ connectionString: ownerUrl });
await own.connect();
const store = new PostgresStore(appUrl, { statementTimeoutMs: 60_000 });

const ana = await store.createUser({ username: 'ana', passwordHash: 'x', email: null });

// --- account usernames ---
await store.createUser({ username: 'gone', passwordHash: 'x', email: null });
await own.query("INSERT INTO retired_usernames (username) VALUES ('retired-one')");
check('isAccountUsername: a live account, any case', (await store.isAccountUsername('ana')) && (await store.isAccountUsername('ANA')));
check('isAccountUsername: a retired name', await store.isAccountUsername('retired-one'));
check('isAccountUsername: a free text name is none', !(await store.isAccountUsername('Juan Perez')));
check('isAccountUsername: gone exists until deleted', await store.isAccountUsername('gone'));

// --- records ---
const p = await store.createProject({ name: 'P' });
const row = (operator: string, xml: string, modifiedOn: number) => ({
  projectId: p.projectId, recordKey: '7', operator, modifiedOn, receivedAt: modifiedOn, activelySaved: true, step: 1, xml, summary: {}, deleted: false, deletedOn: null,
});
await store.putRecord(row('Juan Perez', '<legacy/>', 1000));
check('a legacy row moves to the username when it has none', await store.renameRecordOperator(p.projectId, '7', 'Juan Perez', 'juan'));
await store.putRecord(row('Juan Perez', '<legacy-2/>', 3000));
check('a legacy row is kept when the username has the record: false', !(await store.renameRecordOperator(p.projectId, '7', 'Juan Perez', 'juan')));
const rows = (await store.listRecords(p.projectId, true)).map((r) => `${r.operator}:${r.xml}`).sort();
check('both rows are kept, none deleted', JSON.stringify(rows) === JSON.stringify(['juan:<legacy/>', 'Juan Perez:<legacy-2/>'].sort()), rows);

// --- the last admin, under concurrency ---
for (const how of ['demote', 'remove'] as const) {
  const q = await store.createProject({ name: `Q ${how}` });
  const a = await store.createUser({ username: `a-${how}`, passwordHash: 'x', email: null });
  const b = await store.createUser({ username: `b-${how}`, passwordHash: 'x', email: null });
  await store.addMembership(q.projectId, a.id, 'admin');
  await store.addMembership(q.projectId, b.id, 'admin');
  const act = (id: string) => (how === 'demote' ? store.setMemberRole(q.projectId, id, 'operator') : store.removeMember(q.projectId, id));
  const results = await Promise.all([act(a.id), act(b.id)]);
  check(`two admins (${how}) each other at once: one done, one refused, one admin left`,
    results.filter((r) => r === 'ok').length === 1 && results.includes('last_admin') && (await store.countAdmins(q.projectId)) === 1, results);
}

// --- the AI token ledger ---
const now = Date.UTC(2026, 10, 9, 12);
const w = (monthlyTokens: number): AiRunWindow => ({
  now, staleBefore: now - 3_600_000, dayStart: Date.UTC(2026, 10, 9), monthStart: Date.UTC(2026, 10, 1), reportsPerDay: 50, followUpsPerDay: 50, monthlyTokens,
});
const coord = await store.createUser({ username: 'coord', passwordHash: 'x', email: null });
const first = await store.createProject({ name: 'First' });
await store.addMembership(first.projectId, coord.id, 'admin');
const started = await store.startAiRun(first.projectId, { kind: 'report', startedBy: coord.id, model: 'm' }, w(1000));
check('a run starts', started.ok, started);
if (started.ok) {
  await store.finishAiRun(first.projectId, started.run.id, {
    status: 'failed', finishedAt: now, inputTokens: 900, outputTokens: 200, toolCalls: [], result: null, error: 'x', errorCode: 'x',
  });
}
const ledger = (await own.query('SELECT month::text, tokens FROM ai_token_ledger WHERE user_id = $1', [coord.id])).rows;
check('its tokens go to the ledger, by UTC month', ledger.length === 1 && ledger[0].month === '2026-11-01' && Number(ledger[0].tokens) === 1100, ledger);
await store.deleteProject(first.projectId);
check('the ledger stays when the project is deleted', Number((await own.query('SELECT tokens FROM ai_token_ledger WHERE user_id = $1', [coord.id])).rows[0]?.tokens) === 1100);
const fresh = await store.createProject({ name: 'Fresh' });
await store.addMembership(fresh.projectId, coord.id, 'admin');
const again = await store.startAiRun(fresh.projectId, { kind: 'report', startedBy: coord.id, model: 'm' }, w(1000));
check('a new project does not start a fresh month', !again.ok && again.limit === 'monthly', again);
const second = await store.createProject({ name: 'Second' });
await store.addMembership(second.projectId, coord.id, 'admin');
const allowed = await store.startAiRun(fresh.projectId, { kind: 'report', startedBy: coord.id, model: 'm' }, w(1000));
check('two projects coordinated: twice the allowance', allowed.ok, allowed);

await own.end();
await store.close();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
