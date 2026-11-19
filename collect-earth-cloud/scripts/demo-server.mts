// A demo server for screenshots of the dashboard (collectearth.org): the in-memory store, seeded through the
// HTTP API with invented people and answers, then listening on 127.0.0.1:8899. Nothing in it is real data.
//   npx tsx scripts/demo-server.mts
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/store/memory.js';
import { gzipSync } from 'node:zlib';
import { bearer } from '../test/helpers.js';
import { demoCep } from '../test/fixtures/cep.js';

const PORT = 8899;
const SETUP_CODE = 'DEMO-SETUP-0001';
const PASSWORD = 'demo-password-2026';
const DAY = 86_400_000;

// Seeded random numbers, so every run gives the same demo.
let seed = 20261111;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(items: T[]) => items[Math.floor(rnd() * items.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

// The seeding runs on a fake clock (the server stamps records with Date.now()), so the work is spread over
// the last three weeks. shortcut: patches the global Date.now during seeding only; restored before listening.
const realNow = Date.now;
const today = new Date(realNow());
today.setUTCHours(0, 0, 0, 0);
const startDay = today.getTime() - 22 * DAY;
let clock = startDay + 8 * 3_600_000;
Date.now = () => clock;

const config: Config = {
  ...loadConfig(),
  port: PORT,
  host: '127.0.0.1',
  storeBackend: 'memory',
  setupCode: SETUP_CODE,
  rateLimitPerMinute: 0,
  qualityMinIntervalMs: 0,
  stateStaleMs: 0,
  // Only the text of the invitation links: nothing is sent there.
  publicBaseUrl: 'https://cloud.collectearth.org',
};
const webDir = fileURLToPath(new URL('../web/dist', import.meta.url));
const app = await buildServer({ store: new InMemoryStore(), config, webDir, logger: false });

async function call(method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string | null, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method, url, headers: { ...(token ? bearer(token) : {}), ...headers }, payload: payload as never });
  if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
  return res;
}

// --- Accounts -------------------------------------------------------------------------------------------
const admin = (await call('POST', '/v1/setup', null, { setupCode: SETUP_CODE, username: 'admin', password: PASSWORD })).json().token as string;
await call('PUT', '/v1/admin/settings', admin, { signupOpen: true, projectCreation: 'anyone' });
const coordinator = (await call('POST', '/v1/auth/signup', null, { username: 'elena.marquez', password: PASSWORD })).json() as { token: string; userId: string };

const COLLECTORS = ['amara.diallo', 'kofi.mensah', 'lucia.ferreira', 'ravi.patel', 'sofia.nowak', 'tomas.lindqvist', 'yuki.tanaka'];
const REVIEWER = 'hana.kim';
type Person = { token: string; userId: string; username: string };
const people: Record<string, Person> = {};

async function join(pid: string, username: string, role: 'operator' | 'reviewer') {
  const invite = (await call('POST', `/v1/projects/${pid}/invites`, coordinator.token, { role, maxUses: 1 })).json().inviteToken as string;
  if (people[username]) {
    await call('POST', '/v1/auth/login', null, { username, password: PASSWORD, inviteToken: invite });
    return;
  }
  const res = (await call('POST', '/v1/auth/register', null, { username, password: PASSWORD, inviteToken: invite })).json();
  people[username] = { token: res.token, userId: res.userId, username };
}

// --- The plots: a systematic grid over Borgou, Benin --------------------------------------------------------
const HEADER = 'id,round,YCoordinate,XCoordinate,elevation,slope,aspect,climate,soil,gez,country,province,district';
const district = (lat: number, lon: number) =>
  lat < 9.6 ? (lon < 3.0 ? 'Tchaourou' : 'Pèrèrè') : lat < 10.0 ? (lon < 2.9 ? "N'Dali" : 'Nikki') : lon < 2.6 ? 'Sinendé' : lon < 3.1 ? 'Bembèrèkè' : 'Kalalé';
interface Plot { id: string; lat: number; lon: number; district: string; elevation: number; slope: number; aspect: number }
const plots: Plot[] = [];
const plotRow = (p: Plot) => `${p.id},1,${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.elevation},${p.slope},${p.aspect},3,6,12,Benin,Borgou,${p.district}`;
for (let r = 0; r < 25; r++) {
  for (let c = 0; c < 24; c++) {
    const lat = 9.05 + r * 0.055;
    const lon = 2.3 + c * 0.055;
    plots.push({ id: `BOR-${String(plots.length + 1).padStart(4, '0')}`, lat, lon, district: district(lat, lon), elevation: between(260, 480), slope: between(0, 9), aspect: between(0, 359) });
  }
}

// What is really on each plot, and what a collector may confuse it with.
const LAND: [string, string[], number][] = [
  ['G', ['grassland_trees', 'shrubland_trees', 'grassland_shrubs'], 0.38],
  ['C', ['annual_crops', 'shifting_agriculture', 'perennial_crops'], 0.3],
  ['F', ['broadleaf_dec', 'riparian', 'other_plant'], 0.2],
  ['S', ['village', 'infrastructure'], 0.05],
  ['W', ['seasonal_river', 'swamp'], 0.04],
  ['O', ['barren_soil', 'rock_stone'], 0.03],
];
const truth = new Map<string, [string, string]>();
const truthOf = (id: string) => {
  let t = truth.get(id);
  if (!t) {
    let x = rnd();
    const land = LAND.find(([, , share]) => (x -= share) < 0) ?? LAND[0];
    t = [land[0], pick(land[1])];
    truth.set(id, t);
  }
  return t;
};
const CONFUSED: Record<string, string> = { G: 'F', F: 'G', C: 'G', S: 'C', W: 'G', O: 'G' };
const answer = (id: string, accuracy: number): [string, string] => {
  const [cat, sub] = truthOf(id);
  if (rnd() < accuracy) return [cat, rnd() < 0.95 ? sub : pick(LAND.find((l) => l[0] === cat)![1])];
  const wrong = CONFUSED[cat];
  return [wrong, pick(LAND.find((l) => l[0] === wrong)![1])];
};
const COMMENTS = ['Cloud cover on the 2023 imagery, used 2022.', 'Recent clearing on the east side.', 'Seasonal flooding visible in Sentinel-2.', 'Tree crowns hard to tell from shrubs.', 'Cashew plantation?'];
function summary(p: Plot, round: string, [cat, sub]: [string, string], confident: boolean): Record<string, string> {
  return {
    collect_text_id: p.id,
    collect_code_round: round,
    collect_code_land_use_category: cat,
    collect_code_land_use_subdivision: sub,
    collect_boolean_land_use_assessment_confidence: String(confident),
    collect_text_country: 'Benin',
    collect_text_province: 'Borgou',
    collect_text_district: p.district,
    collect_integer_elevation: String(p.elevation),
    collect_real_slope: String(p.slope),
    collect_real_aspect: String(p.aspect),
    collect_boolean_actively_saved: 'true',
    ...(rnd() < 0.06 ? { collect_text_comments: pick(COMMENTS) } : {}),
  };
}
const xml = (p: Plot, operator: string, s: Record<string, string>) =>
  `<plot><id><value>${p.id}</value></id><round><value>${s.collect_code_round}</value></round><operator><value>${operator}</value></operator><land_use_subdivision><code>${s.collect_code_land_use_subdivision}</code></land_use_subdivision></plot>`;

async function send(pid: string, who: Person, p: Plot, round: string, accuracy: number, seconds: number | null, submitted = true) {
  const given = answer(p.id, accuracy);
  // Unsure on most plots where the answer is not what is there.
  const s = summary(p, round, given, given[0] === truthOf(p.id)[0] ? rnd() < 0.97 : rnd() < 0.4);
  // As Collect Earth sends it: gzipped, with its User-Agent.
  const body = gzipSync(Buffer.from(JSON.stringify({ records: [
    { recordKey: `${p.id},${round}`, surveyUri: 'http://www.openforis.org/idm/collect_earth_initial_2025', operator: who.username, modifiedOn: clock, activelySaved: submitted, step: 1, xml: xml(p, who.username, s), summary: s, deleted: false, payloadVersion: 1, ...(seconds !== null ? { activeSeconds: seconds } : {}) },
  ] })));
  const res = await app.inject({ method: 'POST', url: `/v1/projects/${pid}/records:batch`, headers: { ...bearer(who.token), 'content-type': 'application/json', 'content-encoding': 'gzip', 'user-agent': 'CollectEarth/1.23.19 cloud-sync' }, payload: body });
  if (res.statusCode !== 200 || res.json().results[0].status !== 'stored') throw new Error(`record ${p.id},${round}: ${res.body}`);
}

// --- Project 1: the main demo ---------------------------------------------------------------------------
const projectName = 'Demo – Land use assessment 2026';
const pid = (await call('POST', '/v1/projects', coordinator.token, { name: projectName })).json().projectId as string;
const P = `/v1/projects/${pid}`;
await call('PUT', `${P}/cep`, coordinator.token, demoCep(), { 'content-type': 'application/zip' });
for (const name of COLLECTORS) await join(pid, name, 'operator');
await join(pid, REVIEWER, 'reviewer');
await call('PUT', `${P}/progress/settings`, coordinator.token, { deadline: new Date(today.getTime() + 34 * DAY).toISOString().slice(0, 10), targetPlots: 600, quietDays: 3 });

const csv = (rows: Plot[]) => `${HEADER}\n${rows.map(plotRow).join('\n')}\n`;
const fileId = (await call('PUT', `${P}/csv-files/borgou_grid_2026.csv`, coordinator.token, csv(plots), { 'content-type': 'text/csv' })).json().id as string;
// A second file, not given out yet (for the give-out dialog).
const extra: Plot[] = Array.from({ length: 48 }, (_, i) => ({ id: `BOR-X${String(i + 1).padStart(3, '0')}`, lat: 9.08 + Math.floor(i / 8) * 0.11 + 0.027, lon: 2.33 + (i % 8) * 0.16 + 0.027, district: '', elevation: between(260, 480), slope: between(0, 9), aspect: between(0, 359) }));
for (const p of extra) p.district = district(p.lat, p.lon);
await call('PUT', `${P}/csv-files/borgou_densification.csv`, coordinator.token, csv(extra), { 'content-type': 'text/csv' });

const collectors = COLLECTORS.map((n) => people[n]);
await call('PUT', `${P}/csv-files/${fileId}/distribution`, coordinator.token, { mode: 'even', people: collectors.map((c) => c.userId), order: 'mixed', overlapPercent: 25, seed: 7 });
// Reference plots answered by the coordinator; every collector gets a blind copy.
const referenceIds = [12, 57, 101, 166, 230, 288, 341, 402, 465, 533].map((i) => plots[i].id);
await call('POST', `${P}/reference/plots`, coordinator.token, { csvFileId: fileId, assessorUserId: coordinator.userId, plots: referenceIds });

// Training: a calibration set of 12 plots outside the grid, answered by everyone in the first days.
const calib: Plot[] = Array.from({ length: 12 }, (_, i) => ({ id: `CAL-${String(i + 1).padStart(2, '0')}`, lat: 9.31 + i * 0.07, lon: 2.61 + (i % 4) * 0.09, district: '', elevation: between(260, 480), slope: between(0, 9), aspect: between(0, 359) }));
for (const p of calib) p.district = district(p.lat, p.lon);
const setId = (await call('PUT', `${P}/training-sets/calibration_borgou.csv?kind=calibration&name=${encodeURIComponent('Calibration – week 1')}`, coordinator.token, csv(calib), { 'content-type': 'text/csv' })).json().id as string;
await call('PUT', `${P}/training/${setId}/members`, coordinator.token, { userIds: collectors.map((c) => c.userId) });

// Who holds what: each person's own file, as Collect Earth downloads it.
async function heldPlots(who: Person): Promise<{ plot: Plot; round: string }[]> {
  const byId = new Map(plots.map((p) => [p.id, p]));
  const out: { plot: Plot; round: string }[] = [];
  const entries = (await call('GET', `${P}/my-assignment`, who.token)).json().assignments as { downloadPath: string; training?: unknown }[];
  for (const e of entries.filter((a) => !a.training)) {
    const [head, ...rows] = (await call('GET', e.downloadPath, who.token)).body.trim().split(/\r?\n/);
    const cols = head.split(',');
    const [iId, iRound] = [cols.indexOf('id'), cols.indexOf('round')];
    for (const row of rows) {
      const cells = row.split(',');
      const plot = byId.get(cells[iId]);
      if (plot) out.push({ plot, round: cells[iRound] });
    }
  }
  return out;
}

// Each collector's habits: accuracy, seconds per plot, how often they work, and days off at the end.
const habits: Record<string, { accuracy: number; seconds: number; chance: number; perDay: [number, number]; stopsAt?: number }> = {
  'amara.diallo': { accuracy: 0.95, seconds: 140, chance: 0.75, perDay: [10, 18] },
  'kofi.mensah': { accuracy: 0.93, seconds: 170, chance: 0.7, perDay: [8, 15] },
  'lucia.ferreira': { accuracy: 0.97, seconds: 210, chance: 0.65, perDay: [7, 13] },
  'ravi.patel': { accuracy: 0.87, seconds: 95, chance: 0.6, perDay: [10, 20] },
  'sofia.nowak': { accuracy: 0.94, seconds: 160, chance: 0.6, perDay: [6, 12], stopsAt: 17 },
  'tomas.lindqvist': { accuracy: 0.92, seconds: 185, chance: 0.5, perDay: [5, 11] },
  'yuki.tanaka': { accuracy: 0.95, seconds: 150, chance: 0.55, perDay: [6, 14] },
};
const queues: Record<string, { plot: Plot; round: string }[]> = {};
for (const c of collectors) {
  // Copies come mixed in with their own plots: Collect Earth does not tell them apart.
  queues[c.username] = (await heldPlots(c)).map((h) => ({ h, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.h);
}
const seconds = (mean: number) => Math.max(12, Math.round(mean * Math.exp((rnd() - 0.5) * 1.1)));

for (let d = 0; d <= 22; d++) {
  const dayStart = startDay + d * DAY;
  const weekday = new Date(dayStart).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  if (d === 0) continue; // setup day
  if (d <= 2) {
    // Calibration first.
    for (const c of collectors) {
      if ((d === 1) !== (COLLECTORS.indexOf(c.username) % 2 === 0)) continue;
      clock = dayStart + between(8, 10) * 3_600_000;
      for (const p of calib) {
        clock += between(120, 300) * 1000;
        await send(pid, c, p, '1', habits[c.username].accuracy, seconds(habits[c.username].seconds * 1.3));
      }
    }
    continue;
  }
  for (const c of collectors) {
    const h = habits[c.username];
    if (h.stopsAt !== undefined && d > h.stopsAt) continue;
    if (rnd() > (weekend ? 0.1 : h.chance)) continue;
    // Today: only the morning, before now.
    clock = dayStart + between(7, 10) * 3_600_000 + between(0, 59) * 60_000;
    const end = d === 22 ? realNow() - 30 * 60_000 : dayStart + DAY;
    let n = Math.round(between(...h.perDay) * 0.75);
    while (n-- > 0 && queues[c.username].length > 0) {
      const s = c.username === 'ravi.patel' && rnd() < 0.12 ? between(10, 25) : seconds(h.seconds);
      if (clock + s * 1000 + 30_000 > end) break;
      clock += s * 1000 + between(10, 60) * 1000;
      const { plot, round } = queues[c.username].shift()!;
      // A few saved but not submitted yet.
      await send(pid, c, plot, round, h.accuracy, s, rnd() > 0.03);
    }
  }
}

// The coordinator answers the reference plots, the reviewer looks at nothing (a reviewer reads).
clock = startDay + 1 * DAY + 15 * 3_600_000;
for (const id of referenceIds) {
  clock += 240_000;
  await send(pid, { ...coordinator, username: 'elena.marquez' }, plots.find((p) => p.id === id)!, '1', 1, between(150, 300));
}
// Golden answers from the calibration's consensus.
clock = startDay + 3 * DAY + 9 * 3_600_000;
await call('POST', `${P}/training/${setId}/golden`, coordinator.token, { from: 'consensus' });

// --- Project 2: small, a few records ---------------------------------------------------------------------
clock = startDay + 5 * DAY + 9 * 3_600_000;
const pid2 = (await call('POST', '/v1/projects', coordinator.token, { name: 'Demo – Mangrove baseline, Saloum Delta' })).json().projectId as string;
await call('PUT', `/v1/projects/${pid2}/cep`, coordinator.token, demoCep(), { 'content-type': 'application/zip' });
for (const name of ['amara.diallo', 'lucia.ferreira', 'kofi.mensah']) await join(pid2, name, 'operator');
const saloum: Plot[] = Array.from({ length: 80 }, (_, i) => ({ id: `SAL-${String(i + 1).padStart(3, '0')}`, lat: 13.62 + Math.floor(i / 10) * 0.045, lon: -16.72 + (i % 10) * 0.045, district: 'Foundiougne', elevation: between(0, 12), slope: 0, aspect: between(0, 359) }));
const saloumCsv = `${HEADER}\n${saloum.map((p) => `${p.id},1,${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.elevation},${p.slope},${p.aspect},2,9,1,Senegal,Fatick,${p.district}`).join('\n')}\n`;
const file2 = (await call('PUT', `/v1/projects/${pid2}/csv-files/saloum_plots.csv`, coordinator.token, saloumCsv, { 'content-type': 'text/csv' })).json().id as string;
await call('PUT', `/v1/projects/${pid2}/csv-files/${file2}/distribution`, coordinator.token, { mode: 'even', people: ['amara.diallo', 'lucia.ferreira', 'kofi.mensah'].map((n) => people[n].userId), order: 'file' });
for (const p of saloum) truth.set(p.id, rnd() < 0.6 ? ['W', 'swamp'] : rnd() < 0.5 ? ['F', 'mangrove'] : ['O', 'barren_soil']);
for (const [i, p] of saloum.slice(0, 22).entries()) {
  clock = startDay + (8 + Math.floor(i / 4)) * DAY + (9 + (i % 4)) * 3_600_000;
  // Plots 1-22 are amara's: the first holder of the file divided evenly in file order.
  await send(pid2, people['amara.diallo'], { ...p, district: 'Foundiougne' }, '1', 0.9, seconds(160));
}

// --- Project 3: just made, for the getting-started checklist ----------------------------------------------
clock = realNow() - 20 * 60_000;
const pid3 = (await call('POST', '/v1/projects', coordinator.token, { name: 'Demo – Forest inventory pilot' })).json().projectId as string;

Date.now = realNow;
// Work out the quality figures now, so the pages that use them have them at once.
for (let i = 0; i < 600; i++) {
  const q = (await call('GET', `${P}/quality`, coordinator.token)).json();
  if (!q.stale && q.computedAt) break;
  await new Promise((r) => setTimeout(r, 100));
}
await app.listen({ port: PORT, host: '127.0.0.1' });
const done = collectors.reduce((n, c) => n + (queues[c.username].length), 0);
process.stdout.write(
  [
    `Collect Earth Cloud demo on http://127.0.0.1:${PORT}  (${done} held plots still to do)`,
    `  password for every account: ${PASSWORD}`,
    `  platform admin: admin`,
    `  coordinator:    elena.marquez`,
    `  collectors:     ${COLLECTORS.join(', ')}`,
    `  reviewer:       ${REVIEWER}`,
    `  projects:       ${pid} (main), ${pid2} (mangrove), ${pid3} (fresh)`,
    `  plot file:      ${fileId}`,
    `  training set:   ${setId}`,
    '',
  ].join('\n'),
);
