// Timings (Task 22) on a THROWAWAY PostgreSQL (it drops and creates the database `cetime` and the
// role `ce_time_app`): one project of 100,000 plots in 4 plot files of 25,000 (with latitude and
// longitude), 20 members (the owner, a reviewer, 18 collectors), 40 % of the plots submitted and
// 5 % started, a quality-check copy of every tenth submitted plot (4,000) of which half are
// submitted (2,000 checks, a third of them differing), 12 answers per record. The server runs as
// the NOSUPERUSER NOBYPASSRLS app role. Each route is asked on a fresh server (cold: an empty
// project state cache and a new quality worker), then 5 times more (warm, the median reported);
// at the end one server answers every route, and its process's memory (RSS) is printed. With
// `memory` as the second argument only that last server runs (the closed servers of the timings,
// not yet collected, would otherwise count in the RSS); with node's --expose-gc a collection runs
// before each reading.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npx tsx scripts/pg-timing-100k.mts 55481        (the superuser is postgres / pw on localhost)
//   node --expose-gc --import tsx scripts/pg-timing-100k.mts 55481 memory
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://cetimeown:pw@${host}/cetime`;
const appUrl = `postgres://ce_time_app:apppw@${host}/cetime`;
const DAY = 86_400_000;
const N = 100_000;
const FILES = 4;
const PER_FILE = N / FILES;
const COLLECTORS = 18;
const memoryOnly = process.argv[3] === 'memory';
const mb = (n: number) => Math.round(n / 1024 / 1024);
const memory = () => {
  (globalThis as { gc?: () => void }).gc?.();
  const m = process.memoryUsage();
  return `rss ${mb(m.rss)} MiB, heap used ${mb(m.heapUsed)} MiB, heap total ${mb(m.heapTotal)} MiB, external ${mb(m.external)} MiB, array buffers ${mb(m.arrayBuffers)} MiB`;
};

const sup = new pg.Client({ connectionString: superUrl });
for (let i = 0; ; i++) {
  try {
    await sup.connect();
    break;
  } catch (err) {
    if (i > 60) throw err;
    await new Promise((r) => setTimeout(r, 500));
  }
}
await sup.query('DROP DATABASE IF EXISTS cetime');
await sup.query('DROP ROLE IF EXISTS ce_time_app');
await sup.query("DO $$ BEGIN CREATE ROLE cetimeown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cetime OWNER cetimeown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();

const store = new PostgresStore(appUrl);
const config = { port: 0, host: '127.0.0.1', storeBackend: 'postgres', adminApiKey: 'k', setupCode: 'X', rateLimitPerMinute: 0 } as any;
const app = await buildServer({ store, config, webDir: null });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
if (res.statusCode !== 201) throw new Error(res.body);
const ownerToken = res.json().token as string;
const pid = (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(ownerToken), payload: { name: 'Timing 100k' } })).json().projectId as string;

// --- The data. ---
const t0 = performance.now();
const fileIds: string[] = [];
for (let f = 0; f < FILES; f++) {
  const rows = ['id,lat,lon'];
  for (let k = 0; k < PER_FILE; k++) {
    const id = f * PER_FILE + k + 1;
    rows.push(`${id},${(-10 + f * 5 + (k % 500) * 0.002).toFixed(5)},${(20 + Math.floor(k / 500) * 0.002).toFixed(5)}`);
  }
  res = await app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/region_${f + 1}.csv`, headers: { ...bearer(ownerToken), 'content-type': 'text/csv' }, payload: rows.join('\n') + '\n' });
  if (res.statusCode !== 201) throw new Error(res.body);
  fileIds.push(res.json().id as string);
}
await owner.query(`INSERT INTO users (id, username, password_hash) SELECT gen_random_uuid(), 'c' || k, 'x' FROM generate_series(0, $1::int - 1) k`, [COLLECTORS]);
await owner.query(`INSERT INTO users (id, username, password_hash) VALUES (gen_random_uuid(), 'rev', 'x')`);
await owner.query(`INSERT INTO project_members (project_id, user_id, role) SELECT $1, id, 'operator' FROM users WHERE username ~ '^c[0-9]+$'`, [pid]);
await owner.query(`INSERT INTO project_members (project_id, user_id, role) SELECT $1, id, 'reviewer' FROM users WHERE username = 'rev'`, [pid]);
await owner.query(`UPDATE csv_files SET distribution = '{"mode": "manual"}' WHERE project_id = $1`, [pid]);
// Plot i is c(i % 18)'s, in the file of its id; every tenth submitted plot (i % 100 < 40) is also a
// copy to compare for the next collector.
await owner.query(
  `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap)
   SELECT $1::uuid, ($2::uuid[])[1 + (i - 1) / $3::int], i::text, u.id, false FROM generate_series(1, $4::int) i JOIN users u ON u.username = 'c' || (i % $5::int)
   UNION ALL
   SELECT $1::uuid, ($2::uuid[])[1 + (i - 1) / $3::int], i::text, u.id, true FROM generate_series(1, $4::int) i JOIN users u ON u.username = 'c' || ((i + 1) % $5::int)
    WHERE i % 10 = 0 AND i % 100 < 40`,
  [pid, fileIds, PER_FILE, N, COLLECTORS],
);
const answers = (who: string) =>
  `jsonb_build_object('collect_code_land_use', (ARRAY['F','C','G','S','W','O'])[1 + ((i / 18) * 7 + ${who}) % 6],
     'collect_code_forest_type', (ARRAY['a','b','c','d'])[1 + (i / 18) % 4], 'collect_code_canopy', (ARRAY['1','2','3','4','5'])[1 + (i / 18) % 5],
     'collect_code_disturbance', (ARRAY['none','fire','logging'])[1 + (i / 18) % 3], 'collect_code_change', (ARRAY['yes','no'])[1 + (i / 18) % 2],
     'collect_code_soil', (ARRAY['s1','s2','s3','s4','s5','s6'])[1 + (i / 18) % 6], 'collect_integer_tree_cover', ((i * 7) % 101)::text,
     'collect_integer_shrubs', ((i * 3) % 41)::text, 'collect_real_elevation', ((i * 13) % 2500)::text,
     'collect_code_confidence', (ARRAY['high','medium','low'])[1 + (i / 18) % 3], 'collect_text_notes', 'notes ' || i, 'collect_text_id', i::text)`;
const now = Date.now();
// First assessments over 60 days (each collector a few minutes apart, every 25th very fast); 40 %
// submitted, 5 % started. Checks: half of the copies submitted, a third of them answering otherwise.
await owner.query(
  `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on)
   SELECT $1::uuid, i::text, 'c' || (i % 18), to_timestamp(($2::bigint - (i % 60) * $3::bigint - (i / 18 % 400) * (CASE WHEN i % 25 = 0 THEN 5000 ELSE 180000 END)) / 1000.0),
          to_timestamp(($2::bigint - (i % 60) * $3::bigint + 600000) / 1000.0), i % 100 < 40, 1, '<r/>', ${answers('0')}, false, NULL::timestamptz
     FROM generate_series(1, $4::int) i WHERE i % 100 < 45
   UNION ALL
   SELECT $1::uuid, i::text, 'c' || ((i + 1) % 18), to_timestamp(($2::bigint - (i % 30) * $3::bigint) / 1000.0), to_timestamp(($2::bigint - (i % 30) * $3::bigint + 600000) / 1000.0),
          true, 1, '<r/>', ${answers('CASE WHEN i % 3 = 0 THEN 1 ELSE 0 END')}, false, NULL::timestamptz
     FROM generate_series(1, $4::int) i WHERE i % 20 = 0 AND i % 100 < 40`,
  [pid, now, DAY, N],
);
await owner.query(
  `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change, summary)
   SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, false,
          CASE WHEN actively_saved THEN 'submitted' ELSE 'created' END, CASE WHEN actively_saved THEN summary END
     FROM records WHERE project_id = $1`,
  [pid],
);
await owner.query('ANALYZE records; ANALYZE record_events; ANALYZE plot_assignments; ANALYZE csv_files');
const counts = (await owner.query(
  `SELECT count(*) FILTER (WHERE actively_saved)::int AS submitted, count(*) FILTER (WHERE NOT actively_saved)::int AS started, count(*)::int AS records,
          (SELECT count(*)::int FROM plot_assignments WHERE project_id = $1) AS assignments,
          (SELECT count(*)::int FROM project_members WHERE project_id = $1) AS members
     FROM records WHERE project_id = $1`,
  [pid],
)).rows[0];
console.log(`data: ${JSON.stringify(counts)} (seeded in ${Math.round((performance.now() - t0) / 1000)} s)`);
await app.close();
console.log(`memory before the timed servers: ${memory()}`);

// --- Cold and warm, each route on a fresh server. ---
const zones = ['Europe/Rome', 'UTC', 'America/Lima', 'Asia/Kolkata', 'Africa/Nairobi', 'Australia/Lord_Howe'];
const routes: [string, (i: number) => string][] = [
  ['GET /progress', (i) => `/progress?days=90&tz=${zones[i]}`],
  ['GET /people', (i) => `/people?tz=${zones[i]}`],
  ['GET /map/plots (first page)', () => '/map/plots'],
  ['GET /quality/flags', () => '/quality/flags'],
  ['GET /weekly', (i) => `/weekly?tz=${zones[i]}`],
];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const rows: string[] = [];
for (const [label, path] of memoryOnly ? [] : routes) {
  const fresh = await buildServer({ store, config, webDir: null });
  const ms: number[] = [];
  let note = '';
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    const r = await fresh.inject({ method: 'GET', url: `/v1/projects/${pid}${path(i)}`, headers: bearer(ownerToken) });
    ms.push(Math.round(performance.now() - t));
    if (r.statusCode !== 200) throw new Error(`${label}: ${r.statusCode} ${r.body.slice(0, 300)}`);
    const body = r.json();
    if (i === 0) {
      note = `${(r.body.length / 1024).toFixed(0)} KB`;
      if (body.stale) {
        // The quality figures are computed by the worker: wait for them, then time the warm ones.
        const t1 = performance.now();
        for (;;) {
          await new Promise((r2) => setTimeout(r2, 100));
          const again = await fresh.inject({ method: 'GET', url: `/v1/projects/${pid}${path(i)}`, headers: bearer(ownerToken) });
          if (!again.json().stale) break;
        }
        note += `, stale at first; fresh ${Math.round(ms[0] + performance.now() - t1)} ms after the first request`;
      }
    }
  }
  const line = `${label}: cold ${ms[0]} ms, warm ${ms.slice(1).join(', ')} ms (median ${median(ms.slice(1))} ms) [${note}]`;
  console.log(line);
  rows.push(line);
  await fresh.close();
}

// --- One server answering everything: its memory after warm-up. ---
const one = await buildServer({ store, config, webDir: null });
for (let round = 0; round < 6; round++) {
  for (const [label, path] of routes) {
    const r = await one.inject({ method: 'GET', url: `/v1/projects/${pid}${path(round)}`, headers: bearer(ownerToken) });
    if (r.statusCode !== 200) throw new Error(r.body.slice(0, 300));
    if (round === 0 && r.json().stale) {
      for (;;) {
        await new Promise((r2) => setTimeout(r2, 100));
        if (!(await one.inject({ method: 'GET', url: `/v1/projects/${pid}${path(round)}`, headers: bearer(ownerToken) })).json().stale) break;
      }
    }
    if (round === 0) console.log(`  after ${label} (first time): ${memory()}`);
  }
}
console.log(`memory after every route warm on one server: ${memory()}`);
const peak = process.resourceUsage().maxRSS;
console.log(`peak RSS of this process: ${Math.round(peak / 1024)} MiB`);
await one.close();
await store.close();
await owner.end();
process.exit(0);
