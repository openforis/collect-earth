// The workflows of Collect Earth, run with real desktops against a real cloud server on PostgreSQL.
// node run.mjs [scenario...]   (all by default: alone office cloud alone-to-cloud office-to-cloud office-back mapathon two-computers plots-update standalone accounts)
// What it needs and how to start it: README.md beside it.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  APP, CLOUD, E, check, demoPlotFile, cloud, cloudLogin, desk, job, joinFromDesktop, note, plotIds, results, savePlot, setOperator, sleep, sql, sqliteRecords,
  startDesktop, stopDesktops, syncNow, waitRestart,
} from './lib.mjs';

const STATE = `${E}/state.json`;
let state = {};
try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch {}
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const CEP = `${APP}/resources/demo_survey.cep`;
const cloudRows = (projectId) => sql('cloud', `select record_key || ':' || operator from records where project_id='${projectId}' and not deleted order by 1`);

async function coordinator() {
  if (!state.coordinator) {
    const setup = await cloud('POST', '/v1/setup', { setupCode: 'setup-code-123', username: 'coordinator', password: 'coordinator-pw' });
    check('the cloud server is set up by its first account', setup.status === 201, `HTTP ${setup.status}`);
    state.coordinator = true;
    save();
  }
  return cloudLogin('coordinator', 'coordinator-pw');
}
/** A cloud project with the desktop's demo survey and its plot file, active, and a link for 10 people */
async function cloudProject(token, name) {
  const created = await cloud('POST', '/v1/projects', { name }, token);
  const pid = created.json.projectId;
  const cep = await cloud('PUT', `/v1/projects/${pid}/cep`, readFileSync(CEP), token, 'application/zip');
  const plots = demoPlotFile();
  const csv = await cloud('PUT', `/v1/projects/${pid}/csv-files/showcase_plots.csv`, plots, token, 'text/csv');
  await cloud('PUT', `/v1/projects/${pid}/status`, { status: 'active' }, token);
  const link = await cloud('POST', `/v1/projects/${pid}/invites`, { role: 'operator', maxUses: 10 }, token);
  check(`"${name}": project file, plot file and a link`, cep.status < 300 && csv.status < 300 && link.json?.joinUrl, `cep ${cep.status}, plots ${csv.status}`);
  return { pid, joinUrl: link.json.joinUrl, csvId: csv.json?.id ?? csv.json?.csvFile?.id };
}
/** The plot file given out in the cloud, opened on the desktop (Collect Earth's "my plots" download) */
/** The coordinator gives a plot file to people (Setup › Plots, "who does this file"): every earlier one kept */
const given = {};
async function giveFile(token, pid, csvId, username) {
  const members = (await cloud('GET', `/v1/projects/${pid}/members`, undefined, token)).json;
  const list = members.members ?? members;
  given[pid] = [...(given[pid] ?? []), username];
  const assignments = given[pid].map((u) => ({ userId: list.find((m) => m.username === u)?.userId, csvFileId: csvId })).filter((a) => a.userId);
  const res = await cloud('PUT', `/v1/projects/${pid}/assignments`, { assignments }, token);
  return res.status < 300;
}
async function openCloudPlots() {
  const list = (await desk('GET', '/api/cloud/assignments')).json;
  const file = (list?.files ?? list?.assignments ?? [])[0];
  if (!file) return false;
  const got = (await desk('POST', '/api/cloud/assignments/download', { id: file.id ?? file.csvFileId })).json;
  if (!got?.path) return false;
  await desk('POST', '/api/settings', { values: { csv: got.path } });
  await sleep(6000);
  return true;
}

const scenarios = {
  // 1. Someone alone: one desktop, its own SQLite, its own dashboard
  async alone() {
    await startDesktop('solo');
    demoPlotFile(); // kept for the cloud projects, before this desktop joins one
    check('alone: the desktop starts as a local project', (await desk('GET', '/api/cloud/state')).json?.project?.mode === 'local');
    check('alone: the interpreter types their name', (await setOperator('Juan Perez')).status === 200);
    const plots = (await plotIds()).slice(0, 3);
    for (const p of plots) await savePlot(p);
    await sleep(3000);
    const stored = sqliteRecords('solo');
    check('alone: the plots saved are in the computer’s database', plots.every((p) => stored.includes(p)), stored.join(' '));
    state.soloPlots = plots;
    save();
  },

  // 2. An office team on one PostgreSQL: two desktops, one database
  async office() {
    sql('postgres', 'drop database if exists office');
    sql('postgres', 'create database office');
    const pg = { db_driver: 'POSTGRESQL', db_host: 'localhost', db_port: process.env.WF_PG_PORT ?? '55432', db_name: 'office', db_username: 'ce', db_password: 'ce' };
    // The database is empty, as an office's new one: the desktop makes the schema Collect needs (it did not start before)
    for (const [who, name, plots] of [['office-a', 'Marta Lopez', [3, 4]], ['office-b', 'Luis Garcia', [5, 6]]]) {
      await startDesktop(who); // first start: makes its home folder
      await startDesktop(who, pg);
      const s = (await desk('GET', '/api/settings')).json?.values;
      check(`office: ${who} uses the shared PostgreSQL`, s?.db_driver === 'POSTGRESQL', s?.db_driver);
      if (who === 'office-a') check('office: the desktop starts on an empty PostgreSQL and makes the schema', sql('office', "select count(*) from information_schema.tables where table_schema = 'collect' and table_name = 'ofc_record'")[0] === '1');
      await setOperator(name);
      const ids = await plotIds();
      for (const i of plots) await savePlot(ids[i]);
      await sleep(3000);
    }
    const rows = sql('office', 'select key1||\',\'||key2 from collect.ofc_record order by 1');
    check('office: both people’s plots are in the one database', rows.length === 4, rows.join(' '));
    // the first one opens again and sees the other's plots as saved
    await startDesktop('office-a');
    const ids = await plotIds();
    const seen = await fetch(`http://localhost:8028/earth/placemark-info-expanded?id=${encodeURIComponent(ids[5])}`).then((r) => r.json());
    check('office: a person sees a plot their colleague saved', Object.keys(seen.inputFieldInfoByParameterName ?? {}).length > 0);
    state.officePlots = rows;
    save();
  },

  // 3. A big group on the cloud: a coordinator, a link, people with and without an account
  async cloud() {
    const token = await coordinator();
    const project = await cloudProject(token, 'Cloud survey');
    state.cloud = project;
    save();
    // bruno has an account already, from another project
    const older = await cloudProject(token, 'Older project');
    const pv = (await cloud('GET', `/v1/join/${older.joinUrl.split('/join/')[1]}`)).json;
    await cloud('POST', '/v1/auth/register', { username: 'bruno', password: 'bruno-password', inviteToken: older.joinUrl.split('/join/')[1] });
    check('cloud: the older project’s link is valid', pv?.valid === true);

    // ana has no account: she registers from the desktop with the link
    await startDesktop('ana');
    const ana = await joinFromDesktop(project.joinUrl, 'ana', 'ana-password', true);
    check('cloud: someone without an account joins from the desktop by registering', ana.join?.status === 200, JSON.stringify(ana.join?.json ?? ana.preview?.json).slice(0, 200));
    await waitRestart();
    let st = (await desk('GET', '/api/cloud/state')).json;
    check('cloud: after joining, the desktop is in the cloud project, signed in as ana', st?.project?.mode === 'cloud' && st.project.account === 'ana' && st.project.signedIn, JSON.stringify(st?.project));
    check('cloud: before the coordinator gives her plots, the desktop has none from the cloud', ((await desk('GET', '/api/cloud/assignments')).json?.assignments ?? []).length === 0);
    check('cloud: the coordinator gives ana the plot file', await giveFile(token, project.pid, project.csvId, 'ana'));
    check('cloud: the desktop opens the cloud’s plot file', await openCloudPlots());
    const ids = await plotIds();
    for (const p of ids.slice(0, 2)) await savePlot(p);
    let sync = await syncNow();
    check('cloud: ana’s plots are sent', sync?.pending === 0 && sync?.failed === 0, JSON.stringify(sync));

    // bruno joins with his account
    await startDesktop('bruno');
    const bruno = await joinFromDesktop(project.joinUrl, 'bruno', 'bruno-password', false);
    check('cloud: someone with an account joins from the desktop by signing in', bruno.join?.status === 200, JSON.stringify(bruno.join?.json).slice(0, 200));
    await waitRestart();
    st = (await desk('GET', '/api/cloud/state')).json;
    check('cloud: bruno’s desktop is signed in as bruno', st?.project?.account === 'bruno');
    await giveFile(token, project.pid, project.csvId, 'bruno');
    check('cloud: bruno opens the same plot file', await openCloudPlots());
    const bids = await plotIds();
    for (const p of [bids[1], bids[2]]) await savePlot(p, '60');
    sync = await syncNow();
    const rows = cloudRows(project.pid);
    check('cloud: each person’s plots are kept as theirs (the plot both did, once each)', rows.length === 4 && rows.filter((r) => r.endsWith(':ana')).length === 2 && rows.filter((r) => r.endsWith(':bruno')).length === 2, rows.join(' '));
    const members = (await cloud('GET', `/v1/projects/${project.pid}/members`, undefined, token)).json;
    check('cloud: the coordinator sees both people', JSON.stringify(members).includes('"ana"') && JSON.stringify(members).includes('"bruno"'));
  },

  // 4. Alone first, then the cloud: the plots on the computer are offered and sent
  async 'alone-to-cloud'() {
    const project = state.cloud;
    const token = await coordinator();
    await startDesktop('solo');
    const before = (await desk('GET', '/api/cloud/localRecords')).json?.count;
    const joined = await joinFromDesktop(project.joinUrl, 'juan', 'juan-password', true);
    check('alone→cloud: the person who worked alone joins (new account)', joined.join?.status === 200, JSON.stringify(joined.join?.json).slice(0, 200));
    await waitRestart();
    const notices = (await desk('GET', '/api/notices')).json;
    const offer = (Array.isArray(notices) ? notices : notices?.notices ?? []).find((n) => n.kind === 'cloudSendRecords' || n.id === 'cloudSendRecords' || JSON.stringify(n).includes('cloudSendRecords'));
    check('alone→cloud: after joining, the desktop offers to send the plots already on it', !!offer, JSON.stringify(offer ?? notices).slice(0, 300));
    const local = (await desk('GET', '/api/cloud/localRecords')).json;
    const count = local?.count;
    check('alone→cloud: it counts the plots done alone', count === before && count >= 3, `${before} before, ${count} after`);
    check('alone→cloud: they are the person’s own (the name typed before joining)', local?.mine === count && local?.others === 0 && (local?.names ?? []).includes('Juan Perez'), JSON.stringify(local));
    const sent = await job('/api/jobs/sendToCloud');
    check('alone→cloud: sending them finishes', sent.state === 'SUCCEEDED' || sent.state === 'DONE' || sent.state === 'FINISHED', JSON.stringify(sent).slice(0, 300));
    const rows = cloudRows(project.pid).filter((r) => r.endsWith(':juan'));
    check('alone→cloud: they are in the cloud under juan’s account, not "Juan Perez"', rows.length === state.soloPlots.length, rows.join(' '));
    const again = await job('/api/jobs/sendToCloud');
    check('alone→cloud: sending again adds nothing', cloudRows(project.pid).filter((r) => r.endsWith(':juan')).length === rows.length, again.state);
    // a new plot after joining goes by itself
    await giveFile(token, project.pid, project.csvId, 'juan');
    await openCloudPlots();
    await savePlot((await plotIds())[7]);
    await syncNow();
    check('alone→cloud: a plot saved after joining is sent by the sync', cloudRows(project.pid).filter((r) => r.endsWith(':juan')).length === rows.length + 1);
    check('alone→cloud: the operator name is the account now', (await setOperator('Someone Else')).status !== 200);
  },

  // 5. The office team moves to the cloud: its backup imported, its people joining afterwards
  async 'office-to-cloud'() {
    const token = await coordinator();
    // the backup: "Export data to XML (ZIP)" on the office's database
    await startDesktop('office-a');
    const out = `${E}/office-backup.zip`;
    const exported = await job('/api/jobs/export', { format: 'XML', records: 'ALL', path: out });
    check('office→cloud: the office database exports its backup', ['SUCCEEDED', 'DONE', 'FINISHED'].includes(exported.state), JSON.stringify(exported).slice(0, 200));
    // luis has an account (another project) and is named for his plots; marta is not: her plots keep "Marta Lopez"
    const other = await cloudProject(token, 'Luis older project');
    await cloud('POST', '/v1/auth/register', { username: 'luis', password: 'luis-password', inviteToken: other.joinUrl.split('/join/')[1] });
    const backup = readFileSync(out).toString('base64');
    const preview = await cloud('POST', '/v1/projects/from-backup/preview', { backup }, token);
    check('office→cloud: the preview lists the typed names', JSON.stringify(preview.json?.collectors ?? '').includes('Marta Lopez'), JSON.stringify(preview.json?.collectors));
    const imported = await cloud('POST', '/v1/projects/from-backup', { backup, collectors: { 'Luis Garcia': 'luis' }, name: 'Office survey in the cloud' }, token);
    check('office→cloud: the coordinator makes the cloud project from it', imported.status === 201, JSON.stringify(imported.json).slice(0, 300));
    const pid = imported.json.projectId;
    await cloud('PUT', `/v1/projects/${pid}/status`, { status: 'active' }, token);
    let rows = cloudRows(pid);
    check('office→cloud: Luis’s plots are his account’s, Marta’s keep her typed name', rows.filter((r) => r.endsWith(':luis')).length === 2 && rows.filter((r) => r.endsWith(':Marta Lopez')).length === 2, rows.join(' '));
    const link = (await cloud('POST', `/v1/projects/${pid}/invites`, { role: 'operator', maxUses: 10 }, token)).json.joinUrl;

    // Marta joins from her office computer (which used the shared PostgreSQL)
    let joined = await joinFromDesktop(link, 'marta', 'marta-password', true);
    if (JSON.stringify(joined.join?.json ?? '').includes('username_taken')) joined = await joinFromDesktop(link, 'marta', 'marta-password', false);
    check('office→cloud: Marta joins from her office desktop', joined.join?.status === 200, JSON.stringify(joined.join?.json).slice(0, 200));
    await waitRestart();
    const hers = state.officePlots.filter((p) => rows.includes(`${p}:Marta Lopez`));
    check('office→cloud: before her name is given, her computer has none of her plots', hers.every((p) => !sqliteRecords('office-a').includes(p)), sqliteRecords('office-a').join(' '));

    // The coordinator gives "Marta Lopez" to her (People › Names typed in Collect Earth)
    const typed = (await cloud('GET', `/v1/projects/${pid}/former-members`, undefined, token)).json.formerMembers;
    check('office→cloud: the coordinator sees "Marta Lopez" as a typed name', typed.some((f) => f.operator === 'Marta Lopez' && f.typed), JSON.stringify(typed));
    const given = await cloud('POST', `/v1/projects/${pid}/former-members/give`, { operator: 'Marta Lopez', username: 'marta' }, token);
    check('office→cloud: giving moves her 2 plots to her account', given.json?.moved === 2 && given.json?.kept === 0, JSON.stringify(given.json));
    rows = cloudRows(pid);
    check('office→cloud: no plot is under the typed name any more', !rows.some((r) => r.endsWith(':Marta Lopez')) && rows.filter((r) => r.endsWith(':marta')).length === 2, rows.join(' '));

    // Her next start brings them to her computer, with her answers
    await startDesktop('office-a');
    await sleep(8000);
    const onHers = sqliteRecords('office-a');
    check('office→cloud: at her next start her plots are on her computer', hers.every((p) => onHers.includes(p)), onHers.join(' '));
    const notices = JSON.stringify((await desk('GET', '/api/notices')).json);
    check('office→cloud: Collect Earth tells her they arrived', notices.includes('cloudOwnRecords'), notices.slice(0, 300));
    const files = (await cloud('GET', `/v1/projects/${pid}/csv-files`, undefined, token)).json.csvFiles;
    await giveFile(token, pid, files[0].id, 'marta');
    await openCloudPlots();
    const info = await fetch(`http://localhost:8028/earth/placemark-info-expanded?id=${encodeURIComponent(hers[0])}`).then((r) => r.json());
    const coverage = info.inputFieldInfoByParameterName?.['collect_entity_land_cover[trees].code_coverage']?.value;
    check('office→cloud: her plot opens with her answer from the office', coverage === '40', `coverage ${coverage}`);
    // the fetched plots are not sent back as new work
    const sync = (await desk('GET', '/api/cloud/state')).json?.sync;
    check('office→cloud: the plots brought are not queued to be sent back', sync?.pending === 0, JSON.stringify(sync));

    // She saves one again: one record, hers
    await savePlot(hers[0], '80');
    await syncNow();
    rows = cloudRows(pid);
    check('office→cloud: a plot she saves again is kept once, as hers', rows.filter((r) => r.startsWith(`${hers[0]}:`)).join(' ') === `${hers[0]}:marta`, rows.join(' '));

    // Luis, named at the import, joins from the other office computer: his plots arrive at the join
    await startDesktop('office-b');
    const luisJoin = await joinFromDesktop(link, 'luis', 'luis-password', false);
    check('office→cloud: Luis joins with his account', luisJoin.join?.status === 200, JSON.stringify(luisJoin.join?.json).slice(0, 200));
    await waitRestart();
    await sleep(8000);
    const his = state.officePlots.filter((p) => cloudRows(pid).includes(`${p}:luis`));
    const onHis = sqliteRecords('office-b');
    check('office→cloud: Luis finds his plots on his computer right after joining', his.length === 2 && his.every((p) => onHis.includes(p)), `${his.join(' ')} | here: ${onHis.join(' ')}`);
  },

  // 6b. An office computer in the cloud project opens another office project (back on the office's PostgreSQL), then
  // the cloud project again (in the cloud mode again: its plots are sent, not kept in the office's database)
  async 'office-back'() {
    const pid = sql('cloud', "select id from projects where name = 'Office survey in the cloud'")[0];
    // another office project: the demo survey under another name
    const other = `${E}/office-second.cep`;
    execFileSync('python3', ['-I', '-c', `import sys,zipfile
src,dst=sys.argv[1],sys.argv[2]
with zipfile.ZipFile(src) as a, zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED) as b:
  for n in a.namelist():
    d=a.read(n)
    if n=='project_definition.properties': d=d.replace(b'survey_name=collect_earth_initial_2025',b'survey_name=office_second_survey')
    if n=='placemark.idm.xml': d=d.replace(b'/idm/collect_earth_initial_2025<',b'/idm/office_second_survey<')
    b.writestr(n,d)`, CEP, other]);
    await startDesktop('office-b');
    const imported = await desk('POST', '/api/projects/import', { path: other });
    await waitRestart();
    let s = (await desk('GET', '/api/settings')).json?.values;
    check('office back: another office project opens on the office’s PostgreSQL again', s?.db_driver === 'POSTGRESQL', `${JSON.stringify(imported.json)} ${s?.db_driver}`);
    const list = (await desk('GET', '/api/projects')).json?.projects ?? [];
    const theCloudOne = list.find((p) => p.cloud);
    const loaded = await desk('POST', '/api/projects/load', { folder: theCloudOne?.folder });
    await waitRestart();
    s = (await desk('GET', '/api/settings')).json?.values;
    check('office back: the cloud project opened again is in the cloud mode again', s?.db_driver === 'CLOUD', `${JSON.stringify(loaded.json)} ${s?.db_driver}`);
    // Luis saves one of his plots again there: the cloud has the new save
    const plot = state.officePlots.find((p) => cloudRows(pid).includes(`${p}:luis`));
    const savedAt = () => Number(sql('cloud', `select coalesce(extract(epoch from max(modified_on)), 0) from records where project_id='${pid}' and record_key='${plot}' and operator='luis'`)[0]);
    const before = savedAt();
    await sleep(1500);
    await savePlot(plot, '80');
    const sync = await syncNow();
    check('office back: a plot saved there reaches the cloud', savedAt() > before && sync?.failed === 0, `${plot}: ${before} → ${savedAt()} ${JSON.stringify(sync)}`);
  },

  // 7. A mapathon: a link that gives each person who joins 5 plots of the file; their Collect Earth opens them at once
  async mapathon() {
    const token = await coordinator();
    const created = await cloud('POST', '/v1/projects', { name: 'Mapathon' }, token);
    const pid = created.json.projectId;
    await cloud('PUT', `/v1/projects/${pid}/cep`, readFileSync(CEP), token, 'application/zip');
    const csv = await cloud('PUT', `/v1/projects/${pid}/csv-files/mapathon.csv`, demoPlotFile(), token, 'text/csv');
    const fileId = csv.json?.id ?? csv.json?.csvFile?.id;
    await cloud('PUT', `/v1/projects/${pid}/status`, { status: 'active' }, token);
    const link = await cloud('POST', `/v1/projects/${pid}/invites`, { role: 'operator', maxUses: 10, plots: { csvFileId: fileId, mode: 'share', count: 5 } }, token);
    check('mapathon: a link that gives 5 plots each', link.json?.plots?.count === 5, JSON.stringify(link.json?.plots));
    const theirs = {};
    for (const who of ['m1', 'm2']) {
      rmSync(`${E}/home-${who}`, { recursive: true, force: true });
      await startDesktop(who);
      const joined = await joinFromDesktop(link.json.joinUrl, who, `${who}-password`, true);
      check(`mapathon: ${who} joins from the desktop`, joined.join?.status === 200, JSON.stringify(joined.join?.json).slice(0, 200));
      await waitRestart();
      await sleep(6000);
      theirs[who] = await plotIds();
      check(`mapathon: ${who}'s Collect Earth opens their 5 plots by itself`, theirs[who].length === 5, theirs[who].join(' '));
    }
    check('mapathon: nobody has the same plot', !theirs.m1.some((p) => theirs.m2.includes(p)), `${theirs.m1.join(' ')} | ${theirs.m2.join(' ')}`);
    await savePlot(theirs.m2[0]);
    const sync = await syncNow();
    check('mapathon: a plot saved there is in the cloud', cloudRows(pid).includes(`${theirs.m2[0]}:m2`) && sync?.failed === 0, cloudRows(pid).join(' '));
    state.mapathon = { pid, joinUrl: link.json.joinUrl, plot: theirs.m2[0] };
    save();
  },

  // 8. The same person on two computers: what they saved on one comes to the other, and a newer save replaces an older
  async 'two-computers'() {
    const { joinUrl, plot } = state.mapathon;
    const coverage = async (id) =>
      (await fetch(`http://localhost:8028/earth/placemark-info-expanded?id=${encodeURIComponent(id)}`).then((r) => r.json())).inputFieldInfoByParameterName?.['collect_entity_land_cover[trees].code_coverage']?.value;
    rmSync(`${E}/home-m2-laptop`, { recursive: true, force: true });
    await startDesktop('m2-laptop');
    const joined = await joinFromDesktop(joinUrl, 'm2', 'm2-password', false);
    check('two computers: m2 signs in on a second computer with the link', joined.join?.status === 200, JSON.stringify(joined.join?.json).slice(0, 200));
    await waitRestart();
    await sleep(8000);
    check('two computers: the plot saved on the first computer is on the second, with its answer', sqliteRecords('m2-laptop').includes(plot) && (await coverage(plot)) === '40', `${sqliteRecords('m2-laptop').join(' ')} | ${await coverage(plot)}`);
    // m2 changes it on the laptop
    await sleep(1500);
    await savePlot(plot, '80');
    await syncNow();
    // the first computer starts again: the newer save replaces its older copy
    await startDesktop('m2');
    await sleep(10000);
    check('two computers: the first computer gets the newer save', (await coverage(plot)) === '80', `${await coverage(plot)}`);
    const st = (await desk('GET', '/api/cloud/state')).json?.sync;
    check('two computers: nothing is queued to be sent back', st?.pending === 0, JSON.stringify(st));
  },

  // 9. The person's plots kept up to date by Collect Earth (docs/plans/2026-11-16-plots-from-the-server.md, stage 2):
  // plots the coordinator gives or moves arrive and leave with no click; a record keeps its plot file's name; a
  // training set opens instead of the person's plots, and they come back
  async 'plots-update'() {
    const { pid } = state.mapathon;
    const token = await coordinator();
    const fileId = (await cloud('GET', `/v1/projects/${pid}/csv-files`, undefined, token)).json.csvFiles[0].id;
    const people = (await cloud('GET', `/v1/projects/${pid}/members`, undefined, token)).json.members;
    const id = (u) => people.find((m) => m.username === u).userId;
    const CHECK = ['-Dcollectearth.myPlotsCheckSeconds=15'];
    await startDesktop('m1', null, CHECK);
    const settings = (await desk('GET', '/api/settings')).json?.values ?? {};
    const plotFile = settings.csv ?? settings.sample_file ?? Object.values(settings).find((v) => String(v).endsWith('my-plots.csv'));
    check('plots: Collect Earth reads the person’s plots from its data folder', String(plotFile).includes('/CollectEarth/cloud/') && String(plotFile).endsWith('/my-plots.csv'), String(plotFile));
    let mine = (await desk('GET', '/api/cloud/myPlots')).json;
    check('plots: they come from the server, 5 of them', mine?.mode === 'myPlots' && mine?.plots === 5 && mine?.inUse === true, JSON.stringify(mine));
    const before = await plotIds();
    // the form keeps in the record the name of the plot file its plot comes from, not the copy's (the values it loads
    // for a plot and sends with every save)
    const formValues = (await fetch(`http://localhost:8028/earth/surveyForm/plot?id=${encodeURIComponent(before[0])}`).then((r) => r.json())).values ?? {};
    check('plots: a record keeps its plot file’s name', formValues.collect_text_plot_file === 'mapathon.csv', JSON.stringify(formValues).slice(0, 200));
    // the coordinator gives m1 m2's unfinished plots: they come by themselves
    await cloud('POST', `/v1/projects/${pid}/csv-files/${fileId}/move-unfinished`, { fromUserId: id('m2'), toUserId: id('m1') }, token);
    const until = async (test, ms = 60000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(2000)) if (test(await plotIds())) return true;
      return false;
    };
    check('plots: plots given while Collect Earth runs come with no click', await until((ids) => ids.length > 5), (await plotIds()).join(' '));
    const notices = (await desk('GET', '/api/notices')).json;
    check('plots: a notice says what changed', JSON.stringify(notices ?? '').includes('cloudMyPlots'), JSON.stringify(notices).slice(0, 200));
    // and taken away: m1's unfinished plots go to m2
    await cloud('POST', `/v1/projects/${pid}/csv-files/${fileId}/move-unfinished`, { fromUserId: id('m1'), toUserId: id('m2') }, token);
    check('plots: plots moved to someone else leave with no click', await until((ids) => ids.length < 5), (await plotIds()).join(' '));
    // Refresh now answers at once
    const refreshed = (await desk('POST', '/api/cloud/myPlots/refresh', {})).json;
    check('plots: Refresh now asks the server', ['UNCHANGED', 'UPDATED'].includes(refreshed?.outcome), JSON.stringify(refreshed));
    // a training set m1 takes part in opens instead of their plots, then they go back
    const demo = demoPlotFile().toString('utf8').trim().split(/\r?\n/);
    const practiceCsv = [demo[0], ...[1, 2].map((n) => [`training_${n}`, ...demo[n].split(',').slice(1)].join(','))].join('\n') + '\n';
    const set = await cloud('PUT', `/v1/projects/${pid}/training-sets/practice.csv`, practiceCsv, token, 'text/csv');
    check('plots: the coordinator makes a training set', set.status === 201, JSON.stringify(set.json).slice(0, 200));
    await cloud('PUT', `/v1/projects/${pid}/training/${set.json?.id}/members`, { userIds: [id('m1')] }, token);
    const listed = (await desk('GET', '/api/cloud/assignments')).json?.assignments ?? [];
    const practice = listed.find((a) => a.training);
    const opened = (await desk('POST', '/api/cloud/training/open', { id: practice?.id })).json;
    check('plots: a training set opens instead of the person’s plots', Boolean(opened?.training) && (await until((ids) => ids.some((p) => p.startsWith('training_')), 20000)), `${JSON.stringify(opened)} | ${(await plotIds()).join(' ')}`);
    await sleep(20000); // a check meanwhile leaves it open
    check('plots: the checks leave the training set open', (await plotIds()).some((p) => p.startsWith('training_')), (await plotIds()).join(' '));
    const back = (await desk('POST', '/api/cloud/myPlots/use', {})).json;
    check('plots: back to my plots', back?.training === null && back?.inUse === true && (await until((ids) => !ids.some((p) => p.startsWith('training_')), 20000)), JSON.stringify(back));
  },

  // 10. Working alone with the project's plots (docs/plans/2026-11-16-plots-from-the-server.md, stage 4): the project
  // file downloaded with a person's plots, or all of them, opened on a computer that never joined, as a local
  // project; the work done there sent to the cloud once the person joins
  async standalone() {
    const { pid, joinUrl } = state.mapathon;
    const token = await coordinator();
    const m2 = await cloudLogin('m2', 'm2-password');
    const download = async (query, who, file) => {
      const res = await fetch(`${CLOUD}/v1/projects/${pid}/cep/standalone?${query}`, { headers: { authorization: `Bearer ${who}` } });
      if (res.ok) writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return { status: res.status, plots: Number(res.headers.get('x-plots')), name: res.headers.get('content-disposition') };
    };
    const hers = `${E}/standalone-m2.cep`;
    const all = `${E}/standalone-all.cep`;
    const mine = await download('plots=mine', m2, hers);
    const theirs = (await (await fetch(`${CLOUD}/v1/projects/${pid}/my-plots.csv`, { headers: { authorization: `Bearer ${m2}` } })).text())
      .trim().split(/\r?\n/).slice(1).map((l) => l.split(',').slice(0, 2).join(',')).sort(); // id,round
    check('standalone: a collector downloads the project file with their own plots', mine.status === 200 && mine.plots === theirs.length && theirs.length > 0, JSON.stringify(mine));
    const everything = await download('plots=all', token, all);
    const demoCount = demoPlotFile().toString('utf8').trim().split(/\r?\n/).length - 1;
    check('standalone: the coordinator downloads it with all the plots', everything.status === 200 && everything.plots === demoCount, JSON.stringify(everything));
    check('standalone: a collector cannot download everyone’s plots', (await download('plots=all', m2, `${E}/refused.cep`)).status === 403);

    // a computer that never joined, where there is no server: the file opens as a local project with her plots
    rmSync(`${E}/home-away`, { recursive: true, force: true });
    await startDesktop('away');
    const imported = await desk('POST', '/api/projects/import', { path: hers });
    await waitRestart();
    const st = (await desk('GET', '/api/cloud/state')).json;
    const s = (await desk('GET', '/api/settings')).json?.values ?? {};
    check('standalone: Collect Earth opens it as a local project, on its own database', st?.project?.mode === 'local' && s.db_driver !== 'CLOUD', `${JSON.stringify(imported.json)} ${st?.project?.mode} ${s.db_driver}`);
    const ids = (await plotIds()).sort();
    check('standalone: its plots are hers, and only hers', JSON.stringify(ids) === JSON.stringify(theirs), `${ids.join(' ')} | ${theirs.join(' ')}`);
    check('standalone: the plot file is the one the project names', String(s.csv ?? '').endsWith('.csv') && !String(s.csv).includes('/cloud/'), String(s.csv));
    const plot = ids.find((p) => p !== state.mapathon.plot) ?? ids[0];
    // with no name yet, nothing is stored: a plot without one would be nobody's, and not sent as hers
    const unnamed = await (await fetch('http://localhost:8028/earth/save-data-expanded', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ placemarkId: plot, currentStep: '0', partialUpdate: 'true', 'values[collect_entity_land_cover[trees].code_coverage]': '70' }) })).json();
    check('standalone: before she has typed her name, a save is refused and says why', unnamed.success === false && /name/i.test(unnamed.message ?? '') && !sqliteRecords('away').includes(plot), JSON.stringify(unnamed).slice(0, 200));
    check('standalone: she types her name, as anyone working alone does', (await setOperator('Maria Dos')).status === 200);
    check('standalone: she saves a plot there', await savePlot(plot, '70'));
    await sleep(3000);
    check('standalone: it is in the computer’s database', sqliteRecords('away').includes(plot), sqliteRecords('away').join(' '));

    // back where there is internet: she joins, and what she did is sent under her account
    const joined = await joinFromDesktop(joinUrl, 'm2', 'm2-password', false);
    check('standalone: back online, she joins the project from that computer', joined.join?.status === 200, JSON.stringify(joined.join?.json).slice(0, 200));
    await waitRestart();
    const local = (await desk('GET', '/api/cloud/localRecords')).json;
    check('standalone: Collect Earth counts the plot done alone as hers', local?.count >= 1 && local?.others === 0, JSON.stringify(local));
    const sent = await job('/api/jobs/sendToCloud');
    const answer = sql('cloud', `select regexp_replace(substring(xml from '<coverage>\\s*<code>[^<]*</code>'), '\\s+', '', 'g') from records where project_id='${pid}' and record_key='${plot}' and operator='m2' and not deleted`)[0] ?? 'none';
    check('standalone: sending puts it in the cloud as m2’s, with her answer', ['SUCCEEDED', 'DONE', 'FINISHED'].includes(sent.state) && answer === '<coverage><code>70</code>', `${sent.state} ${plot}: ${answer}`);

    // and the file with all the plots, on another computer
    rmSync(`${E}/home-away-all`, { recursive: true, force: true });
    await startDesktop('away-all');
    await desk('POST', '/api/projects/import', { path: all });
    await waitRestart();
    check('standalone: the file with all the plots opens with all of them', (await plotIds()).length === demoCount, `${(await plotIds()).length} of ${demoCount}`);
  },

  // 6. Accounts: what people see when something is wrong
  async accounts() {
    const project = state.cloud;
    rmSync(`${E}/home-mistakes`, { recursive: true, force: true }); // a computer that never joined
    await startDesktop('mistakes');
    const taken = await joinFromDesktop(project.joinUrl, 'ana', 'other-password', true);
    check('accounts: registering a name that is taken is refused in plain words', taken.join?.json?.error === 'cloud.usernameTaken', JSON.stringify(taken.join?.json).slice(0, 200));
    const wrong = await joinFromDesktop(project.joinUrl, 'bruno', 'not-his-password', false);
    check('accounts: a wrong password is refused in plain words', wrong.join?.json?.error === 'cloud.invalidCredentials', JSON.stringify(wrong.join?.json).slice(0, 200));
    const short = await joinFromDesktop(project.joinUrl, 'newperson', 'short', true);
    check('accounts: a too short password is refused before the server is asked', short.join?.status >= 400, JSON.stringify(short.join?.json).slice(0, 200));
    const bad = await joinFromDesktop(`${project.joinUrl}x`, 'newperson', 'newperson-pw', true);
    check('accounts: a wrong link is said to be not valid, at once', bad.preview?.json?.error === 'cloud.inviteInvalid', JSON.stringify(bad.preview?.json).slice(0, 200));
    const st = (await desk('GET', '/api/cloud/state')).json;
    check('accounts: after the refusals the desktop is still the local project', st?.project?.mode === 'local');
    // someone already in the project joins again with the link (a new computer)
    const again = await joinFromDesktop(project.joinUrl, 'ana', 'ana-password', false);
    check('accounts: a member joining again on another computer signs in', again.join?.status === 200, JSON.stringify(again.join?.json).slice(0, 200));
  },
};

const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
for (const name of chosen) {
  console.log(`\n=== ${name}`);
  try {
    await scenarios[name]();
  } catch (e) {
    check(`${name}: ran to the end`, false, e.stack?.split('\n').slice(0, 3).join(' | '));
  }
}
stopDesktops();
writeFileSync(`${E}/results-${Date.now()}.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => r.ok === false).length;
console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed`);
// For CI (.github/workflows/workflows-e2e.yml): a failed check fails the run
process.exitCode = failed > 0 ? 1 : 0;
