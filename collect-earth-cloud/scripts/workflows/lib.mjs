// Shared pieces of the workflow runs: real Collect Earth desktops (one home folder each, one at a time on :8028),
// the cloud server on :8080, the office's PostgreSQL on :55432, and checks that print PASS / FAIL.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Where the desktops' home folders, the logs and the state go (made-up people and the desktop's demo survey only) */
export const E = process.env.WF_DIR ?? `${tmpdir()}/ce-workflows`;
mkdirSync(E, { recursive: true });
/** The desktop, built (collect-earth-app/target/CollectEarth.jar) */
export const APP = process.env.WF_APP ?? fileURLToPath(new URL('../../../collect-earth/collect-earth-app', import.meta.url));
export const CLOUD = process.env.WF_CLOUD ?? 'http://localhost:8080';
const PG_PORT = process.env.WF_PG_PORT ?? '55432';
/** The demo project's plot file, as the desktop installs it at its first start */
export function demoPlotFile() {
  // the alone desktop's first: a desktop that joined a cloud project has that project's files in the folder
  for (const h of ['home-solo', ...readdirSync(E).filter((d) => d.startsWith('home-'))]) {
    const f = `${E}/${h}/CollectEarth/projects/collect_earth_initial_2025/grid/showcase_plots.csv`;
    if (existsSync(f)) return readFileSync(f);
  }
  throw new Error('no desktop has started yet: run the "alone" scenario first');
}
const DESK = 'http://localhost:8028/earth';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
}
export function note(text) {
  results.push({ note: text });
  console.log(`NOTE  ${text}`);
}

// ---------- the cloud ----------
export async function cloud(method, path, body, token, raw) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (raw) {
    headers['content-type'] = raw;
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(CLOUD + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
export async function cloudLogin(username, password) {
  return (await cloud('POST', '/v1/auth/login', { username, password })).json?.token;
}
export const sql = (db, query) =>
  execSync(`psql -h localhost -p ${PG_PORT} -U ce -d ${db} -At -F '|' -c ${JSON.stringify(query)}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

// ---------- a desktop ----------
const home = (name) => `${E}/home-${name}`;
export const propsFile = (name) => `${home(name)}/CollectEarth/earth.properties`;

export function stopDesktops() {
  try { execSync('pkill -f CollectEarth.jar', { stdio: 'ignore' }); } catch {}
}
async function waitDown() {
  for (let i = 0; i < 60; i++) {
    try { execSync('pgrep -f CollectEarth.jar', { stdio: 'ignore' }); } catch { return; }
    await sleep(500);
  }
  try { execSync('pkill -9 -f CollectEarth.jar', { stdio: 'ignore' }); } catch {}
  await sleep(1000);
}
export async function waitUp() {
  for (let i = 0; i < 180; i++) {
    try {
      const r = await fetch(`${DESK}/api/cloud/state`, { headers: { 'X-Collect-Earth': '1' } });
      if (r.ok) return true;
    } catch {}
    await sleep(1000);
  }
  throw new Error('the desktop did not start');
}
/** Starts the desktop of a person (its own home folder); `props` are written into earth.properties before it starts */
export async function startDesktop(name, props = null) {
  stopDesktops();
  await waitDown();
  mkdirSync(home(name), { recursive: true });
  if (props) {
    if (!existsSync(propsFile(name))) throw new Error(`no earth.properties for ${name} yet`);
    let text = readFileSync(propsFile(name), 'utf8');
    for (const [k, v] of Object.entries(props)) {
      const line = `${k}=${String(v).replace(/:/g, '\\:')}`;
      text = new RegExp(`^${k}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${text}\n${line}\n`;
    }
    writeFileSync(propsFile(name), text);
  }
  const log = `${E}/desktop-${name}.log`;
  const child = spawn('java', [`-Duser.home=${home(name)}`, '-Dcollectearth.viewerType=plots_map', '-jar', 'target/CollectEarth.jar'], {
    cwd: APP, env: { ...process.env, DISPLAY: ':99' }, detached: true, stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();
  await waitUp();
  await sleep(4000); // the survey, the plot file and the local dashboard
  return log;
}
/** After a join, the desktop restarts itself: wait for the old one to go and the new one to answer */
export async function waitRestart() {
  await sleep(8000);
  await waitUp();
  await sleep(6000);
}

export async function desk(method, path, body) {
  const res = await fetch(DESK + path, {
    method, headers: { 'X-Collect-Earth': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
export const setOperator = (operator) => desk('PUT', '/api/app/operator', { operator });
/** What an interpreter does in the form: one land-cover answer, saved (a draft; the desktop stores a plot with an answer typed) */
const places = {};
export async function savePlot(plotId, coverage = '40') {
  if (!places[plotId]) {
    for (const f of (await (await fetch(`${DESK}/plotsGeoJson`)).json()).features) places[f.properties.id] = `${f.properties.latitude},${f.properties.longitude}`;
  }
  const body = new URLSearchParams({ placemarkId: plotId, currentStep: '0', partialUpdate: 'true' });
  // the place Google Earth's balloon sends with every save
  if (places[plotId]) body.append('values[collect_coord_location]', places[plotId]);
  body.append('values[collect_entity_land_cover[trees].code_coverage]', coverage);
  const res = await fetch(`${DESK}/save-data-expanded`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const json = await res.json();
  return json.success === true;
}
export async function plotIds() {
  const res = await fetch(`${DESK}/plotsGeoJson`);
  return (await res.json()).features.map((f) => f.properties.id);
}
export async function job(path, body) {
  const started = await desk('POST', path, body);
  if (!started.json?.id) return { state: 'NOT_STARTED', answer: started.json, status: started.status };
  for (let i = 0; i < 120; i++) {
    const j = (await desk('GET', `/api/jobs/${started.json.id}`)).json;
    if (j && !['RUNNING', 'PENDING', 'QUEUED'].includes(j.state)) return j;
    await sleep(500);
  }
  return { state: 'TIMEOUT' };
}
export async function syncNow() {
  await sleep(3000); // a save reaches the queue when the desktop writes it, a second after it was made
  await desk('POST', '/api/cloud/syncNow');
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const s = (await desk('GET', '/api/cloud/state')).json;
    if (s?.sync && s.sync.pending === 0) return s.sync;
  }
  return (await desk('GET', '/api/cloud/state')).json?.sync;
}
/** The join of the desktop's Join cloud project page: the link, then log in (an account) or register (none) */
export async function joinFromDesktop(joinUrl, username, password, register) {
  const preview = await desk('POST', '/api/cloud/preview', { url: joinUrl });
  if (preview.status !== 200) return { preview };
  const p = preview.json;
  const join = await desk('POST', '/api/cloud/join', { baseUrl: p.baseUrl, inviteToken: p.inviteToken, projectId: p.projectId, username, password, register });
  return { preview, join };
}
export function sqliteRecords(name) {
  const db = `${home(name)}/CollectEarth/collectEarthDatabase.db`;
  if (!existsSync(db)) return [];
  const out = execSync(`python3 -I -c "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print('\\n'.join(a+','+b for a,b in c.execute('select key1,key2 from ofc_record')))" "${db}"`, { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).sort();
}
