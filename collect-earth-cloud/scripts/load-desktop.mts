// Real Collect Earth instances in a load test, beside the simulated people of scripts/load-mapathon.mts: each one with
// its own user folder, port, database and browser, joined to its mapathon as one of the people load-mapathon.mts left to
// it (HANDOFF), then collecting through its own server as its plot form does: it opens a plot, saves it as it is
// filled (save-data-expanded, a few times), and leaves the sync to Collect Earth (CloudSyncService), which sends it to
// the cloud. At the end every plot an instance completed is looked for on the server, and how long it took to get there.
//
//   HANDOFF=/tmp/handoff.json DB=postgres://ceown:pw@localhost:55481/ceload DISPLAY=:99 npx tsx scripts/load-desktop.mts
//
// Start it after load-mapathon.mts (with DESKTOP and the same HANDOFF): it waits for HANDOFF, writes HANDOFF.ready once
// every instance has joined and taken its plot file, collects until HANDOFF.done, then writes HANDOFF.synced once
// every instance has sent what it saved.
//
// Settings (environment): CE_APP (the collect-earth-app folder, where CollectEarth.jar is built and must run from),
// CE_HOMES (where the instances' user folders go, emptied first), FIRST_PORT (8031), PACE_S ("20-40": seconds between
// two plots of one person), XMX (1g), KEEP=1 to leave the instances running, OUT for the JSON report.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const HANDOFF = process.env.HANDOFF;
if (!HANDOFF) throw new Error('HANDOFF is the file load-mapathon.mts writes');
const DB = process.env.DB;
const CE_APP = resolve(process.env.CE_APP ?? join(import.meta.dirname, '../../collect-earth/collect-earth-app'));
const CE_HOMES = resolve(process.env.CE_HOMES ?? '/root/ce-load');
const FIRST_PORT = Number(process.env.FIRST_PORT ?? 8031);
const [PACE_LO, PACE_HI] = (process.env.PACE_S ?? '20-40').split('-').map(Number);
const XMX = process.env.XMX ?? '1g';
const OUT = process.env.OUT;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const log = (msg: string) => process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);

while (!existsSync(HANDOFF)) await sleep(1000);
const handoff = JSON.parse(readFileSync(HANDOFF, 'utf8')) as {
  base: string; password: string; mapathons: { name: string; pid: string; inviteToken: string; people: string[] }[];
};

interface Instance {
  n: number; port: number; home: string; username: string; pid: string; mapathon: string; process?: ChildProcess;
  plots: string[]; next: number;
  /** plot -> when its last save made it complete (actively saved, valid) */
  completed: Map<string, number>;
  saves: number[]; failedSaves: number; incomplete: number;
}

const instances: Instance[] = [];
for (const m of handoff.mapathons) {
  for (const username of m.people) {
    const n = instances.length + 1;
    instances.push({ n, port: FIRST_PORT + n - 1, home: join(CE_HOMES, `ce${n}`), username, pid: m.pid, mapathon: m.name,
      plots: [], next: 0, completed: new Map(), saves: [], failedSaves: 0, incomplete: 0 });
  }
}

// --- an instance ---------------------------------------------------------------------------------------------------

const base = (i: Instance) => `http://127.0.0.1:${i.port}/earth`;
/** The pages' calls carry the header the API asks for (ApiHeaderFilter) */
const api = (i: Instance, path: string, body?: unknown) => fetch(`${base(i)}/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Collect-Earth': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const properties = (i: Instance) => {
  const file = join(i.home, 'CollectEarth', 'earth.properties');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

function start(i: Instance) {
  // Its own user folder: Collect Earth keeps there its settings, its database and its browser profiles
  i.process = spawn('java', [`-Xmx${XMX}`, `-Duser.home=${i.home}`, '-jar', 'target/CollectEarth.jar'], {
    cwd: CE_APP, env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'], detached: true,
  });
}

async function waitUp(i: Instance, minutes = 4) {
  const until = Date.now() + minutes * 60_000;
  while (Date.now() < until) {
    try {
      if ((await api(i, 'cloud/state')).status === 200) return;
    } catch { /* not up yet */ }
    await sleep(2000);
  }
  throw new Error(`instance ${i.n} did not start on port ${i.port}`);
}

/** Every process of the instance: Collect Earth, its relaunches, its dashboard and its browsers, all named by its folder. */
async function stop(i: Instance) {
  spawn('pkill', ['-f', i.home]);
  await sleep(3000);
  spawn('pkill', ['-9', '-f', i.home]);
  await sleep(1000);
}

/**
 * A new user folder, started once on its own (Collect Earth writes a whole earth.properties at its first start, and a
 * shorter one is taken for a new installation and replaced), then moved to its own port and started again.
 */
async function prepare(i: Instance) {
  rmSync(i.home, { recursive: true, force: true });
  mkdirSync(join(i.home, 'CollectEarth'), { recursive: true });
  const first = { ...i, port: 8028 };
  start(first);
  await waitUp(first);
  await stop(first);
  const file = join(i.home, 'CollectEarth', 'earth.properties');
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('port='));
  lines.push(`port=${i.port}`);
  writeFileSync(file, lines.join('\n') + '\n');
  start(i);
  await waitUp(i);
}

/** Joins the mapathon as the invitation's member (the Join cloud project dialog), then waits for the restart and the plot file. */
async function joinMapathon(i: Instance, inviteToken: string) {
  const res = await api(i, 'cloud/join', { baseUrl: handoff.base, inviteToken, projectId: i.pid, username: i.username, password: handoff.password, register: false });
  if (res.status !== 200) throw new Error(`instance ${i.n} could not join: ${res.status} ${await res.text()}`);
  await sleep(8000);
  await waitUp(i);
  // AssignedPlotFileSetup makes the assigned file the plots file by itself
  const until = Date.now() + 3 * 60_000;
  while (!/\ncsv=.*assignments/.test(properties(i))) {
    if (Date.now() > until) throw new Error(`instance ${i.n}: the assigned plot file was not applied`);
    await sleep(2000);
  }
  for (let k = 0; k < 30 && i.plots.length === 0; k++) {
    try {
      const plots = await (await fetch(`${base(i)}/plotsGeoJson`)).json() as { features: { properties: { id: string } }[] };
      i.plots = plots.features.map((f) => f.properties.id);
    } catch { /* the plots are loading */ }
    if (i.plots.length === 0) await sleep(2000);
  }
  if (i.plots.length === 0) throw new Error(`instance ${i.n}: no plots`);
}

// --- a person at the plot form ------------------------------------------------------------------------------------

interface FieldInfo { visible?: boolean; inError?: boolean; errorMessage?: string; possibleCodedItems?: { code: string }[] }
interface SaveAnswer { success: boolean; activelySaved: boolean; validData: boolean; inputFieldInfoByParameterName: Record<string, FieldInfo> }
let fieldTypes: Map<string, string> | null = null;

async function loadFieldTypes(i: Instance) {
  const form = await (await fetch(`${base(i)}/surveyForm`)).json();
  const types = new Map<string, string>();
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (typeof r.name === 'string' && typeof r.type === 'string') types.set(r.name, r.type);
      Object.values(r).forEach(walk);
    }
  };
  walk(form);
  fieldTypes = types;
}

function answer(name: string, info: FieldInfo): string {
  const codes = (info.possibleCodedItems ?? []).map((c) => c.code).filter((c) => c !== '-1');
  if (codes.length) return codes[Math.floor(Math.random() * codes.length)];
  const type = fieldTypes?.get(name);
  if (type === 'boolean') return 'true';
  if (type === 'integer' || type === 'real' || type === 'number' || type === 'range') return String(1 + Math.floor(Math.random() * 9));
  if (type === 'date') return '2026-11-14';
  return 'checked';
}

/** Fills a plot as a person does: answers, saves, answers what the form says is missing, saves again, until it is complete. */
async function fillPlot(i: Instance, plot: string) {
  // No second land use change: the rarer branch with its own rules on the years
  const values: Record<string, string> = { collect_boolean_actively_saved: 'true', collect_boolean_second_lu_change: 'false', collect_boolean_land_use_subdivision_change: 'false' };
  for (let attempt = 0; attempt < 10; attempt++) {
    const body = new URLSearchParams({ placemarkId: plot, currentStep: '0', partialUpdate: 'false' });
    for (const [k, v] of Object.entries(values)) body.append(`values[${k}]`, v);
    const started = performance.now();
    let result: SaveAnswer;
    try {
      const res = await fetch(`${base(i)}/save-data-expanded`, { method: 'POST', body, signal: AbortSignal.timeout(60_000) });
      result = await res.json() as SaveAnswer;
      i.saves.push(performance.now() - started);
    } catch {
      i.failedSaves += 1;
      await sleep(3000);
      continue;
    }
    if (!result.success) i.failedSaves += 1;
    if (result.activelySaved && result.validData) {
      i.completed.set(plot, Date.now());
      return;
    }
    for (const [name, info] of Object.entries(result.inputFieldInfoByParameterName ?? {})) {
      if (info.inError && info.visible !== false) values[name] = answer(name, info);
    }
    // The person reads what the form says, then answers
    await sleep(between(1500, 4000));
  }
  i.incomplete += 1;
}

async function collect(i: Instance) {
  while (!existsSync(`${HANDOFF}.done`)) {
    await sleep(between(PACE_LO * 1000, PACE_HI * 1000));
    if (existsSync(`${HANDOFF}.done`)) break;
    const plot = i.next < i.plots.length ? i.plots[i.next++] : i.plots[Math.floor(Math.random() * i.plots.length)];
    await fillPlot(i, plot);
  }
}

// --- the run ------------------------------------------------------------------------------------------------------

mkdirSync(CE_HOMES, { recursive: true });
log(`${instances.length} Collect Earth instances: ${instances.map((i) => `${i.username} on ${i.port}`).join(', ')}`);
// One at a time: the first start of each uses the default port
for (const i of instances) {
  await prepare(i);
  log(`instance ${i.n} up on ${i.port}`);
}
await Promise.all(instances.map((i) => joinMapathon(i, handoff.mapathons.find((m) => m.pid === i.pid)!.inviteToken)));
await loadFieldTypes(instances[0]);
log(`joined, plot files applied: ${instances.map((i) => i.plots.length).join(', ')} plots`);

// The server's arrival time of each completed plot, followed while they collect
const arrived = new Map<string, number>(); // "operator plot" -> received_at of its complete version
const client = DB ? new pg.Client({ connectionString: DB }) : null;
await client?.connect();
let watching = true;
const watch = (async () => {
  while (watching && client) {
    const rows = (await client.query('SELECT operator, record_key, received_at, actively_saved FROM records WHERE operator = ANY($1)',
      [instances.map((i) => i.username)])).rows as { operator: string; record_key: string; received_at: Date; actively_saved: boolean }[];
    for (const r of rows) {
      const i = instances.find((x) => x.username === r.operator)!;
      const done = i.completed.get(r.record_key);
      const key = `${r.operator} ${r.record_key}`;
      if (done !== undefined && r.actively_saved && r.received_at.getTime() >= done - 1000 && !arrived.has(key)) arrived.set(key, r.received_at.getTime());
    }
    await sleep(1000);
  }
})();

writeFileSync(`${HANDOFF}.ready`, new Date().toISOString());
log('collecting until the load test ends');
await Promise.all(instances.map(collect));

// Everything saved goes out: each instance's queue empty (and a sync asked for, as the button does)
log('waiting for each instance to send what it saved');
const drained = new Map<number, unknown>();
for (const i of instances) {
  await api(i, 'cloud/syncNow', {}).catch(() => undefined);
  const until = Date.now() + 5 * 60_000;
  for (;;) {
    const state = await (await api(i, 'cloud/state')).json() as { sync: { pending: number; failed: number; lastError: string | null } };
    drained.set(i.n, state.sync);
    if (state.sync.pending === 0 || Date.now() > until) break;
    await sleep(2000);
  }
}
await sleep(4000);
watching = false;
await watch;

// --- the check and the report --------------------------------------------------------------------------------------

const lines: string[] = [];
const checks: { what: string; ok: boolean; detail: string }[] = [];
const report: Record<string, unknown>[] = [];
let allLatencies: number[] = [];
for (const i of instances) {
  let onServer = 0;
  let missing: string[] = [];
  if (client) {
    const rows = (await client.query('SELECT record_key, actively_saved FROM records WHERE operator = $1 AND project_id = $2 AND NOT deleted', [i.username, i.pid])).rows as { record_key: string; actively_saved: boolean }[];
    const complete = new Set(rows.filter((r) => r.actively_saved).map((r) => r.record_key));
    missing = [...i.completed.keys()].filter((k) => !complete.has(k));
    onServer = i.completed.size - missing.length;
  }
  const latencies = [...i.completed.keys()].map((k) => arrived.get(`${i.username} ${k}`)! - i.completed.get(k)!).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  allLatencies = allLatencies.concat(latencies);
  const saves = [...i.saves].sort((a, b) => a - b);
  const rss = memoryOf(i.home);
  const row = {
    instance: i.n, port: i.port, person: i.username, mapathon: i.mapathon, plotsCompleted: i.completed.size, incomplete: i.incomplete,
    formSaves: saves.length, failedSaves: i.failedSaves, saveMedianMs: pct(saves, 50), saveP95Ms: pct(saves, 95),
    onServer, syncMedianS: pct(latencies, 50) / 1000, syncP95S: pct(latencies, 95) / 1000, syncMaxS: (latencies.at(-1) ?? NaN) / 1000,
    sync: drained.get(i.n), memoryMb: rss,
  };
  report.push(row);
  lines.push(`Collect Earth ${i.n} (${i.username}, port ${i.port}): ${i.completed.size} plots completed in ${saves.length} form saves `
    + `(median ${row.saveMedianMs.toFixed(0)} ms, p95 ${row.saveP95Ms.toFixed(0)} ms, ${i.failedSaves} failed, ${i.incomplete} left incomplete); `
    + `on the server ${row.syncMedianS.toFixed(1)} s after completing it (median), p95 ${row.syncP95S.toFixed(1)} s, max ${row.syncMaxS.toFixed(1)} s; `
    + `queue at the end ${JSON.stringify(drained.get(i.n))}; processes ${rss.toFixed(0)} MB`);
  if (client) checks.push({ what: `Collect Earth ${i.n}: every plot it completed is on the server, complete`, ok: missing.length === 0, detail: `${onServer} of ${i.completed.size}${missing.length ? `, missing ${missing.slice(0, 5).join(' ')}` : ''}` });
}
allLatencies.sort((a, b) => a - b);
lines.push(`All instances: ${allLatencies.length} plots timed from completed to on the server: median ${(pct(allLatencies, 50) / 1000).toFixed(1)} s, p95 ${(pct(allLatencies, 95) / 1000).toFixed(1)} s, max ${((allLatencies.at(-1) ?? NaN) / 1000).toFixed(1)} s`);
for (const c of checks) lines.push(`${c.ok ? 'ok  ' : 'FAIL'} ${c.what} (${c.detail})`);
console.log(lines.join('\n'));
if (OUT) writeFileSync(OUT, JSON.stringify({ instances: report, checks }, null, 2));
await client?.end();
writeFileSync(`${HANDOFF}.synced`, new Date().toISOString());
if (process.env.KEEP !== '1') for (const i of instances) await stop(i);
process.exit(checks.every((c) => c.ok) ? 0 : 1);

/** The memory (resident) of the processes whose command line names the instance's folder: Collect Earth, its dashboard, its browsers. */
function memoryOf(home: string): number {
  let mb = 0;
  for (const pid of readdirSync('/proc').filter((e) => /^\d+$/.test(e))) {
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(home)) mb += Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096 / 1048576;
    } catch { /* gone */ }
  }
  return mb;
}
