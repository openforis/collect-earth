// Smoke test of invitation links that hand out plots, on a THROWAWAY PostgreSQL (drops and creates `ceinvplots` and
// `ce_invplots_app`): the link keeps its plots, a whole-file link assigns the file, a share link gives each person the
// next plots nobody holds, and twenty people joining at once never take the same plots, as the app role.
//   npx tsx scripts/pg-smoke-invite-plots.mts 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { demoCep } from '../test/fixtures/cep.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const ownerUrl = `postgres://ceown:pw@${host}/ceinvplots`;
const appUrl = `postgres://ce_invplots_app:apppw@${host}/ceinvplots`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 600));
};
const sup = new pg.Client({ connectionString: `postgres://postgres:pw@${host}/postgres` });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS ceinvplots');
await sup.query('DROP ROLE IF EXISTS ce_invplots_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceinvplots OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const store = new PostgresStore(appUrl);
const app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0 } as any, webDir: null });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const owner = (await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } })).json();
const pid = (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Mapathon' } })).json().projectId as string;
await app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: demoCep() });
const csv = ['id,round,lat,lon', ...Array.from({ length: 100 }, (_, i) => `P${i + 1},1,${10 + i / 1000},20`), ''].join('\n');
const file = async (name: string) => {
  const r = await app.inject({ method: 'PUT', url: `/v1/projects/${pid}/csv-files/${name}`, headers: { ...bearer(owner.token), 'content-type': 'text/csv' }, payload: csv });
  return (r.json().id ?? r.json().csvFile?.id) as string;
};
const shareFile = await file('share.csv');
const wholeFile = await file('whole.csv');
const link = async (plots: unknown) =>
  (await app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator', maxUses: 50, plots } })).json();
const share = await link({ csvFileId: shareFile, mode: 'share', count: 4 });
const whole = await link({ csvFileId: wholeFile, mode: 'whole' });
const listed = (await app.inject({ method: 'GET', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token) })).json().invites;
check('the links keep their plots', listed.some((i: any) => i.plots?.mode === 'share' && i.plots.count === 4) && listed.some((i: any) => i.plots?.mode === 'whole'), listed);

const join = (username: string, inviteToken: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: `${username}-password`, inviteToken } });
const w = (await join('whole1', whole.inviteToken)).json();
const raw = new pg.Client({ connectionString: ownerUrl });
await raw.connect();
const assigned = (await raw.query('SELECT user_id FROM assignments WHERE project_id = $1 AND csv_file_id = $2', [pid, wholeFile])).rows;
check('a whole-file link assigns the file', assigned.length === 1 && assigned[0].user_id === w.userId, assigned);

// twenty people at once on the share link: 20 × 4 = 80 of the 100 plots, each held once
const people = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
const answers = await Promise.all(people.map((u) => join(u, share.inviteToken)));
check('everyone joined', answers.every((a) => a.statusCode === 201), answers.map((a) => a.statusCode));
const held = (await raw.query('SELECT plot_key, user_id FROM plot_assignments WHERE project_id = $1 AND csv_file_id = $2', [pid, shareFile])).rows;
const perUser = new Map<string, number>();
for (const h of held) perUser.set(h.user_id, (perUser.get(h.user_id) ?? 0) + 1);
check('80 plots held, each by one person', held.length === 80 && new Set(held.map((h: any) => h.plot_key)).size === 80, { held: held.length });
check('four each', [...perUser.values()].every((n) => n === 4) && perUser.size === 20, [...perUser.values()]);
const dist = (await raw.query('SELECT distribution FROM csv_files WHERE project_id = $1 AND id = $2', [pid, shareFile])).rows[0].distribution;
check('the file is divided (manual)', dist?.mode === 'manual', dist);
// the next ones take the 20 left, then none
const late = await Promise.all(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((u) => join(u, share.inviteToken)));
const after = (await raw.query('SELECT COUNT(*)::int AS n FROM plot_assignments WHERE project_id = $1 AND csv_file_id = $2', [pid, shareFile])).rows[0].n;
check('the last plots go, then nobody gets more than the file has', after === 100 && late.every((a) => a.statusCode === 201), after);
await raw.end();
await app.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
