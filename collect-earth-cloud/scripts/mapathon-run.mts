// Mapathons on existing projects with existing accounts (scripts/seed-demo-projects.mts makes them): for each project
// in turn, every participant collects with a real Collect Earth of this computer (scripts/load-desktop.mts, each one
// signed in with the person's own password and opening the project from its list) until each has done every plot it
// holds, while the reviewers work through the review queue and look at the progress and the map as reviewers do.
//
//   BASE=https://cloud.example.org ACCOUNTS=demo-accounts.csv PROJECTS=<id>,<id>,<id> DISPLAY=:99 \
//     npx tsx scripts/mapathon-run.mts
//
// Settings (environment):
//   BASE          the server (required); ACCOUNTS the accounts file (username,password,role: participant or
//                 reviewer) (required); PROJECTS the projects' ids, in the order they run (required)
//   PACE_S        seconds between two plots of a participant ("20-40"); REVIEW_S seconds between two looks of a
//                 reviewer ("60-120"); XMX each Collect Earth's memory (1g); FIRST_PORT (8031)
//   PLOTS_EACH    stop each participant after so many plots (all of them when not given)
//   OUT           the folder of the reports (mapathon-reports)
//
// Nothing is made or deleted on the server but what collecting and reviewing makes: records, and reviewers' decisions.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const env = process.env;
const BASE = (env.BASE ?? '').replace(/\/+$/, '');
const ACCOUNTS = env.ACCOUNTS ?? '';
const PROJECTS = (env.PROJECTS ?? '').split(',').map((p) => p.trim()).filter(Boolean);
const OUT = resolve(env.OUT ?? 'mapathon-reports');
const [REVIEW_LO, REVIEW_HI] = (env.REVIEW_S ?? '60-120').split('-').map(Number);
if (!BASE || !ACCOUNTS || PROJECTS.length === 0) {
  console.error('BASE, ACCOUNTS and PROJECTS are required: see the head of the script.');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const accounts = readFileSync(ACCOUNTS, 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter((l) => l.trim() !== '')
  .map((l) => {
    const [username, password, role] = l.split(',');
    return { username, password, role: role.trim() };
  });
const participants = accounts.filter((a) => a.role === 'participant');
const reviewers = accounts.filter((a) => a.role === 'reviewer');

async function api(method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; json: () => any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: () => JSON.parse(text) };
}

/** A reviewer at work while the mapathon lasts: the progress, the map, the review queue, a decision on some plots */
async function review(account: { username: string; password: string }, projectId: string, running: () => boolean) {
  const stats = { looks: 0, decisions: 0, errors: [] as string[] };
  const login = await api('POST', '/v1/auth/login', null, { username: account.username, password: account.password });
  if (login.status !== 200) {
    stats.errors.push(`sign-in ${login.status}`);
    return stats;
  }
  const token = login.json().token as string;
  // The first look a while after the start: plots have to be submitted before there is anything to review
  await sleep(between(REVIEW_LO, REVIEW_HI) * 1000);
  while (running()) {
    for (const path of [`/v1/projects/${projectId}/progress`, `/v1/projects/${projectId}/map/plots`, `/v1/projects/${projectId}/quality/queue`]) {
      const r = await api('GET', path, token);
      if (r.status !== 200) stats.errors.push(`${path.split('/').slice(-2).join('/')} ${r.status}`);
      else if (path.endsWith('/queue')) {
        // The first one or two plots of the queue decided: the first assessment kept, as a reviewer mostly does
        const items = (r.json().items ?? []) as { plot: string }[];
        for (const item of items.slice(0, 1 + Math.floor(Math.random() * 2))) {
          const d = await api('PUT', `/v1/projects/${projectId}/quality/decisions/${encodeURIComponent(item.plot)}`, token, { decision: 'first', comment: null });
          if (d.status === 200) stats.decisions++;
          else stats.errors.push(`decision ${d.status}`);
        }
      }
    }
    stats.looks++;
    const until = Date.now() + between(REVIEW_LO, REVIEW_HI) * 1000;
    while (running() && Date.now() < until) await sleep(1000);
  }
  await api('POST', '/v1/auth/logout', token);
  return stats;
}

mkdirSync(OUT, { recursive: true });
const summary: string[] = [];
for (const [n, projectId] of PROJECTS.entries()) {
  const handoffFile = join(OUT, `handoff-${n + 1}.json`);
  for (const suffix of ['', '.ready', '.done', '.synced']) rmSync(handoffFile + suffix, { force: true });
  const name = `Mapathon ${n + 1} of ${PROJECTS.length}`;
  writeFileSync(handoffFile, JSON.stringify({ base: BASE, mapathons: [{ name, pid: projectId, people: participants.map((p) => ({ username: p.username, password: p.password })) }] }));
  log(`${name}: project ${projectId}, ${participants.length} Collect Earth instances, ${reviewers.length} reviewers`);
  const report = join(OUT, `mapathon-${n + 1}.json`);
  const desk = spawn('npx', ['tsx', 'scripts/load-desktop.mts'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...env, HANDOFF: handoffFile, UNTIL_ALL: '1', OUT: report },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  desk.stdout.on('data', (d: Buffer) => {
    process.stdout.write(d);
    lines.push(...d.toString().split('\n').filter(Boolean));
  });
  desk.stderr.on('data', (d: Buffer) => process.stderr.write(d));
  let running = true;
  const ended = new Promise<number>((r) => desk.on('exit', (code) => r(code ?? 1)));
  void ended.then(() => {
    running = false;
  });
  // The reviewers start once the instances are collecting
  while (running && !existsSync(`${handoffFile}.ready`)) await sleep(2000);
  const reviewing = reviewers.map((r) => review(r, projectId, () => running));
  const code = await ended;
  const reviewed = await Promise.all(reviewing);
  const reviewLines = reviewers.map((r, k) => `${r.username}: ${reviewed[k].looks} looks, ${reviewed[k].decisions} decisions${reviewed[k].errors.length ? `, errors: ${[...new Set(reviewed[k].errors)].join('; ')}` : ''}`);
  summary.push(`${name} (project ${projectId}): Collect Earth run ${code === 0 ? 'passed its checks' : `ended with ${code}`}`, ...lines.filter((l) => /^(ok|FAIL|All instances|Collect Earth \d)/.test(l)).map((l) => `  ${l}`), ...reviewLines.map((l) => `  reviewer ${l}`));
  writeFileSync(join(OUT, 'summary.txt'), summary.join('\n') + '\n');
  log(`${name} over (exit ${code})\n${reviewLines.join('\n')}`);
}
console.log(`\n${summary.join('\n')}`);
