// Smoke test of the batch intake on a THROWAWAY PostgreSQL (it drops and creates the database `cebatch` and the role
// `ce_batch_app`): putRecordsWithEvents stores the same rows and logs the same events as putRecordWithEvent one record
// at a time (duplicates in a batch, stale uploads, a draft then its submission, a resubmission, a deletion), and two
// batches of the same records in opposite orders at once neither deadlock nor lose an upload. Through the route too.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:batch -- 55481        (the superuser is postgres / pw on localhost)
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { applyLww, recordEventOf } from '../src/lww.js';
import type { RecordEnvelope } from '../src/types.js';
import type { RecordUpload } from '../src/store/store.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceown:pw@${host}/cebatch`;
const appUrl = `postgres://ce_batch_app:apppw@${host}/cebatch`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: superUrl });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS cebatch');
await sup.query('DROP ROLE IF EXISTS ce_batch_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cebatch OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });

const store = new PostgresStore(appUrl, { max: 10 });
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const projectA = (await store.createProject({ name: 'Batch A' })).projectId;
const projectB = (await store.createProject({ name: 'Batch B' })).projectId;

const envelope = (key: string, modifiedOn: number, over: Partial<RecordEnvelope> = {}): RecordEnvelope => ({
  recordKey: key, surveyUri: 'u', operator: 'ana', modifiedOn, activelySaved: true, step: 1, xml: `<plot>${key} ${modifiedOn}</plot>`,
  summary: { land: String(modifiedOn % 5) }, deleted: false, payloadVersion: 1, activeSeconds: 10, ...over,
});
const upload = (projectId: string, e: RecordEnvelope, receivedAt = 5_000_000): RecordUpload => ({
  recordKey: e.recordKey, operator: e.operator ?? '',
  apply: (existing, submittedBefore) => {
    const { row, status } = applyLww(e, existing, receivedAt);
    if (status !== 'stored') return null;
    const next = { ...row, projectId };
    return { row: next, event: recordEventOf(existing, next, submittedBefore) };
  },
});

// The same uploads, one project one record at a time, the other in batches
const rounds: RecordEnvelope[][] = [
  // drafts, a record twice (the later wins), one stale behind the other in the same batch
  [envelope('1', 100, { activelySaved: false }), envelope('2', 100), envelope('2', 200), envelope('3', 300), envelope('3', 250)],
  // a draft submitted, an older upload of 2 (stale), a resubmission of 3, a new record by another operator
  [envelope('1', 400), envelope('2', 150), envelope('3', 500, { summary: { land: 'changed' } }), envelope('4', 100, { operator: 'ben' })],
  // a deletion, then the same save sent again (nothing to store)
  [envelope('4', 600, { operator: 'ben', deleted: true, xml: null }), envelope('3', 500, { summary: { land: 'changed' } })],
];
const answersOne: boolean[][] = [];
const answersBatch: boolean[][] = [];
for (const round of rounds) {
  const one: boolean[] = [];
  for (const e of round) {
    const u = upload(projectA, e);
    one.push(await store.putRecordWithEvent(projectA, u.recordKey, u.operator, u.apply));
  }
  answersOne.push(one);
  answersBatch.push(await store.putRecordsWithEvents(projectB, round.map((e) => upload(projectB, e))));
}
check('the batch answers stored/stale as one record at a time does', JSON.stringify(answersOne) === JSON.stringify(answersBatch), { answersOne, answersBatch });

const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
const rowsOf = async (projectId: string) => (await owner.query(
  `SELECT record_key, operator, modified_on, actively_saved, step, xml, summary, deleted, active_seconds
     FROM records WHERE project_id = $1 ORDER BY record_key, operator`, [projectId])).rows;
const eventsOf = async (projectId: string) => (await owner.query(
  `SELECT record_key, operator, modified_on, actively_saved, deleted, change, summary
     FROM record_events WHERE project_id = $1 ORDER BY id`, [projectId])).rows;
check('the same records stored', JSON.stringify(await rowsOf(projectA)) === JSON.stringify(await rowsOf(projectB)), { a: await rowsOf(projectA), b: await rowsOf(projectB) });
const eventsA = await eventsOf(projectA);
const eventsB = await eventsOf(projectB);
check(`the same events logged, in the same order (${eventsA.length}: ${eventsA.map((e) => e.change).join(', ')})`, JSON.stringify(eventsA) === JSON.stringify(eventsB), { eventsA, eventsB });
check('a draft then its submission, a resubmission and a deletion among them',
  ['submitted', 'resubmitted', 'deleted'].every((c) => eventsB.some((e) => e.change === c)), eventsB.map((e) => e.change));

// Two batches of the same 200 records in opposite orders, at once, 20 times: no deadlock, the newest of each kept
const keys = Array.from({ length: 200 }, (_, i) => String(1000 + i));
let clock = 10_000;
let deadlocks = 0;
for (let round = 0; round < 20; round++) {
  const forward = keys.map((k) => envelope(k, ++clock));
  const backward = [...keys].reverse().map((k) => envelope(k, ++clock));
  const results = await Promise.allSettled([
    store.putRecordsWithEvents(projectB, forward.map((e) => upload(projectB, e))),
    store.putRecordsWithEvents(projectB, backward.map((e) => upload(projectB, e))),
  ]);
  deadlocks += results.filter((r) => r.status === 'rejected').length;
}
check('two batches of the same records in opposite orders at once: no deadlock (40 batches)', deadlocks === 0, deadlocks);
const newest = (await owner.query(`SELECT count(*)::int AS n FROM records WHERE project_id = $1 AND record_key = ANY($2) AND modified_on = to_timestamp($3 / 1000.0)`,
  [projectB, keys, clock])).rows[0].n;
const kept = (await owner.query(`SELECT max(modified_on) AS m, count(*)::int AS n FROM records WHERE project_id = $1 AND record_key = ANY($2)`, [projectB, keys])).rows[0];
check('each record once, with the newest of its uploads', kept.n === 200 && new Date(kept.m).getTime() === clock && newest === 1, { kept, newest, clock });

// Through the route, as Collect Earth sends: a gzipped batch with a record twice
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0 } as never,
  webDir: null,
});
const project = await store.createProject({ name: 'Route' });
const body = gzipSync(Buffer.from(JSON.stringify({ records: [envelope('9', 100), envelope('9', 90), envelope('8', 100), { bad: true }] })));
const res = await app.inject({
  method: 'POST', url: `/v1/projects/${project.projectId}/records:batch`,
  headers: { authorization: `Bearer ${project.projectToken}`, 'content-type': 'application/json', 'content-encoding': 'gzip' }, payload: body,
});
const results = res.json().results as { recordKey: string; status: string }[];
check('the route answers each record in order: stored, stale, stored, error', res.statusCode === 200
  && results.map((r) => r.status).join() === 'stored,stale,stored,error', res.body);
await app.close();
await owner.end();
await store.close();
console.log(failures === 0 ? 'all ok' : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
