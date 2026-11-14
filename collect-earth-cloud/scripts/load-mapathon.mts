// Load test of a cloud server with mapathons: several projects, each with its coordinator and its collectors, all
// working at once through the real HTTP API, as Collect Earth and the dashboard call it.
//
// Each collector does what Collect Earth's cloud sync does (CloudSyncService, CloudCoordinatorSettings,
// AssignedPlotFileSetup): signs in, reads the project, its project file and its assigned plot file, then saves its
// plots one by one, each save sent in a gzipped records:batch a moment later, sometimes a draft first, sometimes an
// edit of a plot already done; every 2 minutes it asks for the plot layout and the imagery windows. Each coordinator
// opens the dashboard's pages (progress, people, quality, map, review queue) as a person clicking through them.
//
// The phases: everyone signs in at the same moment (a mapathon starting at 9:00); a steady pace; a fast pace; a
// reconnection burst (everyone's internet comes back with a backlog of saves); a ceiling (saving without pause).
// At the end every plot each person saved is checked on the server: in the database when its address is given, and
// in the People tab's counts.
//
// Run it against a throwaway server, never a real one: it creates projects and accounts it does not delete.
//
//   STORE_BACKEND=postgres ... SETUP_CODE=LOADTEST RATE_LIMIT_PER_MINUTE=0 PORT=8095 node --import tsx src/index.ts
//   BASE=http://127.0.0.1:8095 SETUP_CODE=LOADTEST DB=postgres://ceown:pw@localhost:55481/ceload \
//     npx tsx scripts/load-mapathon.mts
//
// RATE_LIMIT_PER_MINUTE=0 on the server: every simulated person comes from this one address, where real ones have
// their own, so the per-address limit on signing in would refuse them.
//
// Settings (environment): MAPATHONS (2), PEOPLE per mapathon (30), PLOTS per mapathon (3000), SCALE to shorten every
// phase (1 = the durations below), SERVER_PID to sample the server's CPU and memory, OUT for the JSON report.
//
// Real Collect Earth instances (scripts/load-desktop.mts): DESKTOP people of each mapathon are left to them. They are
// signed up and given plots with the others, but not simulated: their names, password and an invitation to join with
// are written to HANDOFF (a JSON file); the phases start once HANDOFF.ready exists (the instances have joined), the
// end is said with HANDOFF.done, and the check waits for HANDOFF.synced (their saves are all sent). The check here
// leaves their plots to that script.
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { idOnlyCep } from '../test/fixtures/cep.js';

const BASE = (process.env.BASE ?? 'http://127.0.0.1:8095').replace(/\/+$/, '');
const SETUP_CODE = process.env.SETUP_CODE ?? 'LOADTEST';
const MAPATHONS = Number(process.env.MAPATHONS ?? 2);
const PEOPLE = Number(process.env.PEOPLE ?? 30);
const PLOTS = Number(process.env.PLOTS ?? 3000);
const SCALE = Number(process.env.SCALE ?? 1);
const SERVER_PID = process.env.SERVER_PID;
const DB = process.env.DB;
const OUT = process.env.OUT;
const DESKTOP = Number(process.env.DESKTOP ?? 0);
const HANDOFF = process.env.HANDOFF;
if (DESKTOP > 0 && !HANDOFF) throw new Error('DESKTOP needs HANDOFF, the file the desktop script reads');
const PASSWORD = 'load-test-password-12';

const LAND_USE = 'collect_code_land_use_category';
const FOREST = 'collect_integer_forest_percentage';
const CODES = ['F', 'C', 'G', 'W', 'S', 'O'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// --- measuring ----------------------------------------------------------------------------------------------------

interface Sample { ms: number; status: number }
const samples = new Map<string, Sample[]>();
let phase = 'setup';
const phaseOf = new Map<string, { start: number; end: number; records: number; batches: number }>();
const errors: string[] = [];

function record(label: string, ms: number, status: number) {
  const key = `${phase}|${label}`;
  if (!samples.has(key)) samples.set(key, []);
  samples.get(key)!.push({ ms, status });
}

async function call(label: string, method: string, path: string, token: string | null, body?: unknown, raw?: { data: Buffer; type: string; gzip?: boolean }) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (raw) {
    headers['content-type'] = raw.type;
    if (raw.gzip) headers['content-encoding'] = 'gzip';
    payload = new Uint8Array(raw.data);
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const started = performance.now();
  let status = 0;
  let text = '';
  try {
    const res = await fetch(BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(60_000) });
    status = res.status;
    text = await res.text();
  } catch (err) {
    text = String(err);
  }
  const ms = performance.now() - started;
  record(label, ms, status);
  // A server set up by an earlier run answers 409 to the setup: then the coordinator signs in
  if ((status === 0 || status >= 400) && !(label === 'setup' && status === 409)) {
    if (errors.length < 200) errors.push(`${phase} ${label} ${status} ${text.slice(0, 200)}`);
  }
  return { status, text, json: () => JSON.parse(text) };
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

// --- the server's process ----------------------------------------------------------------------------------------

const usage: { t: number; cpu: number; rssMb: number; phase: string }[] = [];
const ticks = 100;
function readProc(pid: string) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  const cpu = (Number(stat[11]) + Number(stat[12])) / ticks; // utime + stime, seconds
  const rss = Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096 / 1048576;
  return { cpu, rss };
}
function watchServer() {
  if (!SERVER_PID) return () => {};
  let last = readProc(SERVER_PID);
  let lastT = performance.now();
  const timer = setInterval(() => {
    try {
      const now = readProc(SERVER_PID);
      const t = performance.now();
      usage.push({ t, cpu: (now.cpu - last.cpu) / ((t - lastT) / 1000), rssMb: now.rss, phase });
      last = now;
      lastT = t;
    } catch {
      /* the server stopped */
    }
  }, 1000);
  return () => clearInterval(timer);
}

// --- the people --------------------------------------------------------------------------------------------------

interface Person { username: string; userId: string; token: string; plots: string[]; next: number; done: Map<string, number>; desktop?: boolean }
interface Mapathon { name: string; pid: string; fileId: string; people: Person[]; desktopInvite?: string }
let ownerToken = '';

/** A saved plot as Collect Earth sends it: the record's XML (about 16 KB, as a filled demo survey's) and its summary. */
function envelope(person: Person, plot: string, modifiedOn: number, activelySaved: boolean) {
  const land = CODES[Math.floor(Math.random() * CODES.length)];
  const forest = String(Math.floor(Math.random() * 101));
  const points = Array.from({ length: 120 }, (_, i) => `<point><n><value>${i + 1}</value></n><cover><value>${CODES[(i + plot.length) % CODES.length]}</value></cover></point>`).join('');
  const xml = `<plot><id><value>${plot}</value></id><round><value>1</value></round><operator><value>${person.username}</value></operator>`
    + `<land_use_category><value>${land}</value></land_use_category><forest_percentage><value>${forest}</value></forest_percentage>`
    + `<confidence><value>${activelySaved ? 'high' : ''}</value></confidence>${points}<comments><value>${'x'.repeat(200)}</value></comments></plot>`;
  return {
    recordKey: `${plot},1`, surveyUri: 'http://www.openforis.org/idm/demo', operator: person.username, modifiedOn,
    activelySaved, step: 1, xml, deleted: false, payloadVersion: 1,
    summary: { [LAND_USE]: land, [FOREST]: forest, collect_code_round: '1' },
  };
}

let modifiedClock = Date.now();
/** Sends saves in one records:batch, gzipped as the Java client sends them; remembers the newest of each plot. */
async function send(m: Mapathon, person: Person, saves: { plot: string; activelySaved: boolean }[]) {
  const envelopes = saves.map((s) => envelope(person, s.plot, ++modifiedClock, s.activelySaved));
  const data = gzipSync(Buffer.from(JSON.stringify({ records: envelopes }), 'utf8'));
  const res = await call(saves.length > 1 ? `records:batch (${saves.length} saves)` : 'records:batch (1 save)', 'POST', `/v1/projects/${m.pid}/records:batch`, person.token, undefined,
    { data, type: 'application/json', gzip: true });
  const stats = phaseOf.get(phase);
  if (stats) { stats.batches += 1; stats.records += saves.length; }
  if (res.status === 200) {
    const results = res.json().results as { recordKey: string; status: string }[];
    for (const [i, env] of envelopes.entries()) {
      const r = results?.[i];
      if (r && r.status !== 'error') person.done.set(env.recordKey, Math.max(person.done.get(env.recordKey) ?? 0, env.modifiedOn));
      else if (errors.length < 200) errors.push(`${phase} record ${env.recordKey} ${JSON.stringify(r)}`);
    }
  }
}

/** The next plot to save: the next of the person's own, or once all are done an edit of one of them. */
function nextPlot(p: Person): { plot: string; edit: boolean } {
  if (p.next < p.plots.length) return { plot: p.plots[p.next++], edit: false };
  return { plot: p.plots[Math.floor(Math.random() * p.plots.length)], edit: true };
}

async function setup(): Promise<Mapathon[]> {
  let res = await call('setup', 'POST', '/v1/setup', null, { setupCode: SETUP_CODE, username: 'coordinator', password: PASSWORD });
  if (res.status === 201) ownerToken = res.json().token;
  else {
    res = await call('login', 'POST', '/v1/auth/login', null, { username: 'coordinator', password: PASSWORD });
    if (res.status !== 200) throw new Error(`cannot set up or sign in: ${res.status} ${res.text}`);
    ownerToken = res.json().token;
  }
  const cep = idOnlyCep();
  const runId = Date.now().toString(36);
  const mapathons: Mapathon[] = [];
  for (let i = 1; i <= MAPATHONS; i++) {
    const name = `Mapathon ${i} (${runId})`;
    const pid = (await call('create project', 'POST', '/v1/projects', ownerToken, { name })).json().projectId as string;
    await call('upload project file', 'PUT', `/v1/projects/${pid}/cep`, ownerToken, undefined, { data: cep, type: 'application/zip' });
    // Plots spread over a country-sized box, as a real grid, with the columns the demo survey reads from its plot file
    // (its round column is added by the server); Collect Earth refuses a plot file without them
    const rows = ['id,YCoordinate,XCoordinate,elevation,slope,aspect,climate,soil,gez,country,province,district'];
    for (let p = 1; p <= PLOTS; p++) {
      rows.push(`${p},${(-10 + Math.random() * 8).toFixed(6)},${(30 + Math.random() * 8).toFixed(6)},${Math.floor(between(0, 2500))},${Math.floor(between(0, 40))},`
        + `${Math.floor(between(0, 360))},${Math.floor(between(1, 12))},${Math.floor(between(1, 8))},${Math.floor(between(1, 30))},Tanzania,Region ${1 + (p % 9)},not set`);
    }
    const up = await call('upload plot file', 'PUT', `/v1/projects/${pid}/csv-files/plots.csv`, ownerToken, undefined, { data: Buffer.from(rows.join('\n')), type: 'text/csv' });
    const fileId = up.json().id as string;
    const invite = await call('invite', 'POST', `/v1/projects/${pid}/invites`, ownerToken, { role: 'operator', maxUses: PEOPLE });
    const inviteToken = invite.json().inviteToken as string;
    const people: Person[] = [];
    // The people sign up from the invitation link, a few at a time as they arrive
    for (let start = 0; start < PEOPLE; start += 10) {
      const batch = await Promise.all(Array.from({ length: Math.min(10, PEOPLE - start) }, async (_, k) => {
        const username = `m${i}-${runId}-c${String(start + k + 1).padStart(2, '0')}`;
        const r = await call('register', 'POST', '/v1/auth/register', null, { username, password: PASSWORD, inviteToken });
        if (r.status !== 201 && r.status !== 200) throw new Error(`register ${username}: ${r.status} ${r.text}`);
        return { username, userId: r.json().userId, token: '', plots: [], next: 0, done: new Map() } as Person;
      }));
      people.push(...batch);
    }
    const divided = await call('divide plots', 'PUT', `/v1/projects/${pid}/csv-files/${fileId}/distribution`, ownerToken, { mode: 'even', people: people.map((p) => p.userId), order: 'file' });
    if (divided.status !== 200) throw new Error(`divide: ${divided.status} ${divided.text}`);
    // The last DESKTOP people are real Collect Earths: they join with a link of their own (members keep their plots)
    let desktopInvite: string | undefined;
    if (DESKTOP > 0) {
      for (const p of people.slice(-DESKTOP)) p.desktop = true;
      desktopInvite = (await call('invite', 'POST', `/v1/projects/${pid}/invites`, ownerToken, { role: 'operator', maxUses: DESKTOP })).json().inviteToken;
    }
    mapathons.push({ name, pid, fileId, people, desktopInvite });
  }
  return mapathons;
}

/** Collect Earth starting in the cloud project: signs in, reads the project, its file and its own plot file. */
async function startCollectEarth(m: Mapathon, p: Person) {
  const login = await call('login', 'POST', '/v1/auth/login', null, { username: p.username, password: PASSWORD });
  p.token = login.json().token;
  await call('project', 'GET', `/v1/projects/${m.pid}`, p.token);
  await call('project file (cep)', 'GET', `/v1/projects/${m.pid}/cep`, p.token);
  const mine = await call('my-assignment', 'GET', `/v1/projects/${m.pid}/my-assignment`, p.token);
  const a = (mine.json().assignments as { downloadPath: string }[])[0];
  const file = await call('assigned plot file', 'GET', a.downloadPath, p.token);
  p.plots = file.text.split('\n').slice(1).filter((l) => /^\d+,/.test(l)).map((l) => l.split(',')[0]);
  await call('plot-layout', 'GET', `/v1/projects/${m.pid}/plot-layout`, p.token);
  await call('imagery', 'GET', `/v1/projects/${m.pid}/imagery`, p.token);
}

/** A collector for `ms`: a plot every `pace` ms (one way or the other), each sent 3 s after its save, as CloudSyncService does. */
async function collect(m: Mapathon, p: Person, ms: number, pace: [number, number]) {
  const end = performance.now() + ms;
  let settingsAt = performance.now() + between(0, 120_000 * SCALE);
  const pending: Promise<void>[] = [];
  while (performance.now() < end) {
    await sleep(between(pace[0], pace[1]));
    const { plot, edit } = nextPlot(p);
    // A quarter of the plots saved first as a draft (not actively saved), then finished
    if (!edit && Math.random() < 0.25) {
      pending.push(sleep(3000 * SCALE).then(() => send(m, p, [{ plot, activelySaved: false }])));
      await sleep(between(pace[0], pace[1]) / 2);
    }
    pending.push(sleep(3000 * SCALE).then(() => send(m, p, [{ plot, activelySaved: true }])));
    if (performance.now() > settingsAt) {
      settingsAt = performance.now() + 120_000 * SCALE;
      await call('plot-layout', 'GET', `/v1/projects/${m.pid}/plot-layout`, p.token);
      await call('imagery', 'GET', `/v1/projects/${m.pid}/imagery`, p.token);
    }
  }
  await Promise.all(pending);
}

/** A coordinator clicking through the dashboard: a page every few seconds. */
async function coordinate(m: Mapathon, ms: number, every: [number, number]) {
  const pages: [string, string][] = [
    ['dashboard: progress', `/v1/projects/${m.pid}/progress`],
    ['dashboard: people', `/v1/projects/${m.pid}/people`],
    ['dashboard: quality', `/v1/projects/${m.pid}/quality`],
    ['dashboard: map', `/v1/projects/${m.pid}/map/plots`],
    ['dashboard: review queue', `/v1/projects/${m.pid}/quality/queue`],
    ['dashboard: plot file', `/v1/projects/${m.pid}/csv-files/${m.fileId}/distribution`],
  ];
  const end = performance.now() + ms;
  let i = 0;
  while (performance.now() < end) {
    const [label, path] = pages[i++ % pages.length];
    await call(label, 'GET', path, ownerToken);
    await sleep(between(every[0], every[1]));
  }
}

async function runPhase(name: string, body: () => Promise<unknown>) {
  phase = name;
  const stats = { start: performance.now(), end: 0, records: 0, batches: 0 };
  phaseOf.set(name, stats);
  process.stderr.write(`${new Date().toISOString()} ${name}...\n`);
  await body();
  stats.end = performance.now();
}

// --- the run -----------------------------------------------------------------------------------------------------

const stopWatching = watchServer();
const setupStart = performance.now();
const mapathons = await setup();
const setupMs = performance.now() - setupStart;
const everyone = mapathons.flatMap((m) => m.people.filter((p) => !p.desktop).map((p) => ({ m, p })));
const desktopNames = new Set(mapathons.flatMap((m) => m.people.filter((p) => p.desktop).map((p) => p.username)));
const waitFor = async (file: string, what: string, minutes: number) => {
  const until = Date.now() + minutes * 60_000;
  process.stderr.write(`${new Date().toISOString()} waiting for ${what} (${file})...\n`);
  while (!existsSync(file)) {
    if (Date.now() > until) throw new Error(`gave up waiting for ${what}`);
    await sleep(2000);
  }
};
if (HANDOFF && DESKTOP > 0) {
  writeFileSync(HANDOFF, JSON.stringify({
    base: BASE, password: PASSWORD,
    mapathons: mapathons.map((m) => ({ name: m.name, pid: m.pid, inviteToken: m.desktopInvite, people: m.people.filter((p) => p.desktop).map((p) => p.username) })),
  }, null, 2));
  await waitFor(`${HANDOFF}.ready`, 'the Collect Earth instances to join', 20);
}
const coordinators = (ms: number) => mapathons.map((m) => coordinate(m, ms, [3000, 8000]));

// 1. 9:00: everyone opens Collect Earth at the same moment
await runPhase('1 everyone starts at once', () => Promise.all(everyone.map(({ m, p }) => startCollectEarth(m, p))));

// 2. A steady pace: a plot every 45-90 s (a real person's minute or so on a plot)
const STEADY = 5 * 60_000 * SCALE;
await runPhase('2 steady pace (a plot every 45-90 s)', () => Promise.all([
  ...everyone.map(({ m, p }) => collect(m, p, STEADY, [45_000 * SCALE, 90_000 * SCALE])),
  ...coordinators(STEADY),
]));

// 3. Fast: a plot every 5-10 s, ten times a real pace (60 people working like 600)
const FAST = 4 * 60_000 * SCALE;
await runPhase('3 ten times the pace (a plot every 5-10 s)', () => Promise.all([
  ...everyone.map(({ m, p }) => collect(m, p, FAST, [5_000 * SCALE, 10_000 * SCALE])),
  ...coordinators(FAST),
]));

// 4. The internet comes back: everyone sends a backlog of 50 saves (a batch, as CloudSyncService takes 50) at once, 3 times
await runPhase(`4 reconnection burst (${everyone.length} people x 50 saves at once, 3 times)`, async () => {
  for (let round = 0; round < 3; round++) {
    await Promise.all(everyone.map(({ m, p }) => send(m, p, Array.from({ length: 50 }, () => ({ plot: nextPlot(p).plot, activelySaved: true })))));
    await sleep(10_000 * SCALE);
  }
});

// 5. The ceiling: no pause, each person sending batches of 10 saves back to back for 60 s, the coordinators clicking fast
const CEILING = 60_000 * SCALE;
await runPhase('5 ceiling (no pause, batches of 10)', () => Promise.all([
  ...everyone.map(async ({ m, p }) => {
    const end = performance.now() + CEILING;
    while (performance.now() < end) await send(m, p, Array.from({ length: 10 }, () => ({ plot: nextPlot(p).plot, activelySaved: true })));
  }),
  ...mapathons.map((m) => coordinate(m, CEILING, [500, 1500])),
]));
phase = 'check';
if (HANDOFF && DESKTOP > 0) {
  writeFileSync(`${HANDOFF}.done`, new Date().toISOString());
  await waitFor(`${HANDOFF}.synced`, 'the Collect Earth instances to send their saves', 15);
}
await sleep(2000);
stopWatching();

// --- the check: every plot saved is there, its newest version, nobody else's ---------------------------------------

const checks: { what: string; ok: boolean; detail?: string }[] = [];
for (const m of mapathons) {
  const expected = new Map<string, number>(); // "operator recordKey" -> newest modifiedOn
  for (const p of m.people.filter((q) => !q.desktop)) for (const [key, at] of p.done) expected.set(`${p.username} ${key}`, at);
  if (DB) {
    const client = new pg.Client({ connectionString: DB });
    await client.connect();
    // The Collect Earth instances' plots are load-desktop.mts's to check
    const rows = ((await client.query('SELECT operator, record_key, modified_on FROM records WHERE project_id = $1 AND NOT deleted', [m.pid])).rows as { operator: string; record_key: string; modified_on: Date }[])
      .filter((r) => !desktopNames.has(r.operator));
    await client.end();
    const stored = new Map(rows.map((r) => [`${r.operator} ${r.record_key}`, r.modified_on.getTime()]));
    const missing = [...expected.keys()].filter((k) => !stored.has(k));
    const extra = [...stored.keys()].filter((k) => !expected.has(k));
    const older = [...expected].filter(([k, at]) => stored.has(k) && stored.get(k)! !== at);
    checks.push({ what: `${m.name}: database has each saved plot once (${expected.size})`, ok: missing.length === 0 && extra.length === 0 && rows.length === expected.size, detail: `stored ${rows.length}, missing ${missing.length}, unexpected ${extra.length}` });
    checks.push({ what: `${m.name}: database keeps the newest save of each plot`, ok: older.length === 0, detail: older.slice(0, 3).map(([k]) => k).join('; ') });
  }
  // The People tab: each person's plots done, as the coordinator sees them
  const people = (await call('dashboard: people', 'GET', `/v1/projects/${m.pid}/people`, ownerToken)).json();
  const list = (people.people ?? people.rows ?? []) as Record<string, unknown>[];
  checks.push({ what: `${m.name}: the People tab lists the ${m.people.length} collectors`, ok: m.people.every((p) => list.some((r) => r.username === p.username)), detail: `${list.length} listed` });
}

// --- the report --------------------------------------------------------------------------------------------------

const report: Record<string, unknown> = { base: BASE, mapathons: MAPATHONS, peoplePerMapathon: PEOPLE, plotsPerMapathon: PLOTS, scale: SCALE, setupSeconds: +(setupMs / 1000).toFixed(1), phases: [] as unknown[], checks, errors: errors.slice(0, 50) };
const lines: string[] = [];
lines.push(`Setup: ${MAPATHONS} mapathons x ${PEOPLE} people, ${PLOTS} plots each, in ${(setupMs / 1000).toFixed(1)} s`);
for (const [name, st] of phaseOf) {
  const secs = (st.end - st.start) / 1000;
  const cpu = usage.filter((u) => u.phase === name);
  const cpuAvg = cpu.length ? cpu.reduce((s, u) => s + u.cpu, 0) / cpu.length : NaN;
  const cpuMax = cpu.length ? Math.max(...cpu.map((u) => u.cpu)) : NaN;
  const rssMax = cpu.length ? Math.max(...cpu.map((u) => u.rssMb)) : NaN;
  const endpoints: Record<string, unknown>[] = [];
  lines.push('');
  lines.push(`== ${name}: ${secs.toFixed(0)} s, ${st.records} saves in ${st.batches} batches (${(st.records / secs).toFixed(1)} saves/s)` + (cpu.length ? `, server CPU avg ${(cpuAvg * 100).toFixed(0)}% max ${(cpuMax * 100).toFixed(0)}% of a core, memory up to ${rssMax.toFixed(0)} MB` : ''));
  lines.push('   endpoint                          calls   errors   median    p95     p99     max   (ms)');
  for (const [key, list] of [...samples].filter(([k]) => k.startsWith(name + '|')).sort()) {
    const label = key.split('|')[1];
    const ms = list.map((s) => s.ms).sort((a, b) => a - b);
    const bad = list.filter((s) => s.status === 0 || s.status >= 400).length;
    const row = { endpoint: label, calls: list.length, errors: bad, median: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: ms.at(-1) ?? 0 };
    endpoints.push(row);
    lines.push(`   ${label.padEnd(32)} ${String(row.calls).padStart(6)} ${String(bad).padStart(8)} ${row.median.toFixed(0).padStart(8)} ${row.p95.toFixed(0).padStart(6)} ${row.p99.toFixed(0).padStart(7)} ${row.max.toFixed(0).padStart(7)}`);
  }
  (report.phases as unknown[]).push({ name, seconds: secs, saves: st.records, batches: st.batches, cpuAvg, cpuMax, rssMaxMb: rssMax, endpoints });
}
lines.push('');
for (const c of checks) lines.push(`${c.ok ? 'ok  ' : 'FAIL'} ${c.what}${c.detail ? ` (${c.detail})` : ''}`);
if (errors.length) {
  lines.push('');
  lines.push(`${errors.length} errors, the first ones:`);
  for (const e of errors.slice(0, 10)) lines.push(`  ${e}`);
}
console.log(lines.join('\n'));
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
