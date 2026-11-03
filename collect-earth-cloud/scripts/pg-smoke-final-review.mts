// Smoke test of the final review's server fixes (Task 22) on a THROWAWAY PostgreSQL (it drops and
// creates the database `cefinal` and the role `ce_final_app`): migrations skipped when applied and
// unchanged (024's checksums), an edited file run again, a database from before 024 migrated whole;
// 015's guard widening an older constraint that already had decision.bulk; lock_timeout with a busy
// table (the run tried again once the table is free); listRecordsByKeys filtered by operator under
// RLS; removeMember and putCsvFile waiting for the sampling lock; a draw's transaction with its
// statement and idle timeouts; eachProject with the store's statement timeout.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55486:5432 postgres:16
//   npm run smoke:pg:final -- 55486        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { readMigrations, runMigrations } from '../src/store/migrate.js';

const port = process.argv[2] ?? '55486';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cefinal`;
const appUrl = `postgres://ce_final_app:apppw@${host}/cefinal`;
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
await sup.query('DROP DATABASE IF EXISTS cefinal');
await sup.query('DROP ROLE IF EXISTS ce_final_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cefinal OWNER ceown');
await sup.end();

const files = readMigrations();
const migrate = async () => {
  const logged: string[] = [];
  await runMigrations(ownerUrl, (m) => logged.push(m), { appDatabaseUrl: appUrl, pauseMs: () => 200 });
  return logged;
};
const ran = (logged: string[]) => logged.filter((m) => m.startsWith('Migration ')).map((m) => m.split(' ')[1]);

let logged = await migrate();
check(`a new database: every file runs (${files.length})`, ran(logged).length === files.length, logged);
const own = new pg.Client({ connectionString: ownerUrl });
await own.connect();
const recorded = (await own.query('SELECT name, checksum FROM schema_migrations ORDER BY name')).rows;
check('each file recorded with its sha256', recorded.length === files.length && recorded.every((r, i) => r.name === files[i].name && r.checksum === files[i].checksum), recorded.slice(0, 3));
logged = await migrate();
check('again: nothing runs, all skipped', ran(logged).length === 0 && logged.some((m) => m.includes(`${files.length} already applied`)), logged);

// An edited file (here: recorded with another checksum) runs again, alone.
await own.query("UPDATE schema_migrations SET checksum = 'old' WHERE name = '015_decision_bulk.sql'");
logged = await migrate();
check('an edited file runs again, alone, and is recorded with its new checksum', JSON.stringify(ran(logged)) === JSON.stringify(['015_decision_bulk.sql']) && (await own.query("SELECT checksum FROM schema_migrations WHERE name = '015_decision_bulk.sql'")).rows[0].checksum === files.find((f) => f.name === '015_decision_bulk.sql')!.checksum, logged);

// 015's guard (B7): an older constraint with decision.bulk but not the link actions is widened.
await own.query('ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check');
await own.query(`ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'invite.created', 'invite.revoked', 'member.removed', 'member.role', 'cep.replaced', 'csv.uploaded', 'assignments.set',
  'division.applied', 'plots.moved', 'decision.set', 'decision.deleted', 'decision.bulk', 'settings.changed',
  'export.downloaded', 'survey.replaced', 'sampling.drawn', 'reference.changed'))`);
await own.query("UPDATE schema_migrations SET checksum = 'old' WHERE name = '015_decision_bulk.sql'");
await migrate();
const def = (await own.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'audit_log_action_check'")).rows[0].d as string;
check("015 widens a constraint that had decision.bulk but not link.created / link.revoked", def.includes("'link.created'") && def.includes("'link.revoked'") && def.includes("'decision.bulk'"), def);
// And leaves a constraint that has every action alone (its oid stays).
const oid = (await own.query("SELECT oid FROM pg_constraint WHERE conname = 'audit_log_action_check'")).rows[0].oid;
await own.query("UPDATE schema_migrations SET checksum = 'old' WHERE name = '015_decision_bulk.sql'");
await migrate();
check('015 run again on a complete constraint changes nothing', (await own.query("SELECT oid FROM pg_constraint WHERE conname = 'audit_log_action_check'")).rows[0].oid === oid);

// A database from before 024 (no checksum column): every file runs, then they are recorded.
await own.query('ALTER TABLE schema_migrations DROP COLUMN checksum');
logged = await migrate();
check('before 024: every file runs, the checksums recorded after', ran(logged).length === files.length && (await own.query('SELECT count(*)::int AS n FROM schema_migrations WHERE checksum IS NOT NULL')).rows[0].n === files.length, logged.slice(-3));

// lock_timeout (B4): a table held by a long transaction; the run waits 3 s, is tried again, and goes through once it is free.
await own.query("UPDATE schema_migrations SET checksum = 'old' WHERE name = '001_init.sql'");
const blocker = new pg.Client({ connectionString: ownerUrl });
await blocker.connect();
await blocker.query('BEGIN');
await blocker.query('LOCK TABLE projects IN ACCESS EXCLUSIVE MODE');
const t0 = performance.now();
const released = sleep(4000).then(() => blocker.query('COMMIT'));
logged = await migrate();
await released;
await blocker.end();
const ms = performance.now() - t0;
check(`a busy table: lock_timeout, tried again, done once free (${Math.round(ms)} ms)`, logged.some((m) => m.includes('lock_timeout')) && ran(logged).includes('001_init.sql') && ms >= 3000 && ms < 15000, logged);

// The app role (RLS), two projects.
const store = new PostgresStore(appUrl, { statementTimeoutMs: 60_000 });
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const a = await store.createProject({ name: 'A' });
const b = await store.createProject({ name: 'B' });
const row = (projectId: string, recordKey: string, operator: string) => ({
  projectId, recordKey, operator, modifiedOn: 1000, receivedAt: 1000, activelySaved: true, step: 1, xml: '<r/>', summary: { k: operator }, deleted: false, deletedOn: null,
});
for (const [k, o] of [['1', 'ana'], ['1', 'ben'], ['2', 'ana']] as const) await store.putRecord(row(a.projectId, k, o));
await store.putRecord(row(b.projectId, '1', 'ana'));
const anas = await store.listRecordsByKeys(a.projectId, ['1', '2'], 'ana');
const all = await store.listRecordsByKeys(a.projectId, ['1', '2']);
check('listRecordsByKeys with an operator: only theirs, only this project', anas.length === 2 && anas.every((r) => r.operator === 'ana' && r.projectId === a.projectId) && all.length === 3, { anas: anas.length, all: all.length });

// removeMember and putCsvFile wait for the sampling lock (a draw holding it).
const holder = new pg.Client({ connectionString: ownerUrl });
await holder.connect();
const user = await store.createUser({ username: 'carla', passwordHash: 'x', email: null });
await store.addMembership(a.projectId, user.id, 'operator');
for (const [what, run] of [
  ['removeMember', () => store.removeMember(a.projectId, user.id)],
  ['putCsvFile', () => store.putCsvFile(a.projectId, 'p.csv', Buffer.from('id\n1\n'), ['1'])],
] as const) {
  await holder.query('BEGIN');
  await holder.query("SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:sampling:' || $1))", [a.projectId]);
  const start = performance.now();
  const free = sleep(800).then(() => holder.query('COMMIT'));
  await run();
  await free;
  const waited = performance.now() - start;
  check(`${what} waits for the sampling lock (${Math.round(waited)} ms)`, waited >= 700, waited);
}
await holder.end();

// A draw's transaction (B5): its statement and idle timeouts are set (valid settings), the draw stored.
const draw = { at: Date.now(), byUserId: null, automatic: false, drawn: 0, firstN: 0, percent: 0, noChecker: 0 };
let drew = true;
try {
  await store.addSampledCopies(a.projectId, [], [], draw, Date.now());
} catch (err) {
  drew = false;
  console.log(err);
}
check("a draw's transaction runs with its timeouts", drew);

// eachProject with the store's statement timeout (M-6).
let usage: unknown = null;
try {
  usage = await store.aiUsageSince(0);
} catch (err) {
  usage = err;
}
check('eachProject (AI usage) runs with the statement timeout', Array.isArray(usage), usage);

await own.end();
await store.close();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
