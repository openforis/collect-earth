// Smoke test of the server page's projects and operations (stage C of docs/plans/2026-11-12-server-admin.md, migration
// 041) on a THROWAWAY PostgreSQL (it drops and creates the database `ceops` and the role `ce_ops_app`): 041 twice, the
// server as a NOSUPERUSER NOBYPASSRLS app role, the projects directory read across projects under RLS (people,
// coordinators, the last activity), a project archived, restored and handed to a coordinator (its own log too), the
// server activity log filtered and kept after its account is deleted, the Collect Earth versions, and the stopped weekly
// mails.
//
//   docker run -d --rm --name ce-pg-smoke -e POSTGRES_PASSWORD=pw -p 55481:5432 postgres:16
//   npm run smoke:pg:ops -- 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const superUrl = `postgres://postgres:pw@${host}/postgres`;
const ownerUrl = `postgres://ceopsown:pw@${host}/ceops`;
const appUrl = `postgres://ce_ops_app:apppw@${host}/ceops`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 700));
};

const sup = new pg.Client({ connectionString: superUrl });
for (let i = 0; ; i++) {
  try {
    await sup.connect();
    break;
  } catch (err) {
    if (i > 30) throw err;
    await new Promise((r) => setTimeout(r, 500));
  }
}
await sup.query('DROP DATABASE IF EXISTS ceops');
await sup.query('DROP ROLE IF EXISTS ce_ops_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceopsown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceops OWNER ceopsown');
await sup.end();

await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
await owner.query("DELETE FROM schema_migrations WHERE name = '041_server_activity.sql'");
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
check('041 applied twice (idempotent)', (await owner.query("SELECT to_regclass('server_activity') AS t")).rows[0].t !== null);

const store = new PostgresStore(appUrl);
check('RLS binds the app role', (await store.rowLevelSecurity()).enforced);
const app = await buildServer({
  store,
  config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0, qualityMinIntervalMs: 0, stateStaleMs: 0, publicBaseUrl: 'https://ce.example.org' } as any,
  webDir: null,
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let res = await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } });
const ownerToken = res.json().token as string;
const admin = (method: any, url: string, payload?: unknown) => app.inject({ method, url, headers: bearer(ownerToken), payload: payload as any });

const user = async (username: string, email: string | null = null) => (await store.createUser({ username, passwordHash: 'x', email })).id;
const ana = await user('ana');
const ben = await user('ben', 'ben@example.org');
const carla = await user('carla');
const busy = (await store.createProject({ name: 'Busy' })).projectId;
const orphan = (await store.createProject({ name: 'Orphan' })).projectId;
await store.addMembership(busy, ana, 'admin');
await store.addMembership(busy, ben, 'operator');
await store.addMembership(orphan, carla, 'admin');
await store.createSession(ana);
await store.disableUser(carla, ana);
await store.touchMemberActivity(busy, ben, { lastSyncAt: Date.now() - 1000, clientAgent: 'CollectEarth/1.23.20 cloud-sync' });
await store.touchMemberActivity(busy, ana, { lastSeenAt: Date.now() - 5000, clientAgent: 'CollectEarth/1.21.0 cloud-sync' });

// The directory, read across projects under RLS
let dir = (await admin('GET', '/v1/admin/projects')).json();
const b = dir.projects.find((p: any) => p.projectId === busy);
const o = dir.projects.find((p: any) => p.projectId === orphan);
check('directory: people, coordinators, last activity', dir.total === 2 && b.people === 2 && b.coordinators === 1 && b.activeCoordinators === 1 && Date.now() - b.lastActivityAt < 60_000 && !b.needsCoordinator, b);
check('directory: a project whose coordinator is disabled needs one', o.coordinators === 0 && o.needsCoordinator === true && o.lastActivityAt === null && dir.counts.noCoordinator === 1, o);
check('directory: no project names', !JSON.stringify(dir).includes('Busy') && !JSON.stringify(dir).includes('Orphan'));

// Archive, restore, hand over
res = await admin('POST', `/v1/admin/projects/${busy}/archive`, { archived: true });
check('archived', res.json().status === 'archived' && (await store.getProjectStatus(busy)) === 'archived', res.body);
res = await admin('POST', `/v1/admin/projects/${busy}/archive`, { archived: false });
check('restored as closed', res.json().status === 'closed', res.body);
await store.createSession(ben);
res = await admin('POST', `/v1/admin/projects/${orphan}/coordinator`, { username: 'ben' });
check('handed to ben', res.statusCode === 200 && (await store.getMembership(orphan, ben))?.role === 'admin', res.body);
const audit = await store.listAudit(orphan, { limit: 5 });
check('the project log says a server administrator did it', audit[0]?.action === 'member.role' && audit[0]?.actor === 'owner' && audit[0]?.details.byServerAdmin === true, audit);
dir = (await admin('GET', '/v1/admin/projects?filter=noCoordinator')).json();
check('no project needs a coordinator now', dir.total === 0, dir);

// The activity log
await admin('PUT', '/v1/admin/settings', { signupOpen: true });
let log = (await admin('GET', '/v1/admin/activity')).json();
check('activity: newest first', log.entries.map((e: any) => e.action).join() === 'settings.changed,project.coordinator,project.restored,project.archived', log.entries.map((e: any) => e.action));
log = (await admin('GET', '/v1/admin/activity?kind=project&pageSize=2&page=2')).json();
check('activity: by kind, in pages', log.total === 3 && log.pages === 2 && log.entries.length === 1 && log.actors.join() === 'owner', log);
const dan = await user('dan');
res = await admin('DELETE', `/v1/admin/users/${dan}`, { confirm: 'dan' });
log = (await admin('GET', '/v1/admin/activity?kind=account')).json();
check('a deleted account\'s name is kept', res.statusCode === 200 && log.entries[0]?.target === 'dan' && log.entries[0]?.targetUserId === null, { status: res.statusCode, body: res.body, log });
res = await admin('GET', '/v1/admin/activity.csv');
check('activity CSV', res.statusCode === 200 && res.body.trim().split('\r\n').length === 1 + 5, res.body);

// Versions and mail
const versions = (await admin('GET', '/v1/admin/versions')).json();
check('versions: ben on 1.23.20, ana outdated on 1.21.0', versions.accounts === 2 && versions.latest === '1.23.20' && versions.outdatedAccounts === 1, versions);
await store.setDigest(ben, 'collector', true, Date.now());
for (let i = 0; i < 3; i++) await store.noteDigestFailure(ben, 'collector', Date.now(), 3);
const mail = (await admin('GET', '/v1/admin/mail')).json();
check('mail check: not sending, ben\'s weekly mail stopped', mail.delivers === false && mail.stopped.length === 1 && mail.stopped[0].username === 'ben' && mail.stopped[0].failures === 3, mail);

await app.close();
await owner.end();
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
