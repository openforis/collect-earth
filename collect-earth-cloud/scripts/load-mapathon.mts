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
// At the end every plot each person saved is checked on the server: through the API, each person's submitted plots in
// the People tab against the plots whose newest save was complete; and row by row in the database when its address is
// given (DB).
//
// A server of this computer, set up by the script with its setup code:
//
//   STORE_BACKEND=postgres ... SETUP_CODE=LOADTEST RATE_LIMIT_PER_MINUTE=0 PORT=8095 node --import tsx src/index.ts
//   BASE=http://127.0.0.1:8095 SETUP_CODE=LOADTEST DB=postgres://ceown:pw@localhost:55481/ceload \
//     npx tsx scripts/load-mapathon.mts
//
// RATE_LIMIT_PER_MINUTE=0 on the server: every simulated person comes from this one address, where real ones have
// their own, so the per-address limit on signing in would refuse them.
//
// A deployed server (a staging copy, never the one people work on: the ceiling phase pushes it as hard as it goes):
// signed in with an account of its administrator, made for the test; its sign-ins paced under the per-address limit
// (AUTH_PER_MINUTE) unless the staging copy runs with a high RATE_LIMIT_PER_MINUTE; everything it made deleted at the end
// (CLEANUP=1).
//
//   BASE=https://staging.example.org ADMIN_USER=loadtest ADMIN_PASSWORD_FILE=~/.loadtest-password AUTH_PER_MINUTE=50 \
//     CLEANUP=1 npx tsx scripts/load-mapathon.mts
//
// Settings (environment): MAPATHONS (2), PEOPLE per mapathon (30), PLOTS per mapathon (3000), SCALE to shorten every
// phase (1 = the durations below), PHASES to run only some ("1,2,3": without the burst and the ceiling), SERVER_PID to
// sample the server's CPU and memory (a server of this computer), OUT for the JSON report.
//
// The people's accounts get a password of this run (written to HANDOFF for the Collect Earth instances), so that no
// account made on a deployed server has one written here.
//
// A training day first (TRAINING, the plots each person trains on: docs/plans/2026-11-17-training-the-team.md): each
// mapathon's coordinator copies TRAINING plots of the project's plot file into a training set for everyone in the
// project; the people join before any plot is theirs, so Collect Earth opens the training by itself; they answer the
// training plots ("T training"); the coordinator finishes the training (its answers deleted, its scores kept) and divides
// the project's plots between them (the project's plots, divided once); Collect Earth sends the training away and brings
// each person's plots; then the phases below. Checked too: every person's training answers reached the server, a
// training answer sent after the finish is thrown away (stale), my-assignment says the training is over, and nobody's
// counts hold a training plot.
//
// A server open to sign-ups (SIGNUP=1, its settings: signup open, anyone may make projects): each mapathon's
// coordinator is an account the script signs up, of this run's password, instead of a server administrator.
//
// The survey (CEP_FILE, a .cep): Collect Earth's demo survey (resources/demo_survey.cep, the IPCC land use categories,
// sub-divisions and changes) for a run as people would run one; its plot files get the columns of its own plot file.
// Without it, a survey of a plot id only.
//
// Real Collect Earth instances (scripts/load-desktop.mts): DESKTOP people of each mapathon are left to them. They are
// signed up and given plots with the others, but not simulated: their names, password and an invitation to join with
// are written to HANDOFF (a JSON file); the phases start once HANDOFF.ready exists (the instances have joined), the
// end is said with HANDOFF.done, and the check waits for HANDOFF.synced (their saves are all sent). The check here
// leaves their plots to that script.
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { strFromU8, unzipSync } from 'fflate';
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
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_FILE ? readFileSync(process.env.ADMIN_PASSWORD_FILE.replace(/^~/, process.env.HOME ?? ''), 'utf8').trim() : process.env.ADMIN_PASSWORD;
if (ADMIN_USER && !ADMIN_PASSWORD) throw new Error('ADMIN_USER needs ADMIN_PASSWORD or ADMIN_PASSWORD_FILE');
const AUTH_PER_MINUTE = Number(process.env.AUTH_PER_MINUTE ?? 0);
const PHASES = new Set((process.env.PHASES ?? '1,2,3,4,5').split(',').map((x) => x.trim()));
const CLEANUP = process.env.CLEANUP === '1';
const SIGNUP = process.env.SIGNUP === '1';
const CEP_FILE = process.env.CEP_FILE;
/** The plots each person trains on before the collection (0: no training day) */
const TRAINING = Number(process.env.TRAINING ?? 0);
const [TRAIN_LO, TRAIN_HI] = (process.env.TRAINING_PACE_S ?? '30-60').split('-').map(Number);
/** The people's password, of this run only */
const PASSWORD = `load-${randomBytes(12).toString('base64url')}`;
/** The coordinator of a server the script sets up itself (no ADMIN_USER): its password is the run's too */
const SETUP_USER = 'coordinator';

/** The project file, its survey's URI and its plot file's header (the columns Collect Earth reads from a plot file) */
const survey = (() => {
  if (!CEP_FILE) return { cep: idOnlyCep(), uri: 'http://www.openforis.org/idm/demo', header: 'id,YCoordinate,XCoordinate,elevation,slope,aspect,climate,soil,gez,country,province,district', round: false };
  const cep = readFileSync(CEP_FILE.replace(/^~/, process.env.HOME ?? ''));
  const files = unzipSync(new Uint8Array(cep));
  const properties = strFromU8(files['project_definition.properties']);
  const csv = /^csv=\$\{project_path\}\/(.*)$/m.exec(properties)?.[1]?.trim();
  const header = csv && files[csv] ? strFromU8(files[csv]).split(/\r?\n/)[0].replace(/^\uFEFF/, '') : 'id,YCoordinate,XCoordinate';
  const uri = /<uri>([^<]+)<\/uri>/.exec(strFromU8(files['placemark.idm.xml']))?.[1] ?? 'http://www.openforis.org/idm/demo';
  return { cep: Buffer.from(cep), uri, header, round: header.split(',')[1] === 'round' };
})();

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

/** The times of the sign-ups and sign-ins of the last minute, kept under AUTH_PER_MINUTE (the server's per-address limit) */
const authTimes: number[] = [];
async function authSlot() {
  for (;;) {
    const now = Date.now();
    while (authTimes.length && authTimes[0] <= now - 60_000) authTimes.shift();
    if (authTimes.length < AUTH_PER_MINUTE) {
      authTimes.push(now);
      return;
    }
    await sleep(authTimes[0] + 60_000 - now + 50);
  }
}

async function call(label: string, method: string, path: string, token: string | null, body?: unknown, raw?: { data: Buffer; type: string; gzip?: boolean }) {
  if (AUTH_PER_MINUTE > 0 && (label === 'login' || label === 'register' || label === 'signup')) await authSlot();
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

interface Person {
  username: string; userId: string; token: string; plots: string[]; next: number;
  /** plot -> the newest save stored (its modifiedOn) and whether it was complete (actively saved): the project's plots only */
  done: Map<string, number>; complete: Map<string, boolean>; desktop?: boolean;
}
interface Person2 { training: string[]; trainingDone: Map<string, boolean>; staleAnswer?: string; toldOver?: boolean }
interface Mapathon {
  name: string; pid: string; fileId: string; people: Person[]; desktopInvite?: string;
  /** The coordinator's session: the server administrator's, or with SIGNUP the mapathon's own coordinator's */
  token: string; coordinator: string; trainingSetId?: string;
}
/** Each person's training (with TRAINING): the plots of the training set, and which were saved (complete or not) */
const trainingOf = new Map<Person, Person2>();
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
    recordKey: `${plot},1`, surveyUri: survey.uri, operator: person.username, modifiedOn,
    activelySaved, step: 1, xml, deleted: false, payloadVersion: 1,
    summary: { [LAND_USE]: land, [FOREST]: forest, collect_code_round: '1' },
  };
}

let modifiedClock = Date.now();
/** Sends saves in one records:batch, gzipped as the Java client sends them; remembers the newest of each plot. */
async function send(m: Mapathon, person: Person, saves: { plot: string; activelySaved: boolean }[], training = false) {
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
      if (training && r) {
        // A training answer: kept apart (training_records), or after the finish thrown away (stale)
        const t = trainingOf.get(person)!;
        if (r.status === 'stale') t.staleAnswer = r.status;
        else if (r.status !== 'error') t.trainingDone.set(env.recordKey, env.activelySaved || t.trainingDone.get(env.recordKey) === true);
        else if (errors.length < 200) errors.push(`${phase} training record ${env.recordKey} ${JSON.stringify(r)}`);
      } else if (r && r.status !== 'error') {
        if (env.modifiedOn >= (person.done.get(env.recordKey) ?? 0)) person.complete.set(env.recordKey, env.activelySaved);
        person.done.set(env.recordKey, Math.max(person.done.get(env.recordKey) ?? 0, env.modifiedOn));
      }
      else if (errors.length < 200) errors.push(`${phase} record ${env.recordKey} ${JSON.stringify(r)}`);
    }
  }
}

/** The next plot to save: the next of the person's own, or once all are done an edit of one of them. */
function nextPlot(p: Person): { plot: string; edit: boolean } {
  if (p.next < p.plots.length) return { plot: p.plots[p.next++], edit: false };
  return { plot: p.plots[Math.floor(Math.random() * p.plots.length)], edit: true };
}

/** A plot of the survey's plot file: its id (and round), its place in a country-sized box, the other columns made up */
function plotRow(p: number): string {
  const lat = (-10 + Math.random() * 8).toFixed(6);
  const lon = (30 + Math.random() * 8).toFixed(6);
  const made: Record<string, string> = {
    elevation: String(Math.floor(between(0, 2500))), slope: String(Math.floor(between(0, 40))), aspect: String(Math.floor(between(0, 360))),
    climate: String(Math.floor(between(1, 12))), soil: String(Math.floor(between(1, 8))), gez: String(Math.floor(between(1, 30))),
    country: 'Tanzania', province: `Region ${1 + (p % 9)}`, district: 'not set',
  };
  return survey.header.split(',').map((column, i) => {
    if (i === 0) return String(p);
    if (column === 'round') return '1';
    if (/^(YCoordinate|lat|latitude)$/i.test(column)) return lat;
    if (/^(XCoordinate|lon|long|longitude)$/i.test(column)) return lon;
    return made[column] ?? '';
  }).join(',');
}

async function setup(): Promise<Mapathon[]> {
  if (SIGNUP) {
    // Each mapathon's coordinator signs up below
  } else if (ADMIN_USER) {
    // A deployed server: its administrator's account, never its setup
    const res = await call('login', 'POST', '/v1/auth/login', null, { username: ADMIN_USER, password: ADMIN_PASSWORD });
    if (res.status !== 200) throw new Error(`cannot sign in as ${ADMIN_USER}: ${res.status} ${res.text}`);
    ownerToken = res.json().token;
  } else {
    // A server of this computer: set up by the script (or set up by an earlier run, whose coordinator's password was LOADTEST's)
    const setupPassword = `${SETUP_CODE}-coordinator`;
    let res = await call('setup', 'POST', '/v1/setup', null, { setupCode: SETUP_CODE, username: SETUP_USER, password: setupPassword });
    if (res.status === 201) ownerToken = res.json().token;
    else {
      res = await call('login', 'POST', '/v1/auth/login', null, { username: SETUP_USER, password: setupPassword });
      if (res.status !== 200) throw new Error(`cannot set up or sign in: ${res.status} ${res.text} (with ADMIN_USER the script signs in with an existing account)`);
      ownerToken = res.json().token;
    }
  }
  const cep = survey.cep;
  const runId = Date.now().toString(36);
  const mapathons: Mapathon[] = [];
  for (let i = 1; i <= MAPATHONS; i++) {
    const name = `Mapathon ${i} (${runId})`;
    let token = ownerToken;
    let coordinator = ADMIN_USER ?? SETUP_USER;
    if (SIGNUP) {
      coordinator = `m${i}-${runId}-coordinator`;
      const r = await call('signup', 'POST', '/v1/auth/signup', null, { username: coordinator, password: PASSWORD, acceptTerms: true });
      if (r.status !== 201 && r.status !== 200) throw new Error(`signup ${coordinator}: ${r.status} ${r.text}`);
      token = r.json().token as string;
      if (!token) token = (await call('login', 'POST', '/v1/auth/login', null, { username: coordinator, password: PASSWORD })).json().token;
      if (!ownerToken) ownerToken = token;
    }
    const created = await call('create project', 'POST', '/v1/projects', token, { name });
    if (created.status !== 201 && created.status !== 200) throw new Error(`create project: ${created.status} ${created.text}`);
    const pid = created.json().projectId as string;
    const uploaded = await call('upload project file', 'PUT', `/v1/projects/${pid}/cep`, token, undefined, { data: cep, type: 'application/zip' });
    if (uploaded.status >= 300) throw new Error(`upload project file: ${uploaded.status} ${uploaded.text}`);
    // Plots spread over a country-sized box, as a real grid, with the columns the survey reads from its plot file
    // (a survey of an id only: its round column is added by the server); Collect Earth refuses a plot file without them
    const rows = [survey.header];
    for (let p = 1; p <= PLOTS; p++) rows.push(plotRow(p));
    const up = await call('upload plot file', 'PUT', `/v1/projects/${pid}/csv-files/plots.csv`, token, undefined, { data: Buffer.from(rows.join('\n')), type: 'text/csv' });
    if (up.status >= 300) throw new Error(`upload plot file: ${up.status} ${up.text}`);
    const fileId = up.json().id as string;
    // The training day: TRAINING plots of the plot file, copied under new ids, for everyone in the project
    let trainingSetId: string | undefined;
    if (TRAINING > 0) {
      const set = await call('training: copy plots', 'POST', `/v1/projects/${pid}/training-sets/from-plot-file`, token,
        { name: 'Training day', kind: 'calibration', csvFileId: fileId, count: TRAINING, everyone: true });
      if (set.status !== 201) throw new Error(`training set: ${set.status} ${set.text}`);
      trainingSetId = set.json().id as string;
    }
    const invite = await call('invite', 'POST', `/v1/projects/${pid}/invites`, token, { role: 'operator', maxUses: PEOPLE });
    const inviteToken = invite.json().inviteToken as string;
    const people: Person[] = [];
    // The people sign up from the invitation link, a few at a time as they arrive
    for (let start = 0; start < PEOPLE; start += 10) {
      const batch = await Promise.all(Array.from({ length: Math.min(10, PEOPLE - start) }, async (_, k) => {
        const username = `m${i}-${runId}-c${String(start + k + 1).padStart(2, '0')}`;
        const r = await call('register', 'POST', '/v1/auth/register', null, { username, password: PASSWORD, inviteToken });
        if (r.status !== 201 && r.status !== 200) throw new Error(`register ${username}: ${r.status} ${r.text}`);
        return { username, userId: r.json().userId, token: '', plots: [], next: 0, done: new Map(), complete: new Map() } as Person;
      }));
      people.push(...batch);
    }
    // With a training day the plots are divided once it is over: nobody holds a plot while training, so Collect Earth
    // opens the training by itself
    if (TRAINING === 0) {
      const divided = await call('divide plots', 'PUT', `/v1/projects/${pid}/csv-files/${fileId}/distribution`, token, { mode: 'even', people: people.map((p) => p.userId), order: 'file' });
      if (divided.status !== 200) throw new Error(`divide: ${divided.status} ${divided.text}`);
    }
    // The last DESKTOP people are real Collect Earths: they join with a link of their own (members keep their plots)
    let desktopInvite: string | undefined;
    if (DESKTOP > 0) {
      for (const p of people.slice(-DESKTOP)) p.desktop = true;
      desktopInvite = (await call('invite', 'POST', `/v1/projects/${pid}/invites`, token, { role: 'operator', maxUses: DESKTOP })).json().inviteToken;
    }
    mapathons.push({ name, pid, fileId, people, desktopInvite, token, coordinator, trainingSetId });
  }
  return mapathons;
}

/** The plot ids of a plot file (its first column), its header row left out */
const idsOf = (text: string) => text.split(/\r?\n/).slice(1).filter((l) => l.trim() !== '').map((l) => l.split(',')[0]);

/**
 * The person's plots, as Collect Earth asks for them (MyPlotsService): their version, then the file when it changed.
 * Without a person's plots (an older server), the first assigned plot file, as before.
 */
let myPlotsRoute = true;
async function readMyPlots(m: Mapathon, p: Person, version: { v?: string }) {
  if (myPlotsRoute) {
    const res = await call('my-plots', 'GET', `/v1/projects/${m.pid}/my-plots`, p.token);
    if (res.status === 404) myPlotsRoute = false;
    else if (res.status === 200) {
      const answer = res.json() as { version: string; plots: number; downloadPath: string };
      if (answer.version !== version.v) {
        version.v = answer.version;
        if (answer.plots === 0) p.plots = [];
        else p.plots = idsOf((await call('my-plots.csv', 'GET', `${answer.downloadPath}&plotFile=1`, p.token)).text);
      }
      return;
    }
  }
  const mine = await call('my-assignment', 'GET', `/v1/projects/${m.pid}/my-assignment`, p.token);
  const a = (mine.json().assignments as { downloadPath: string; training?: unknown }[]).find((x) => !x.training);
  if (a) p.plots = idsOf((await call('assigned plot file', 'GET', a.downloadPath, p.token)).text);
}

/** Each person's version of their plots, as Collect Earth keeps it */
const versions = new Map<Person, { v?: string }>();

/**
 * The training sets on offer, as Collect Earth's five-minute check asks (TrainingPlotFiles): the training's plots taken
 * when there is one (opened by itself: the person holds no plot yet), and what the server says of a training over.
 */
async function readTraining(m: Mapathon, p: Person): Promise<{ finished: boolean }> {
  const mine = await call('my-assignment', 'GET', `/v1/projects/${m.pid}/my-assignment`, p.token);
  const answer = mine.json() as { assignments: { downloadPath: string; training?: unknown }[]; finishedTraining?: { plots: string[] } };
  const set = answer.assignments.find((a) => a.training);
  if (set && trainingOf.get(p)!.training.length === 0) {
    trainingOf.get(p)!.training = idsOf((await call('training plot file', 'GET', set.downloadPath, p.token)).text);
  }
  return { finished: (answer.finishedTraining?.plots.length ?? 0) > 0 };
}

/** Collect Earth starting in the cloud project: signs in, reads the project, its file, the person's plots and the training. */
async function startCollectEarth(m: Mapathon, p: Person) {
  const login = await call('login', 'POST', '/v1/auth/login', null, { username: p.username, password: PASSWORD });
  p.token = login.json().token;
  await call('project', 'GET', `/v1/projects/${m.pid}`, p.token);
  await call('project file (cep)', 'GET', `/v1/projects/${m.pid}/cep`, p.token);
  if (!versions.has(p)) versions.set(p, {});
  if (!trainingOf.has(p)) trainingOf.set(p, { training: [], trainingDone: new Map() });
  await readMyPlots(m, p, versions.get(p)!);
  await readTraining(m, p);
  await call('plot-layout', 'GET', `/v1/projects/${m.pid}/plot-layout`, p.token);
  await call('imagery', 'GET', `/v1/projects/${m.pid}/imagery`, p.token);
}

/** A person on the training day: every training plot answered, one at a time (a quarter as a draft first) */
async function train(m: Mapathon, p: Person, pace: [number, number]) {
  const t = trainingOf.get(p)!;
  const pending: Promise<void>[] = [];
  for (const plot of t.training) {
    await sleep(between(pace[0], pace[1]));
    if (Math.random() < 0.25) {
      pending.push(sleep(3000 * SCALE).then(() => send(m, p, [{ plot, activelySaved: false }], true)));
      await sleep(between(pace[0], pace[1]) / 2);
    }
    pending.push(sleep(3000 * SCALE).then(() => send(m, p, [{ plot, activelySaved: true }], true)));
  }
  await Promise.all(pending);
}

/** A coordinator following the training on the dashboard: the training tab, the set, the figures */
async function watchTraining(m: Mapathon, until: () => boolean, every: [number, number]) {
  const pages: [string, string][] = [
    ['dashboard: training', `/v1/projects/${m.pid}/training`],
    ['dashboard: training set', `/v1/projects/${m.pid}/training/${m.trainingSetId}`],
    ['dashboard: training figures', `/v1/projects/${m.pid}/training/figures`],
  ];
  let i = 0;
  while (!until()) {
    const [label, path] = pages[i++ % pages.length];
    await call(label, 'GET', path, m.token);
    await sleep(between(every[0], every[1]));
  }
}

/** A collector for `ms`: a plot every `pace` ms (one way or the other), each sent 3 s after its save, as CloudSyncService does. */
async function collect(m: Mapathon, p: Person, ms: number, pace: [number, number]) {
  const end = performance.now() + ms;
  let settingsAt = performance.now() + between(0, 120_000 * SCALE);
  // Collect Earth's check of the person's plots and of the training sets, every five minutes (MyPlotsService)
  let plotsAt = performance.now() + between(0, 300_000 * SCALE);
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
    if (performance.now() > plotsAt) {
      plotsAt = performance.now() + 300_000 * SCALE;
      await readMyPlots(m, p, versions.get(p) ?? {});
      await readTraining(m, p);
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
    await call(label, 'GET', path, m.token);
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
    base: BASE, password: PASSWORD, coordinatorToken: ownerToken, training: TRAINING,
    mapathons: mapathons.map((m) => ({ name: m.name, pid: m.pid, inviteToken: m.desktopInvite, coordinatorToken: m.token, people: m.people.filter((p) => p.desktop).map((p) => p.username) })),
  }, null, 2));
  await waitFor(`${HANDOFF}.ready`, 'the Collect Earth instances to join', 40);
}
const coordinators = (ms: number) => mapathons.map((m) => coordinate(m, ms, [3000, 8000]));

// 1. 9:00: everyone opens Collect Earth at the same moment
// (Collect Earth signs in and reads its plots in any case: without phase 1 they do it one after the other)
if (PHASES.has('1')) await runPhase('1 everyone starts at once', () => Promise.all(everyone.map(({ m, p }) => startCollectEarth(m, p))));
else for (const { m, p } of everyone) await startCollectEarth(m, p);

// T. The training day: everyone answers the training plots; the coordinators follow it on the dashboard. Then each
// coordinator finishes the training (its answers deleted, its scores kept) and divides the project's plots; Collect
// Earth sends the training away and brings each person's plots at its next check.
const trainingChecks: { what: string; ok: boolean; detail?: string }[] = [];
if (TRAINING > 0) {
  let trained = false;
  await runPhase(`T training day (${TRAINING} plots each, a plot every ${TRAIN_LO}-${TRAIN_HI} s)`, async () => {
    const watching = mapathons.map((m) => watchTraining(m, () => trained, [5000, 15000]));
    await Promise.all(everyone.map(({ m, p }) => train(m, p, [TRAIN_LO * 1000 * SCALE, TRAIN_HI * 1000 * SCALE])));
    if (HANDOFF && DESKTOP > 0) await waitFor(`${HANDOFF}.trained`, 'the Collect Earth instances to finish their training', 60);
    trained = true;
    await Promise.all(watching);
  });
  await runPhase('F finish the training, divide the plots', async () => {
    for (const m of mapathons) {
      // Before the finish: every participant's answers are on the server (the training tab's count of plots submitted)
      const view = (await call('dashboard: training set', 'GET', `/v1/projects/${m.pid}/training/${m.trainingSetId}`, m.token)).json() as { set: { participants: unknown[] } };
      const taking = view.set?.participants.length ?? 0;
      trainingChecks.push({ what: `${m.name}: everyone of the project takes part in the training`, ok: taking === m.people.length, detail: `${taking} of ${m.people.length}` });
      const fin = await call('training: finish', 'POST', `/v1/projects/${m.pid}/training/${m.trainingSetId}/finish`, m.token, {});
      trainingChecks.push({ what: `${m.name}: the coordinator finishes the training`, ok: fin.status === 200, detail: `${fin.status}` });
      const divided = await call('divide the project\'s plots', 'PUT', `/v1/projects/${m.pid}/plots/division`, m.token, { mode: 'even', people: m.people.map((p) => p.userId), order: 'file' });
      trainingChecks.push({ what: `${m.name}: the project's plots are divided between the ${m.people.length} people`, ok: divided.status === 200, detail: `${divided.status} ${divided.status === 200 ? '' : divided.text.slice(0, 120)}` });
    }
  });
  if (HANDOFF && DESKTOP > 0) writeFileSync(`${HANDOFF}.divided`, new Date().toISOString());
  await runPhase('C Collect Earth checks: the training goes, the person\'s plots come', () => Promise.all(everyone.map(async ({ m, p }) => {
    // Its next check (within five minutes): the training over, then the person's plots
    await sleep(between(0, 300_000 * SCALE));
    const t = trainingOf.get(p)!;
    const { finished } = await readTraining(m, p);
    t.toldOver = finished;
    // An answer of the training sent late (a computer that was offline): thrown away
    if (t.training.length > 0) await send(m, p, [{ plot: t.training[0], activelySaved: true }], true);
    await readMyPlots(m, p, versions.get(p)!);
  })));
  for (const m of mapathons) {
    const ppl = m.people.filter((p) => !p.desktop);
    const answered = ppl.filter((p) => { const t = trainingOf.get(p)!; return t.training.length === TRAINING && t.training.every((x) => t.trainingDone.get(`${x},1`) === true); });
    trainingChecks.push({ what: `${m.name}: every person got the ${TRAINING} training plots and answered them all`, ok: answered.length === ppl.length, detail: `${answered.length} of ${ppl.length}` });
    const stale = ppl.filter((p) => trainingOf.get(p)!.staleAnswer === 'stale');
    trainingChecks.push({ what: `${m.name}: a training answer sent after the finish is thrown away (stale)`, ok: stale.length === ppl.length, detail: `${stale.length} of ${ppl.length}` });
    const told = ppl.filter((p) => trainingOf.get(p)!.toldOver);
    trainingChecks.push({ what: `${m.name}: Collect Earth is told the training is over (my-assignment)`, ok: told.length === ppl.length, detail: `${told.length} of ${ppl.length}` });
    const share = Math.floor(PLOTS / m.people.length);
    const got = ppl.filter((p) => p.plots.length >= share && p.plots.length <= share + 1);
    trainingChecks.push({ what: `${m.name}: each person's plots arrive once the training is over (${share} each)`, ok: got.length === ppl.length, detail: `${got.length} of ${ppl.length}; ${[...new Set(ppl.map((p) => p.plots.length))].join(', ')} plots` });
  }
  if (HANDOFF && DESKTOP > 0) await waitFor(`${HANDOFF}.collecting`, 'the Collect Earth instances to have their plots', 20);
}

// 2. A steady pace: a plot every 45-90 s (a real person's minute or so on a plot)
const STEADY = 5 * 60_000 * SCALE;
if (PHASES.has('2')) await runPhase('2 steady pace (a plot every 45-90 s)', () => Promise.all([
  ...everyone.map(({ m, p }) => collect(m, p, STEADY, [45_000 * SCALE, 90_000 * SCALE])),
  ...coordinators(STEADY),
]));

// 3. Fast: a plot every 5-10 s, ten times a real pace (60 people working like 600)
const FAST = 4 * 60_000 * SCALE;
if (PHASES.has('3')) await runPhase('3 ten times the pace (a plot every 5-10 s)', () => Promise.all([
  ...everyone.map(({ m, p }) => collect(m, p, FAST, [5_000 * SCALE, 10_000 * SCALE])),
  ...coordinators(FAST),
]));

// 4. The internet comes back: everyone sends a backlog of 50 saves (a batch, as CloudSyncService takes 50) at once, 3 times
if (PHASES.has('4')) await runPhase(`4 reconnection burst (${everyone.length} people x 50 saves at once, 3 times)`, async () => {
  for (let round = 0; round < 3; round++) {
    await Promise.all(everyone.map(({ m, p }) => send(m, p, Array.from({ length: 50 }, () => ({ plot: nextPlot(p).plot, activelySaved: true })))));
    await sleep(10_000 * SCALE);
  }
});

// 5. The ceiling: no pause, each person sending batches of 10 saves back to back for 60 s, the coordinators clicking fast
const CEILING = 60_000 * SCALE;
if (PHASES.has('5')) await runPhase('5 ceiling (no pause, batches of 10)', () => Promise.all([
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

const checks: { what: string; ok: boolean; detail?: string }[] = [...trainingChecks];
for (const m of mapathons) {
  const expected = new Map<string, number>(); // "operator recordKey" -> newest modifiedOn
  for (const p of m.people.filter((q) => !q.desktop)) for (const [key, at] of p.done) expected.set(`${p.username} ${key}`, at);
  if (DB) {
    const client = new pg.Client({ connectionString: DB });
    await client.connect();
    // The Collect Earth instances' plots are load-desktop.mts's to check
    const all = (await client.query('SELECT operator, record_key, modified_on FROM records WHERE project_id = $1 AND NOT deleted', [m.pid])).rows as { operator: string; record_key: string; modified_on: Date }[];
    const rows = all.filter((r) => !desktopNames.has(r.operator));
    if (TRAINING > 0) {
      const left = Number((await client.query('SELECT count(*) FROM training_records WHERE project_id = $1', [m.pid])).rows[0].count);
      checks.push({ what: `${m.name}: no answer of the finished training is left, none among the project's records`, ok: left === 0 && !all.some((r) => r.record_key.startsWith('T-')), detail: `${left} training records left` });
    }
    await client.end();
    const stored = new Map(rows.map((r) => [`${r.operator} ${r.record_key}`, r.modified_on.getTime()]));
    const missing = [...expected.keys()].filter((k) => !stored.has(k));
    const extra = [...stored.keys()].filter((k) => !expected.has(k));
    const older = [...expected].filter(([k, at]) => stored.has(k) && stored.get(k)! !== at);
    checks.push({ what: `${m.name}: database has each saved plot once (${expected.size})`, ok: missing.length === 0 && extra.length === 0 && rows.length === expected.size, detail: `stored ${rows.length}, missing ${missing.length}, unexpected ${extra.length}` });
    checks.push({ what: `${m.name}: database keeps the newest save of each plot`, ok: older.length === 0, detail: older.slice(0, 3).map(([k]) => k).join('; ') });
  }
  // The People tab, as the coordinator sees it once its figures are those of every record (asOf null): each person's
  // submitted plots are the plots whose newest save was complete
  let list: { username: string; plots: { submitted: number } }[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    const people = (await call('dashboard: people', 'GET', `/v1/projects/${m.pid}/people`, m.token)).json() as { asOf: number | null; people: typeof list };
    list = people.people;
    if (people.asOf === null) break;
    await sleep(2000);
  }
  checks.push({ what: `${m.name}: the People tab lists the ${m.people.length} collectors`, ok: m.people.every((p) => list.some((r) => r.username === p.username)), detail: `${list.length} listed` });
  const wrong = m.people.filter((p) => !p.desktop).flatMap((p) => {
    const expectedSubmitted = [...p.complete.values()].filter(Boolean).length;
    const shown = list.find((r) => r.username === p.username)?.plots.submitted;
    return shown === expectedSubmitted ? [] : [`${p.username}: ${shown} shown, ${expectedSubmitted} sent`];
  });
  checks.push({ what: `${m.name}: the People tab counts each person's submitted plots as sent`, ok: wrong.length === 0, detail: wrong.length ? wrong.slice(0, 3).join('; ') : `${m.people.filter((p) => !p.desktop).length} people` });
}

// --- the report --------------------------------------------------------------------------------------------------

const report: Record<string, unknown> = { base: BASE, mapathons: MAPATHONS, peoplePerMapathon: PEOPLE, plotsPerMapathon: PLOTS, training: TRAINING, survey: survey.uri, scale: SCALE, setupSeconds: +(setupMs / 1000).toFixed(1), phases: [] as unknown[], checks, errors: errors.slice(0, 50) };
const lines: string[] = [];
lines.push(`Setup: ${MAPATHONS} mapathons x ${PEOPLE} people, ${PLOTS} plots each${TRAINING ? `, a training day of ${TRAINING} plots` : ''}, survey ${survey.uri}, in ${(setupMs / 1000).toFixed(1)} s`);
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

// --- the clean-up: the projects, then the accounts (a server administrator's) -----------------------------------------
if (CLEANUP) {
  const left: string[] = [];
  for (const m of mapathons) {
    const res = await call('clean-up: project', 'DELETE', `/v1/projects/${m.pid}`, m.token, { confirmName: m.name });
    if (res.status >= 300) left.push(`project ${m.name} (${res.status})`);
  }
  let deleted = 0;
  for (const p of mapathons.flatMap((m) => m.people)) {
    if (AUTH_PER_MINUTE > 0) await authSlot();
    const res = await call('clean-up: account', 'DELETE', `/v1/admin/users/${p.userId}`, ownerToken, { confirm: p.username });
    if (res.status < 300) deleted += 1;
    else if (left.length < 5) left.push(`account ${p.username} (${res.status}${res.status === 403 || res.status === 404 ? ': not a server administrator?' : ''})`);
  }
  console.log(`\nClean-up: ${mapathons.length} projects and ${deleted} accounts deleted${left.length ? `; left: ${left.join(', ')}` : ''}`);
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
