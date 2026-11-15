// Smoke test of giving a typed name's plots to a person, on a THROWAWAY PostgreSQL (drops and creates `cegive` and
// `ce_give_app`): the records' key, summary and XML, the history of the plots moved only, a plot the person has their
// own record of kept twice, the quality decisions' "seen", and the log, as the app role.
//   npx tsx scripts/pg-smoke-give.mts 55481        (the superuser is postgres / pw on localhost; SUPER_URL to change it)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const ownerUrl = `postgres://ceown:pw@${host}/cegive`;
const appUrl = `postgres://ce_give_app:apppw@${host}/cegive`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 600));
};
const sup = new pg.Client({ connectionString: process.env.SUPER_URL ?? `postgres://postgres:pw@${host}/postgres` });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS cegive');
await sup.query('DROP ROLE IF EXISTS ce_give_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE cegive OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const store = new PostgresStore(appUrl);
const app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0 } as any, webDir: null });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const owner = (await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } })).json();
const pid = (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'A' } })).json().projectId as string;
const call = (method: any, path: string, payload?: unknown) => app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: bearer(owner.token), payload: payload as any });
const inv = await call('POST', '/invites', { role: 'operator', maxUses: 1 });
const marta = (await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'marta', password: 'password12', inviteToken: inv.json().inviteToken } })).json();

// Two plots under the typed name, as a backup brings them; plot 2 also saved by marta herself
const xml = (name: string) => `<plot><operator>\n    <value>${name}</value>\n  </operator><comment><value>Marta Lopez</value></comment></plot>`;
const raw = new pg.Client({ connectionString: ownerUrl });
await raw.connect();
for (const key of ['1', '2']) {
  await raw.query(
    `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary)
     VALUES ($1, $2, 'Marta Lopez', now(), now(), true, 1, $3, $4)`,
    [pid, key, xml('Marta Lopez'), { collect_text_operator: 'Marta Lopez', collect_text_id: key }],
  );
  await raw.query(`INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, change) VALUES ($1, $2, 'Marta Lopez', now(), now(), 'created')`, [pid, key])
    .catch((e) => console.log('note: history row not inserted:', e.message));
}
await batchRequest(app, pid, marta.token, [envelope({ recordKey: '2', operator: 'marta', modifiedOn: Date.now(), xml: xml('marta') })]);
await raw.query(`INSERT INTO quality_decisions (project_id, plot, decision, decided_at, seen) VALUES ($1, '1', 'first', now(), '[{"operator":"Marta Lopez","hash":1},{"operator":"bo","hash":2}]')`, [pid])
  .catch((e) => console.log('note: decision row not inserted:', e.message));

const listed = (await call('GET', '/former-members')).json().formerMembers;
check('the typed name is listed as typed', listed.some((f: any) => f.operator === 'Marta Lopez' && f.typed === true && f.records === 2), listed);
const given = await call('POST', '/former-members/give', { operator: 'Marta Lopez', username: 'marta' });
check('given: 1 moved, 1 kept', given.statusCode === 200 && given.json().moved === 1 && given.json().kept === 1, given.json());
const rows = (await raw.query('SELECT record_key, operator, summary, xml FROM records WHERE project_id = $1 ORDER BY 1, 2', [pid])).rows;
check('plot 1 is marta’s; plot 2 kept under both', rows.map((r: any) => `${r.record_key}:${r.operator}`).join(' ') === '1:marta 2:Marta Lopez 2:marta', rows.map((r: any) => `${r.record_key}:${r.operator}`));
const one = rows.find((r: any) => r.record_key === '1');
check("plot 1's summary and XML operator, not the comment", one.summary.collect_text_operator === 'marta' && one.xml.includes('<value>marta</value>\n  </operator><comment><value>Marta Lopez</value>'), one);
const ev = (await raw.query("SELECT record_key, operator FROM record_events WHERE project_id = $1 AND operator IN ('Marta Lopez', 'marta') ORDER BY 1, 2", [pid])).rows;
check('the history of plot 1 follows; plot 2’s typed one stays', !ev.some((e: any) => e.record_key === '1' && e.operator === 'Marta Lopez') && ev.some((e: any) => e.record_key === '2' && e.operator === 'Marta Lopez'), ev);
const dec = (await raw.query('SELECT seen FROM quality_decisions WHERE project_id = $1', [pid])).rows[0];
check("the decisions' seen, in order", !dec || JSON.stringify(dec.seen) === '[{"hash":1,"operator":"marta"},{"hash":2,"operator":"bo"}]', dec?.seen);
const entry = (await call('GET', '/activity')).json().items.find((i: any) => i.action === 'records.given');
check("the log's entry says it, without the typed name", !!entry && entry.details.records === 1 && !JSON.stringify(entry).includes('Marta Lopez'), entry);
await raw.end();
await app.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
