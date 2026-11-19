// Demonstration projects on a Collect Earth Cloud server: one per survey template (the demonstration survey, the
// multipurpose one, the IPCC one), each handed to a coordinator, with participants and reviewers (new accounts,
// the same ones in every project) and random plots over a country, divided evenly between the participants, and
// published. Everything goes through the server's own API, as the dashboard would do it.
//
//   BASE_URL=https://cloud.example.org COORDINATOR=sanchez_paus COUNTRY=KEN npx tsx scripts/seed-demo-projects.mts
//
// Settings (environment):
//   BASE_URL      the server (required)
//   ADMIN_TOKEN   a server administrator's session token; when the environment's network secret injects it for
//                 BASE_URL's host, leave it out (a placeholder is sent and replaced on the way)
//   COORDINATOR   the existing account that coordinates the projects (required)
//   COUNTRY       the country's ISO 3166 alpha-3 code (KEN, BOL, VNM…): the plots are random inside its border, from
//                 the public boundaries of github.com/johan/world.geo.json (required)
//   PARTICIPANTS  participants per project (10); REVIEWERS reviewers per project (2); PLOTS plots per project (3000)
//   PREFIX        the projects' name and the accounts' prefix (Demo); LANGUAGE the surveys' language (en)
//   YEARS         first and last year of the multipurpose and IPCC templates (2015-2024)
//   OUT           where the accounts and their passwords are written (seed-demo-accounts.csv)
//   KEEP_ADMIN=1  the administrator running the script stays a coordinator of the projects (it leaves them otherwise)
//   ACCOUNTS      a file written by an earlier run (username,password,role): its accounts are used, none is made
//   TEMPLATES     the templates to make projects of (basic,multipurpose,ipcc)
//   CONTINUE      template=projectId,…: a project an earlier run made (its survey and plots there) gets the rest
//   DRY_RUN=1     only checks the server, the administrator and the country, changing nothing
//
// The accounts' passwords are generated and written to OUT, before anything is made: keep that file private.
// No request is made with the accounts' sessions: an account takes an invitation by signing in with it (a network
// secret that adds the administrator's token to every request to the server would stand in for any other token).

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const env = process.env;
const BASE_URL = (env.BASE_URL ?? '').replace(/\/+$/, '');
const COORDINATOR = env.COORDINATOR ?? '';
const COUNTRY = (env.COUNTRY ?? '').toUpperCase();
const PARTICIPANTS = Number(env.PARTICIPANTS ?? 10);
const REVIEWERS = Number(env.REVIEWERS ?? 2);
const PLOTS = Number(env.PLOTS ?? 3000);
const PREFIX = env.PREFIX ?? 'Demo';
const LANGUAGE = env.LANGUAGE ?? 'en';
const [FIRST_YEAR, LAST_YEAR] = (env.YEARS ?? '2015-2024').split('-').map(Number);
const OUT = env.OUT ?? 'seed-demo-accounts.csv';
const DRY_RUN = env.DRY_RUN === '1';
// Replaced by the network secret on the way when ADMIN_TOKEN is not given
const ADMIN_TOKEN = env.ADMIN_TOKEN ?? 'injected-by-the-environment';

if (!BASE_URL || !COORDINATOR || !/^[A-Z]{3}$/.test(COUNTRY)) {
  console.error('BASE_URL, COORDINATOR and COUNTRY (an ISO alpha-3 code) are required: see the head of the script.');
  process.exit(2);
}

const ALL_TEMPLATES = [
  { template: 'basic', label: 'demonstration survey', number: 1 },
  { template: 'multipurpose', label: 'multipurpose survey', number: 2 },
  { template: 'ipcc', label: 'IPCC land use survey', number: 3 },
] as const;
const WANTED = (env.TEMPLATES ?? 'basic,multipurpose,ipcc').split(',').map((t) => t.trim());
const TEMPLATES = ALL_TEMPLATES.filter((t) => WANTED.includes(t.template));
const CONTINUE = new Map((env.CONTINUE ?? '').split(',').filter(Boolean).map((pair) => pair.split('=') as [string, string]));

interface Answer {
  status: number;
  text: string;
  json: () => any;
}

async function call(method: string, path: string, token: string | null, body?: unknown, raw?: { data: Buffer; type: string }): Promise<Answer> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(raw ? { 'content-type': raw.type } : body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: raw ? new Uint8Array(raw.data) : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    // The server limits how fast accounts are made and joined: wait and try again
    if (res.status === 429 && attempt < 8) {
      const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 5000 * (attempt + 1);
      console.error(`  ${method} ${path}: busy, waiting ${Math.round(wait / 1000)} s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return { status: res.status, text, json: () => JSON.parse(text) };
  }
}

function expect(what: string, res: Answer, ok: number[] = [200, 201]): Answer {
  if (!ok.includes(res.status)) throw new Error(`${what}: ${res.status} ${res.text.slice(0, 300)}`);
  return res;
}

const password = () => `${randomBytes(9).toString('base64url')}-${randomBytes(3).toString('hex')}`;

async function main(): Promise<void> {
  // The administrator, the coordinator, the country
  const me = expect('the administrator\'s account (is the token a signed-in session\'s?)', await call('GET', '/v1/me', ADMIN_TOKEN)).json();
  if (!me.isPlatformAdmin) throw new Error(`${me.username} is not a server administrator`);
  console.log(`Signed in as ${me.username}, a server administrator`);
  const projects = expect('the server\'s projects', await call('GET', '/v1/admin/projects', ADMIN_TOKEN));
  const boundary = await fetch(`https://raw.githubusercontent.com/johan/world.geo.json/master/countries/${COUNTRY}.geo.json`);
  if (!boundary.ok) throw new Error(`no boundary for the country ${COUNTRY} (${boundary.status})`);
  const geojson = await boundary.text();
  const country = JSON.parse(geojson).features?.[0]?.properties?.name ?? COUNTRY;
  const listed = projects.json();
  console.log(`Plots in ${country}; ${listed.total ?? listed.projects?.length ?? '?'} projects on the server now`);
  if (DRY_RUN) {
    console.log('Dry run: nothing changed.');
    return;
  }

  const runId = Date.now().toString(36).slice(-5);
  const reused = env.ACCOUNTS !== undefined;
  const accounts: { username: string; password: string; role: string }[] = reused
    ? readFileSync(env.ACCOUNTS!, 'utf8')
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => l.trim() !== '')
        .map((l) => {
          const [username, pw, role] = l.split(',');
          return { username, password: pw, role: role === 'reviewer' ? 'reviewer' : 'operator' };
        })
    : [
        ...Array.from({ length: PARTICIPANTS }, (_, i) => ({ username: `${PREFIX.toLowerCase()}-${runId}-p${String(i + 1).padStart(2, '0')}`, password: password(), role: 'operator' })),
        ...Array.from({ length: REVIEWERS }, (_, i) => ({ username: `${PREFIX.toLowerCase()}-${runId}-r${String(i + 1).padStart(2, '0')}`, password: password(), role: 'reviewer' })),
      ];
  // Written before anything is made: a run stopped halfway leaves the accounts it made usable
  if (!reused) {
    writeFileSync(OUT, ['username,password,role', ...accounts.map((a) => `${a.username},${a.password},${a.role === 'operator' ? 'participant' : 'reviewer'}`)].join('\n') + '\n', { mode: 0o600 });
    console.log(`Accounts and passwords: ${OUT}`);
  }
  // The accounts made (or known) so far, by username: their ids
  const ids = new Map<string, string>();
  let made1 = reused;
  const made: { name: string; projectId: string; plots: number }[] = [];

  for (const t of TEMPLATES) {
    const name = `${PREFIX} ${t.number}: ${t.label} (${country})`;
    console.log(`\n${name}`);
    const continued = CONTINUE.get(t.template);
    let projectId: string;
    let fileId: string;
    let plots: number;
    if (continued) {
      // Made by an earlier run with its survey and plots: the people and the rest are added
      projectId = continued;
      const files = expect('the project\'s plot files', await call('GET', `/v1/projects/${projectId}/csv-files`, ADMIN_TOKEN)).json();
      const list = files.csvFiles as { id: string; plotCount: number }[];
      if (!list?.length) throw new Error(`the project ${projectId} has no plot file`);
      fileId = list[0].id;
      plots = list[0].plotCount;
      console.log(`  continued: its plot file ${fileId}`);
    } else {
    projectId = expect('create the project', await call('POST', '/v1/projects', ADMIN_TOKEN, { name })).json().projectId as string;
    // Its survey, from the template, and its project file around it
    expect(
      'start the survey from the template',
      await call('POST', `/v1/projects/${projectId}/survey/new`, ADMIN_TOKEN, {
        template: t.template,
        title: name,
        language: LANGUAGE,
        ...(t.template === 'basic' ? {} : { years: { first: FIRST_YEAR, last: LAST_YEAR } }),
      }),
    );
    // The plots: random inside the country's border, as the dashboard's plot design makes them
    const csv = expect(
      'make the plots',
      await call('POST', `/v1/projects/${projectId}/plot-design`, ADMIN_TOKEN, { geojson, design: { method: 'random', count: PLOTS }, generate: true }),
    ).text;
    fileId = expect('upload the plots', await call('PUT', `/v1/projects/${projectId}/csv-files/plots-${COUNTRY.toLowerCase()}.csv`, ADMIN_TOKEN, undefined, { data: Buffer.from(csv), type: 'text/csv' })).json().id as string;
    plots = csv.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
    console.log(`  survey: ${t.template}; plots: ${plots}`);
    }

    // The people: an invitation per role, taken by a new account (the first project) or by an account signing in
    // with it (its password, no session of its own: see the head)
    for (const role of ['operator', 'reviewer']) {
      const people = accounts.filter((a) => a.role === role);
      if (people.length === 0) continue;
      const invite = expect('invite', await call('POST', `/v1/projects/${projectId}/invites`, ADMIN_TOKEN, { role, maxUses: people.length })).json().inviteToken as string;
      for (const a of people) {
        const r = made1
          ? expect(`${a.username} joins`, await call('POST', '/v1/auth/login', null, { username: a.username, password: a.password, inviteToken: invite })).json()
          : expect(`register ${a.username}`, await call('POST', '/v1/auth/register', null, { username: a.username, password: a.password, inviteToken: invite })).json();
        if (r.projectId !== projectId) throw new Error(`${a.username} did not join ${projectId} (${JSON.stringify(r).slice(0, 200)})`);
        ids.set(a.username, r.userId);
      }
    }
    made1 = true;
    // Checked on the project itself: every account is in it, with its role
    const members = expect('the project\'s people', await call('GET', `/v1/projects/${projectId}/members`, ADMIN_TOKEN)).json().members as { username: string; role: string }[];
    for (const a of accounts) {
      if (!members.some((m) => m.username === a.username && m.role === a.role)) throw new Error(`${a.username} is not in ${name} as ${a.role}`);
    }
    console.log(`  people: ${PARTICIPANTS} participants, ${REVIEWERS} reviewers`);

    // The plots divided evenly between the participants
    const participants = accounts.filter((a) => a.role === 'operator').map((a) => ids.get(a.username)!);
    if (participants.length > 0) {
      expect('divide the plots', await call('PUT', `/v1/projects/${projectId}/csv-files/${fileId}/distribution`, ADMIN_TOKEN, { mode: 'even', people: participants, order: 'file' }));
      console.log(`  plots divided: about ${Math.round(plots / participants.length)} each`);
    }

    // Published, and handed to the coordinator
    // (A server that makes projects as drafts has them published; one that makes them active already says so)
    const published = await call('PUT', `/v1/projects/${projectId}/status`, ADMIN_TOKEN, { status: 'active' });
    if (!(published.status === 409 && published.json().status === 'active')) expect('publish', published);
    const handed = await call('POST', `/v1/admin/projects/${projectId}/coordinator`, ADMIN_TOKEN, { username: COORDINATOR });
    if (handed.status === 409 && handed.json().error === 'already_coordinator') console.log(`  ${COORDINATOR} coordinates it already`);
    else expect(`make ${COORDINATOR} coordinator`, handed);
    // The administrator who made it leaves it (a server administrator reaches every project from the Server pages)
    if (me.username !== COORDINATOR && env.KEEP_ADMIN !== '1') {
      expect('the administrator leaves the project', await call('DELETE', `/v1/projects/${projectId}/members/${me.userId}`, ADMIN_TOKEN), [204]);
    }
    console.log(`  coordinator: ${COORDINATOR}`);
    made.push({ name, projectId, plots });
  }

  console.log(`\nDone: ${made.length} projects`);
  for (const m of made) console.log(`  ${m.name}: ${m.plots} plots, ${BASE_URL}/projects/${m.projectId}`);
  console.log(`Accounts and passwords: ${reused ? env.ACCOUNTS : OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
