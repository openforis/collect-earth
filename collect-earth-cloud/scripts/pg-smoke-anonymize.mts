// Smoke test of anonymising a former member on a THROWAWAY PostgreSQL (drops and creates `ceanon` and `ce_anon_app`):
// the records' key, summary and XML, the record history, the quality decisions' "seen" and the log, as the app role.
//   npx tsx scripts/pg-smoke-anonymize.mts 55481        (the superuser is postgres / pw on localhost)
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres.js';
import { runMigrations } from '../src/store/migrate.js';
import { buildServer } from '../src/server.js';
import { batchRequest, envelope } from '../test/helpers.js';

const port = process.argv[2] ?? '55481';
const host = `localhost:${port}`;
const ownerUrl = `postgres://ceown:pw@${host}/ceanon`;
const appUrl = `postgres://ce_anon_app:apppw@${host}/ceanon`;
let failures = 0;
const check = (what: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(extra).slice(0, 600));
};
const sup = new pg.Client({ connectionString: `postgres://postgres:pw@${host}/postgres` });
await sup.connect();
await sup.query('DROP DATABASE IF EXISTS ceanon');
await sup.query('DROP ROLE IF EXISTS ce_anon_app');
await sup.query("DO $$ BEGIN CREATE ROLE ceown LOGIN PASSWORD 'pw' CREATEROLE; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
await sup.query('CREATE DATABASE ceanon OWNER ceown');
await sup.end();
await runMigrations(ownerUrl, () => {}, { appDatabaseUrl: appUrl });
const store = new PostgresStore(appUrl);
const app = await buildServer({ store, config: { port: 0, host: '127.0.0.1', storeBackend: 'postgres', setupCode: 'X', rateLimitPerMinute: 0 } as any, webDir: null });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const owner = (await app.inject({ method: 'POST', url: '/v1/setup', payload: { setupCode: 'X', username: 'owner', password: 'owner-password' } })).json();
const pid = (await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'A' } })).json().projectId as string;
const call = (method: any, path: string, payload?: unknown) => app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: bearer(owner.token), payload: payload as any });
const inv = await call('POST', '/invites', { role: 'operator', maxUses: 1 });
const ana = (await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'ana.m', password: 'password12', inviteToken: inv.json().inviteToken } })).json();
const xml = '<plot><operator>\n    <value>ana.m</value>\n  </operator><comment><value>ana.m</value></comment></plot>';
await batchRequest(app, pid, ana.token, [envelope({ recordKey: '1', operator: 'ana.m', modifiedOn: 1000, xml, summary: { collect_text_operator: 'ana.m', collect_text_id: '1' } })]);
const raw = new pg.Client({ connectionString: ownerUrl });
await raw.connect();
await raw.query(`INSERT INTO quality_decisions (project_id, plot, decision, decided_at, seen) VALUES ($1, '1', 'first', now(), '[{"operator":"ana.m","hash":1},{"operator":"bo","hash":2}]')`, [pid]).catch((e) => console.log('note: decision row not inserted:', e.message));
check('remove, then anonymise', (await call('DELETE', `/members/${ana.userId}`)).statusCode === 204 && (await call('POST', '/former-members/anonymize', { operator: 'ana.m' })).json().operator === 'former-member-1');
const rec = (await raw.query('SELECT operator, summary, xml FROM records WHERE project_id = $1', [pid])).rows[0];
check("the record's key and summary", rec.operator === 'former-member-1' && rec.summary.collect_text_operator === 'former-member-1', rec);
check("the XML's operator, not the comment equal to the name", rec.xml.includes('<value>former-member-1</value>\n  </operator><comment><value>ana.m</value>'), rec.xml);
const ev = (await raw.query('SELECT operator FROM record_events WHERE project_id = $1', [pid])).rows;
check('the history', ev.length > 0 && ev.every((e: any) => e.operator === 'former-member-1'), ev);
const dec = (await raw.query('SELECT seen FROM quality_decisions WHERE project_id = $1', [pid])).rows[0];
check("the decisions' seen, in order", !dec || JSON.stringify(dec.seen) === '[{"hash":1,"operator":"former-member-1"},{"hash":2,"operator":"bo"}]', dec?.seen);
const log = (await call('GET', '/activity')).body;
check('the log names no one', !log.includes('ana.m') && log.includes('member.anonymized'), log.slice(0, 300));
await raw.end();
await app.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
