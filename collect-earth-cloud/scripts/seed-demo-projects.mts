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
//   DRY_RUN=1     only checks the server, the administrator and the country, changing nothing
//
// The accounts' passwords are generated and written to OUT only: keep that file private.

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

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

const TEMPLATES = [
  { template: 'basic', label: 'demonstration survey' },
  { template: 'multipurpose', label: 'multipurpose survey' },
  { template: 'ipcc', label: 'IPCC land use survey' },
] as const;

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
  const accounts: { username: string; password: string; role: string }[] = [
    ...Array.from({ length: PARTICIPANTS }, (_, i) => ({ username: `${PREFIX.toLowerCase()}-${runId}-p${String(i + 1).padStart(2, '0')}`, password: password(), role: 'operator' })),
    ...Array.from({ length: REVIEWERS }, (_, i) => ({ username: `${PREFIX.toLowerCase()}-${runId}-r${String(i + 1).padStart(2, '0')}`, password: password(), role: 'reviewer' })),
  ];
  const sessions = new Map<string, { token: string; userId: string }>();
  const made: { name: string; projectId: string; plots: number }[] = [];

  for (const [index, t] of TEMPLATES.entries()) {
    const name = `${PREFIX} ${index + 1}: ${t.label} (${country})`;
    console.log(`\n${name}`);
    const projectId = expect('create the project', await call('POST', '/v1/projects', ADMIN_TOKEN, { name })).json().projectId as string;
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
    const file = expect('upload the plots', await call('PUT', `/v1/projects/${projectId}/csv-files/plots-${COUNTRY.toLowerCase()}.csv`, ADMIN_TOKEN, undefined, { data: Buffer.from(csv), type: 'text/csv' })).json();
    const plots = csv.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
    console.log(`  survey: ${t.template}; plots: ${plots}`);

    // The people: an invitation per role, taken by a new account (the first project) or by the account signed in
    for (const role of ['operator', 'reviewer']) {
      const people = accounts.filter((a) => a.role === role);
      if (people.length === 0) continue;
      const invite = expect('invite', await call('POST', `/v1/projects/${projectId}/invites`, ADMIN_TOKEN, { role, maxUses: people.length })).json().inviteToken as string;
      for (const a of people) {
        const known = sessions.get(a.username);
        if (known) {
          expect(`${a.username} joins`, await call('POST', '/v1/auth/join', known.token, { inviteToken: invite }));
        } else {
          const r = expect(`register ${a.username}`, await call('POST', '/v1/auth/register', null, { username: a.username, password: a.password, inviteToken: invite })).json();
          sessions.set(a.username, { token: r.token, userId: r.userId });
        }
      }
    }
    console.log(`  people: ${PARTICIPANTS} participants, ${REVIEWERS} reviewers`);

    // The plots divided evenly between the participants
    const participants = accounts.filter((a) => a.role === 'operator').map((a) => sessions.get(a.username)!.userId);
    if (participants.length > 0) {
      expect('divide the plots', await call('PUT', `/v1/projects/${projectId}/csv-files/${file.id}/distribution`, ADMIN_TOKEN, { mode: 'even', people: participants, order: 'file' }));
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

  // The accounts' sessions made here end: the people sign in with their passwords
  for (const s of sessions.values()) await call('POST', '/v1/auth/logout', s.token);
  writeFileSync(OUT, ['username,password,role', ...accounts.map((a) => `${a.username},${a.password},${a.role === 'operator' ? 'participant' : 'reviewer'}`)].join('\n') + '\n', { mode: 0o600 });
  console.log(`\nDone: ${made.length} projects`);
  for (const m of made) console.log(`  ${m.name}: ${m.plots} plots, ${BASE_URL}/projects/${m.projectId}`);
  console.log(`Accounts and passwords: ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
