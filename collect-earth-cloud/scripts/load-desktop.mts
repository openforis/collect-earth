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
// With a training day (load-mapathon.mts TRAINING): each instance joins holding no plot, so Collect Earth opens the
// training by itself; it answers every training plot through its form and sends them (HANDOFF.trained); once the
// coordinators have finished the training and divided the plots (HANDOFF.divided), Collect Earth's own check (every five
// minutes) takes the training away, deletes its training records and brings the person's plots, which is timed and
// checked (HANDOFF.collecting); then the collection as above.
//
// Without DB (a deployed server, whose database is not reachable from here) each completed plot is timed by Collect
// Earth's own sync state (/api/cloud/recordSync, until "sent"), and checked in the People tab with the coordinator's
// session load-mapathon.mts hands over.
//
// Existing projects and accounts (scripts/mapathon-run.mts): a mapathon of HANDOFF without inviteToken, whose people
// carry their own password ({username, password}), is opened as a person who is in it already: Collect Earth signs in
// to HANDOFF.base with the person's password (Settings › Cloud) and opens the project from its list; with UNTIL_ALL=1
// each instance collects every plot it holds once and stops; the server's count of each person's plots is then
// checked as that person sees it (My work).
//
// Settings (environment): CE_APP (the collect-earth-app folder, where CollectEarth.jar is built and must run from),
// CE_HOMES (where the instances' user folders go, emptied first), FIRST_PORT (8031), PACE_S ("20-40": seconds between
// two plots of one person), XMX (1g), KEEP=1 to leave the instances running, OUT for the JSON report.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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
  base: string; password?: string; coordinatorToken?: string; training?: number;
  mapathons: { name: string; pid: string; inviteToken?: string; coordinatorToken?: string; people: (string | { username: string; password: string })[] }[];
};
const TRAINING = handoff.training ?? 0;
const UNTIL_ALL = process.env.UNTIL_ALL === '1';
/** With UNTIL_ALL: at most so many plots each (a rehearsal) */
const PLOTS_EACH = Number(process.env.PLOTS_EACH ?? Infinity);

interface Instance {
  n: number; port: number; home: string; username: string; password: string; pid: string; mapathon: string; process?: ChildProcess;
  plots: string[]; next: number;
  /** plot -> when its last save made it complete (actively saved, valid) */
  completed: Map<string, number>;
  saves: number[]; failedSaves: number; incomplete: number;
  /** Without DB: plot -> how long after completing it Collect Earth said it was sent (ms) */
  sentAfter: Map<string, number>;
  /** The training: its plots, completed, whether Collect Earth opened it by itself, and the switch to the person's plots */
  training: string[]; trainingCompleted: number; openedByItself?: boolean; switchSeconds?: number; trainingLeftHere?: number;
}

const instances: Instance[] = [];
for (const m of handoff.mapathons) {
  for (const person of m.people) {
    const n = instances.length + 1;
    const username = typeof person === 'string' ? person : person.username;
    const password = typeof person === 'string' ? handoff.password! : person.password;
    instances.push({ n, port: FIRST_PORT + n - 1, home: join(CE_HOMES, `ce${n}`), username, password, pid: m.pid, mapathon: m.name,
      plots: [], next: 0, completed: new Map(), saves: [], failedSaves: 0, incomplete: 0, sentAfter: new Map(), training: [], trainingCompleted: 0 });
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
  // Its own temporary folder too: Collect keeps its record index there (collect_index), locked by the instance that
  // has it, so instances sharing /tmp wait on each other's lock and one does not start
  mkdirSync(join(i.home, 'tmp'), { recursive: true });
  i.process = spawn('java', [`-Xmx${XMX}`, `-Duser.home=${i.home}`, `-Djava.io.tmpdir=${join(i.home, 'tmp')}`, '-jar', 'target/CollectEarth.jar'], {
    cwd: CE_APP, env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'], detached: true,
  });
}

async function waitUp(i: Instance, minutes = 8) {
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
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('port=') && !l.startsWith('cloud_sync_url='));
  lines.push(`port=${i.port}`);
  // The server Collect Earth signs in to (Settings › Cloud): an existing project is opened from its list there
  lines.push(`cloud_sync_url=${handoff.base}`);
  writeFileSync(file, lines.join('\n') + '\n');
  start(i);
  await waitUp(i);
}

/** The plots the instance's plots map lists (its plots file), or none while they load */
async function plotsShown(i: Instance): Promise<string[]> {
  try {
    const plots = await (await fetch(`${base(i)}/plotsGeoJson`)).json() as { features: { properties: { id: string } }[] };
    return plots.features.map((f) => f.properties.id);
  } catch {
    return [];
  }
}
const isTraining = (id: string) => /^(T-|-)/.test(id);

/**
 * Joins the mapathon as the invitation's member (the Join cloud project dialog), then waits for the restart and its
 * plots: the person's (the plots file Collect Earth keeps from the server), or with a training day the training, which
 * Collect Earth opens by itself as the person holds no plot yet (opened here only if it did not, which is checked).
 */
/** Joins failed and tried again, as the person would (the server failing to give the project file, say) */
const joinFailures: string[] = [];

async function joinMapathon(i: Instance, inviteToken: string | undefined) {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    if (inviteToken) {
      res = await api(i, 'cloud/join', { baseUrl: handoff.base, inviteToken, projectId: i.pid, username: i.username, password: i.password, register: false });
    } else {
      // In the project already: signed in with the person's password, the project opened from the list
      res = await api(i, 'cloud/login', { username: i.username, password: i.password });
      if (res.status === 200) res = await api(i, 'cloud/projects/open', { projectId: i.pid, server: handoff.base });
    }
    if (res.status === 200) break;
    const why = `instance ${i.n} could not join (try ${attempt}): ${res.status} ${(await res.text()).slice(0, 200)}`;
    joinFailures.push(why);
    log(why);
    if (attempt >= 5) throw new Error(why);
    await sleep(between(10_000, 30_000));
  }
  await sleep(8000);
  await waitUp(i);
  const until = Date.now() + (TRAINING > 0 ? 6 : 3) * 60_000;
  for (;;) {
    const shown = await plotsShown(i);
    if (TRAINING > 0 ? shown.length > 0 && shown.every(isTraining) : shown.length > 0) {
      if (TRAINING > 0) { i.training = shown; i.openedByItself ??= true; } else i.plots = shown;
      return;
    }
    if (Date.now() > until) {
      if (TRAINING > 0 && i.openedByItself === undefined) {
        // Not opened by itself: opened as the person would (Settings › Project), so the run goes on; the check says so
        i.openedByItself = false;
        const list = await (await api(i, 'cloud/assignments')).json() as { assignments?: { id: string; training?: unknown }[] };
        const set = list.assignments?.find((a) => a.training);
        if (set) await api(i, 'cloud/training/open', { id: set.id });
        await sleep(10_000);
        continue;
      }
      throw new Error(`instance ${i.n}: no ${TRAINING > 0 ? 'training' : ''} plots`);
    }
    await sleep(3000);
  }
}

/** The records of this computer's database whose plot is a training plot (Collect Earth deletes them after the training) */
function trainingRecordsHere(i: Instance): number {
  const db = join(i.home, 'CollectEarth', 'collectEarthDatabase.db');
  if (!existsSync(db)) return 0;
  try {
    const out = execFileSync('python3', ['-I', '-c', "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute(\"select count(*) from ofc_record where key1 like 'T-%'\").fetchone()[0])", db], { encoding: 'utf8' });
    return Number(out.trim());
  } catch {
    return NaN;
  }
}

/** Every training plot answered through the form, at the run's pace, then sent */
async function train(i: Instance) {
  for (const plot of i.training) {
    await sleep(between(PACE_LO * 1000, PACE_HI * 1000));
    const before = i.completed.size;
    await fillPlot(i, plot);
    if (i.completed.size > before) i.trainingCompleted += 1;
  }
  // The training's saves are not the collection's
  i.completed.clear();
  i.sentAfter.clear();
  await drain(i);
}

/** Each saved plot sent: a sync asked for (as the button does), then the queue followed until it is empty */
async function drain(i: Instance) {
  await api(i, 'cloud/syncNow', {}).catch(() => undefined);
  const until = Date.now() + 5 * 60_000;
  for (;;) {
    const state = await (await api(i, 'cloud/state')).json() as { sync: { pending: number; failed: number; lastError: string | null } };
    if (state.sync.pending === 0 || Date.now() > until) return state.sync;
    await sleep(2000);
  }
}

/** After the finish: Collect Earth's own check takes the training away and brings the person's plots (timed) */
async function afterTraining(i: Instance, dividedAt: number) {
  const until = Date.now() + 12 * 60_000;
  while (Date.now() < until) {
    const shown = await plotsShown(i);
    if (shown.length > 0 && !shown.some(isTraining)) {
      i.plots = shown;
      i.switchSeconds = (Date.now() - dividedAt) / 1000;
      break;
    }
    await sleep(5000);
  }
  i.trainingLeftHere = trainingRecordsHere(i);
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

/**
 * An answer for a field the form says is wrong or missing; `tries`, how often it said so of this field in this plot:
 * each try another value, as a person reads the rule and answers again (a number within a rule's limits, a year after
 * another, a text of some length)
 */
const NUMBERS = ['10', '15', '12', '50', '100', '3', '1', '0', '2015', '2020', '7', '25'];
const TEXTS = ['checked', 'Forest edge', 'A', 'Seen on the imagery of the plot', 'ok'];
// As the form sends them (DateAttributeHandler.DATE_ATTRIBUTE_FORMAT, MM/dd/yyyy)
const DATES = ['11/14/2026', '06/15/2020', '01/10/2015', '03/01/2024'];
function answer(name: string, info: FieldInfo, tries = 0): string {
  const codes = (info.possibleCodedItems ?? []).map((c) => c.code).filter((c) => c !== '-1');
  if (codes.length) return codes[Math.floor(Math.random() * codes.length)];
  const type = fieldTypes?.get(name);
  if (type === 'boolean') return tries % 2 === 0 ? 'true' : 'false';
  if (type === 'integer' || type === 'real' || type === 'number' || type === 'range') return NUMBERS[tries % NUMBERS.length];
  if (type === 'date') return DATES[tries % DATES.length];
  return TEXTS[tries % TEXTS.length];
}

/** Fills a plot as a person does: answers, saves, answers what the form says is missing, saves again, until it is complete. */
async function fillPlot(i: Instance, plot: string) {
  // No second land use change: the rarer branch with its own rules on the years
  const values: Record<string, string> = { collect_boolean_actively_saved: 'true', collect_boolean_second_lu_change: 'false', collect_boolean_land_use_subdivision_change: 'false' };
  const tries = new Map<string, number>();
  for (let attempt = 0; attempt < 16; attempt++) {
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
      const completedAt = Date.now();
      i.completed.set(plot, completedAt);
      if (!DB) void timeSent(i, plot, completedAt);
      return;
    }
    for (const [name, info] of Object.entries(result.inputFieldInfoByParameterName ?? {})) {
      if (info.inError && info.visible !== false) {
        const n = tries.get(name) ?? 0;
        tries.set(name, n + 1);
        values[name] = answer(name, info, n);
      }
    }
    // The person reads what the form says, then answers
    await sleep(between(1500, 4000));
  }
  i.incomplete += 1;
}

/** Collect Earth's sync state of a plot (local, pending, sent, failed), as its plot form shows it */
async function syncState(i: Instance, plot: string): Promise<string> {
  try {
    return ((await (await api(i, `cloud/recordSync?key=${encodeURIComponent(plot)}`)).json()) as { state: string }).state;
  } catch {
    return 'unknown';
  }
}

/** Without DB: how long after completing a plot Collect Earth says it is sent (its queue empty of it) */
async function timeSent(i: Instance, plot: string, completedAt: number) {
  // The completing save queued the plot: "sent" from here is this save sent (or a later one of the same plot)
  const until = completedAt + 10 * 60_000;
  while (Date.now() < until) {
    if ((await syncState(i, plot)) === 'sent') {
      if (i.completed.get(plot) === completedAt) i.sentAfter.set(plot, Date.now() - completedAt);
      return;
    }
    await sleep(250);
  }
}

async function collect(i: Instance) {
  while (!existsSync(`${HANDOFF}.done`)) {
    // UNTIL_ALL: each plot the person holds, once, then the person stops
    if (UNTIL_ALL && i.next >= Math.min(i.plots.length, PLOTS_EACH)) break;
    await sleep(between(PACE_LO * 1000, PACE_HI * 1000));
    if (existsSync(`${HANDOFF}.done`)) break;
    if (i.next % 25 === 0 && i.next > 0) log(`instance ${i.n} (${i.username}): ${i.next} of ${i.plots.length} plots`);
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
log(`joined, ${TRAINING > 0 ? `training opened: ${instances.map((i) => `${i.training.length}${i.openedByItself ? '' : ' (opened by hand)'}`).join(', ')} training plots` : `plot files applied: ${instances.map((i) => i.plots.length).join(', ')} plots`}`);
if (TRAINING > 0) {
  writeFileSync(`${HANDOFF}.ready`, new Date().toISOString());
  log('training');
  await Promise.all(instances.map(train));
  writeFileSync(`${HANDOFF}.trained`, new Date().toISOString());
  log('trained; waiting for the coordinators to finish the training and divide the plots');
  while (!existsSync(`${HANDOFF}.divided`)) await sleep(2000);
  const dividedAt = Date.now();
  await Promise.all(instances.map((i) => afterTraining(i, dividedAt)));
  log(`the person's plots back: ${instances.map((i) => `${i.plots.length} after ${i.switchSeconds?.toFixed(0) ?? 'never'} s`).join(', ')}`);
}

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

writeFileSync(`${HANDOFF}.${TRAINING > 0 ? 'collecting' : 'ready'}`, new Date().toISOString());
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
  const latencies = (DB
    ? [...i.completed.keys()].map((k) => arrived.get(`${i.username} ${k}`)! - i.completed.get(k)!)
    : [...i.sentAfter.values()]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!DB) {
    // Each plot it completed sent, as Collect Earth says; and the server counts them, as the coordinator sees it
    const states = await Promise.all([...i.completed.keys()].map(async (k) => [k, await syncState(i, k)] as const));
    const unsent = states.filter(([, st]) => st !== 'sent').map(([k, st]) => `${k} ${st}`);
    onServer = i.completed.size - unsent.length;
    missing = unsent;
    const coordinatorToken = handoff.mapathons.find((m) => m.pid === i.pid)?.coordinatorToken ?? handoff.coordinatorToken;
    if (coordinatorToken) {
      let submitted: number | undefined;
      for (let attempt = 0; attempt < 30; attempt++) {
        const res = await fetch(`${handoff.base}/v1/projects/${i.pid}/people`, { headers: { authorization: `Bearer ${coordinatorToken}` } });
        const people = await res.json() as { asOf: number | null; people: { username: string; plots: { submitted: number } }[] };
        submitted = people.people?.find((r) => r.username === i.username)?.plots.submitted;
        if (people.asOf === null) break;
        await sleep(2000);
      }
      checks.push({ what: `Collect Earth ${i.n}: the People tab counts the plots it completed`, ok: submitted === i.completed.size, detail: `${submitted} shown, ${i.completed.size} completed` });
    } else if (!handoff.password) {
      // The person's own count (My work), signed in with the person's password: the plots the server says they submitted
      let submitted: number | undefined;
      try {
        const login = await (await fetch(`${handoff.base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: i.username, password: i.password }) })).json() as { token: string };
        for (let attempt = 0; attempt < 30; attempt++) {
          const work = await (await fetch(`${handoff.base}/v1/projects/${i.pid}/my-work`, { headers: { authorization: `Bearer ${login.token}` } })).json() as { asOf: number | null; person: { plots: { submitted: number } } };
          submitted = work.person?.plots.submitted;
          if (work.asOf === null) break;
          await sleep(2000);
        }
        await fetch(`${handoff.base}/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${login.token}` } });
      } catch (err) {
        log(`instance ${i.n}: My work not read: ${err}`);
      }
      checks.push({ what: `Collect Earth ${i.n}: My work counts the plots it completed`, ok: submitted !== undefined && submitted >= i.completed.size, detail: `${submitted} shown, ${i.completed.size} completed` });
    }
  }
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
    + `${DB ? 'on the server' : 'sent'} ${row.syncMedianS.toFixed(1)} s after completing it (median), p95 ${row.syncP95S.toFixed(1)} s, max ${row.syncMaxS.toFixed(1)} s; `
    + `queue at the end ${JSON.stringify(drained.get(i.n))}; processes ${rss.toFixed(0)} MB`);
  checks.push({
    what: client ? `Collect Earth ${i.n}: every plot it completed is on the server, complete` : `Collect Earth ${i.n}: every plot it completed is sent, as Collect Earth says`,
    ok: missing.length === 0, detail: `${onServer} of ${i.completed.size}${missing.length ? `, not: ${missing.slice(0, 5).join(' ')}` : ''}`,
  });
}
if (TRAINING > 0) {
  for (const i of instances) {
    checks.push({ what: `Collect Earth ${i.n}: opened the training by itself (the person held no plot yet)`, ok: i.openedByItself === true, detail: `${i.training.length} training plots` });
    checks.push({ what: `Collect Earth ${i.n}: answered every training plot through its form`, ok: i.trainingCompleted === i.training.length && i.training.length === TRAINING, detail: `${i.trainingCompleted} of ${i.training.length}` });
    checks.push({ what: `Collect Earth ${i.n}: after the training, its own check brought the person's plots and deleted the training's records here`, ok: i.switchSeconds !== undefined && i.trainingLeftHere === 0, detail: `${i.plots.length} plots after ${i.switchSeconds?.toFixed(0) ?? 'never'} s; ${i.trainingLeftHere} training records left` });
  }
}
checks.push({ what: 'Every Collect Earth joined at its first try', ok: joinFailures.length === 0, detail: joinFailures.length ? joinFailures.slice(0, 3).join('; ') : `${instances.length} instances` });
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
