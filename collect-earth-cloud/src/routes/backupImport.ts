// A new project from a Collect Earth backup (docs/plans/2026-11-11-backup-import.md): the zip of Collect Earth's "Export
// data to XML (ZIP)" holds the survey and the records but neither the project file nor the plot file. The project file
// is made from the survey and the plot layout the coordinator confirms (the survey's plot area and number of points
// suggest one), and goes through the upload path every project file takes (acceptCep); the plots that have records are
// written from the records into a plot file of their own (…_done.csv when submitted), the others come from the original
// plot file when the coordinator adds it; the records are stored as a sync stores them, each with the summary Collect
// Earth makes of it (src/backupImport.ts), under the account the coordinator named for its collector or the name typed
// in Collect Earth.
//
// - POST /v1/projects/from-backup/preview { backup (base64), plotFile? (text) } -> what would be made: nothing stored.
// - POST /v1/projects/from-backup { backup, plotFile?, plotFileName?, layout?, collectors?, name? } -> 201 { projectId, … }:
//   who may make a project (projectCreation, maxProjectsPerUser) as for POST /v1/projects; the caller is its coordinator.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  BackupError,
  backupSurvey,
  layoutOf,
  openBackup,
  readBackupRecord,
  readRecord,
  suggestedLayout,
  type BackupRecord,
  type BackupSurvey,
  type BackupZip,
} from '../backupImport.js';
import { CepError, readCep } from '../cep.js';
import { madeProjectFile } from '../ceo/projectFile.js';
import type { PlotLayout } from '../ceo/plots.js';
import { checkUploadFits } from '../limits.js';
import { applyLww, recordEventOf } from '../lww.js';
import { plotFileCsv, type DesignedPlot } from '../plotDesign.js';
import { isNumber, parsePlotFile } from '../plots.js';
import { requireSession } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { acceptCep } from './platform.js';
import { plotFileFormat, type PlotFileFormat } from './plotDesign.js';
import { creationRefusal } from './projects.js';

interface ImportBody {
  /** the backup zip, in base64 */
  backup?: unknown;
  /** the project's original plot file (CSV), as text: the plots without records come from it */
  plotFile?: unknown;
  /** its name, for the stored plot file */
  plotFileName?: unknown;
  /** the plot layout (shape, points, spacing); the survey's suggestion otherwise */
  layout?: unknown;
  /** the collectors' names, as typed in Collect Earth: the username of an account to keep their records under */
  collectors?: unknown;
  /** the new project's name; the survey's by default */
  name?: unknown;
}

const MAX_NAME = 200;
/** Up to this many examples of a problem are named. */
const EXAMPLES = 5;

/** A backup's records, read: the ones that could not be, by their files. */
interface ReadBackup {
  zip: BackupZip;
  records: BackupRecord[];
  unreadable: string[];
}

function readAll(zip: BackupZip, survey: BackupSurvey = zip.survey): ReadBackup {
  const records: BackupRecord[] = [];
  const unreadable: string[] = [];
  for (const entry of zip.records) {
    try {
      records.push(readBackupRecord(survey, entry));
    } catch (e) {
      if (!(e instanceof BackupError)) throw e;
      unreadable.push(entry.name);
    }
  }
  return { zip, records, unreadable };
}

/** The body's backup, opened and read, or the answer refusing it */
function backupOf(body: ImportBody, reply: FastifyReply): ReadBackup | null {
  if (typeof body.backup !== 'string' || body.backup === '') {
    void reply.code(400).send({ error: 'bad_request', reason: 'backup must be the zip of the backup, in base64' });
    return null;
  }
  try {
    return readAll(openBackup(Buffer.from(body.backup, 'base64')));
  } catch (e) {
    if (e instanceof BackupError) {
      void reply.code(e.code === 'too_large' ? 413 : 400).send({ error: e.code === 'too_large' ? 'backup_too_large' : 'backup_unreadable', reason: e.message });
      return null;
    }
    if (e instanceof CepError) {
      void reply.code(400).send({ error: 'backup_unreadable', reason: e.message });
      return null;
    }
    throw e;
  }
}

/** The original plot file the coordinator added, checked: its rows' plots, or a reason in words. */
interface GivenPlotFile {
  data: Buffer;
  /** each row's plot (its key without the round), by row */
  rows: { plot: string; start: number; next: number }[];
  header: { start: number; next: number } | null;
}

function givenPlotFile(raw: unknown, keys: PlotFileFormat['keys'] | null): GivenPlotFile | string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return 'plotFile must be the text of the plot file (CSV)';
  const count = keys?.count ?? 1;
  const file = parsePlotFile(Buffer.from(raw, 'utf8'), count);
  if (file.rows.length === 0) return 'The plot file has no plots.';
  // Collect Earth's cloud places plots by latitude and longitude: a projected file (UTM, as EPSG:25831) is not read
  const projected = file.rows.find((r) => {
    const y = Number(r.fields[count]);
    const x = Number(r.fields[count + 1]);
    return !isNumber(r.fields[count] ?? '') || !isNumber(r.fields[count + 1] ?? '') || Math.abs(y) > 90 || Math.abs(x) > 180;
  });
  if (projected) {
    return `The plot file's coordinates are not latitudes and longitudes (plot ${projected.id}): a file in another coordinate system (UTM, for one) cannot be used here. Save it in EPSG:4326 first, or leave it out: the plots with records are made from the records.`;
  }
  const plotOf = (fields: string[]) => fields.slice(0, count).filter((_, i) => i !== keys?.roundIndex).join(',');
  return {
    data: file.data,
    rows: file.rows.map((r) => ({ plot: plotOf(r.fields), start: r.start, next: r.next })),
    header: file.header ? { start: file.header.start, next: file.header.next } : null,
  };
}

/** The round of a record (its round key's value), null when the survey has none. */
const roundOf = (survey: BackupSurvey, r: BackupRecord): string | null => {
  const i = survey.keys.findIndex((k) => k.name === 'round');
  return i < 0 ? null : r.keyValues[i];
};

/** What is made of a backup's plots: those done (a submitted record of the first round), with records, without place. */
function plotsOf(read: ReadBackup, firstRound: string | null) {
  const survey = read.zip.survey;
  const withRecords = new Map<string, DesignedPlot & { id: string }>();
  const done = new Set<string>();
  const noPlace = new Set<string>();
  for (const r of read.records) {
    const round = roundOf(survey, r);
    if (r.activelySaved && (round === null || firstRound === null || round === firstRound)) done.add(r.plotId);
    if (!r.location) {
      if (!withRecords.has(r.plotId)) noPlace.add(r.plotId);
      continue;
    }
    noPlace.delete(r.plotId);
    if (!withRecords.has(r.plotId)) {
      withRecords.set(r.plotId, {
        id: r.plotId,
        lat: r.location.lat,
        lon: r.location.lon,
        columns: Object.fromEntries(Object.entries(r.columns).map(([k, v]) => [k.toLowerCase(), v])),
      });
    }
  }
  return { withRecords, done, noPlace };
}

/** The collectors of the records: the names typed in Collect Earth, with their records' count, most first. */
function collectorsOf(records: readonly BackupRecord[]): { name: string; records: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.operator, (counts.get(r.operator) ?? 0) + 1);
  return [...counts].map(([name, n]) => ({ name, records: n })).sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
}

/** What the dashboard shows before anything is made. */
function preview(read: ReadBackup, plotFile: GivenPlotFile | null) {
  const survey = read.zip.survey;
  const firstRound = survey.keys.some((k) => k.name === 'round') ? '1' : null;
  const { withRecords, done, noPlace } = plotsOf(read, firstRound);
  const inFile = plotFile ? new Set(plotFile.rows.map((r) => r.plot)) : null;
  const toDo = inFile ? [...inFile].filter((p) => !done.has(p)).length : [...withRecords.keys()].filter((p) => !done.has(p)).length;
  const steps = { entry: 0, cleansing: 0, analysis: 0 };
  for (const r of read.records) steps[r.step === 3 ? 'analysis' : r.step === 2 ? 'cleansing' : 'entry']++;
  const submitted = read.records.filter((r) => r.activelySaved).length;
  return {
    name: survey.title || survey.surveyName,
    surveyName: survey.surveyName,
    surveyUri: survey.uri,
    records: {
      total: read.records.length,
      submitted,
      drafts: read.records.length - submitted,
      steps,
      unreadable: read.unreadable.length,
      unreadableExamples: read.unreadable.slice(0, EXAMPLES),
    },
    collectors: collectorsOf(read.records),
    plots: {
      /** plots with records, placed by them */
      withRecords: withRecords.size,
      /** of them, with a submitted record: the done file */
      done: [...withRecords.keys()].filter((p) => done.has(p)).length,
      /** plots whose records have no location: in no plot file unless the original one has them */
      withoutPlace: noPlace.size,
      withoutPlaceExamples: [...noPlace].slice(0, EXAMPLES),
      /** plots of the original plot file, null when none was given */
      inFile: inFile ? inFile.size : null,
      /** plots to give out */
      toDo,
      /** plots of the records not in the original plot file */
      notInFile: inFile ? [...withRecords.keys()].filter((p) => !inFile.has(p)).length : null,
    },
    layout: suggestedLayout(survey),
    survey: { plotAreaHa: survey.plotAreaHa, samplePoints: survey.samplePoints, plotColumns: survey.plotColumns },
  };
}

/** A record's XML with the round the server added to its survey, after its last key element (Collect reads any order). */
function withRound(xml: string, root: string, code: string): string {
  const open = new RegExp(`<${root}(\\s[^>]*)?>`).exec(xml);
  if (!open) return xml;
  const at = open.index + open[0].length;
  return `${xml.slice(0, at)}\n  <round>\n    <code>${code}</code>\n  </round>${xml.slice(at)}`;
}

export async function registerBackupImportRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/v1/projects/from-backup/preview', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as ImportBody;
    const read = backupOf(body, reply);
    if (!read) return reply;
    // The survey's own keys, as the project would have them (a survey without round gets one: id only in the file)
    const roundIndex = read.zip.survey.keys.findIndex((k) => k.name === 'round');
    const keys = { count: read.zip.survey.keys.length, roundIndex: roundIndex < 0 ? null : roundIndex, roundCode: '1' };
    const plotFile = givenPlotFile(body.plotFile, keys);
    if (typeof plotFile === 'string') return reply.code(400).send({ error: 'plot_file_unreadable', reason: plotFile });
    return reply.send(preview(read, plotFile));
  });

  app.post('/v1/projects/from-backup', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await store.getUserById(request.userId!);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const refused = await creationRefusal(store, user);
    if (refused) return reply.code(403).send(refused);
    const body = (request.body ?? {}) as ImportBody;
    const read = backupOf(body, reply);
    if (!read) return reply;
    const original = read.zip.survey;
    let layout: PlotLayout = suggestedLayout(original);
    if (body.layout !== undefined && body.layout !== null) {
      const asked = layoutOf(body.layout);
      if (typeof asked === 'string') return reply.code(400).send({ error: 'bad_request', reason: asked });
      layout = asked;
    }
    const asked = typeof body.name === 'string' ? body.name.trim() : '';
    const name = (asked || original.title || original.surveyName).slice(0, MAX_NAME);

    // Whose records: the accounts the coordinator named, checked before anything is made; the others keep the name typed
    // in Collect Earth, which must not be an account's (its records would be that person's)
    const named = body.collectors !== null && typeof body.collectors === 'object' && !Array.isArray(body.collectors) ? (body.collectors as Record<string, unknown>) : {};
    const operators = new Map<string, { username: string; userId: string | null }>();
    for (const { name: typed } of collectorsOf(read.records)) {
      const username = typeof named[typed] === 'string' ? (named[typed] as string).trim() : '';
      if (username) {
        const account = await store.getUserByUsername(username);
        if (!account || account.disabledAt) {
          return reply.code(400).send({ error: 'unknown_account', reason: `No account "${username}" can take the work of "${typed}" on this server.`, username });
        }
        operators.set(typed, { username: account.username, userId: account.id });
      } else if (typed !== '' && (await store.isAccountUsername(typed))) {
        return reply.code(400).send({
          error: 'name_is_account',
          reason: `"${typed}" is the name of an account on this server: choose that account (or another) for the records of "${typed}".`,
          name: typed,
        });
      } else {
        operators.set(typed, { username: typed, userId: null });
      }
    }

    const cep = madeProjectFile(
      {
        idml: original.xml,
        title: name,
        surveyName: original.surveyName,
        comment: 'Collect Earth project made from a backup of its data',
        columns: original.plotColumns,
        layout,
      },
      new Date(),
    );
    const { projectId } = await store.createProject({ name });
    await store.addMembership(projectId, user.id, 'admin');
    const accepted = await acceptCep(store, projectId, cep, request.log);
    if (!accepted.ok) {
      await store.deleteProject(projectId);
      return reply.code(accepted.status).send(accepted.body);
    }

    // The survey as served (a round, a note added): the records are read against it
    const stored = readCep((await store.getCep(projectId)) as Buffer);
    const servedXml = new TextDecoder().decode(stored.entries.get(stored.surveyPath)!);
    const served = backupSurvey(servedXml);
    const info = accepted.info;
    const firstRound = info.state !== 'none' ? info.roundCodes.find((c) => c.code !== info.reassessmentCode)?.code ?? null : null;
    const format = await plotFileFormat(store, projectId, request.log);
    const plotFile = givenPlotFile(body.plotFile, format?.keys ?? null);
    if (typeof plotFile === 'string') {
      await store.deleteProject(projectId);
      return reply.code(400).send({ error: 'plot_file_unreadable', reason: plotFile });
    }
    const { withRecords, done } = plotsOf(read, info.state === 'own' ? firstRound : null);

    // The plot files: the plots with a submitted record, made from the records; the others, from the original file
    // (its rows as they are) or, without it, from the records
    type StoredFile = { csvFileId: string; filename: string; plots: number };
    const storeFile = async (filename: string, data: Buffer): Promise<StoredFile | 'over'> => {
      const over = await checkUploadFits(store, projectId, { kind: 'csv', filename }, data.length);
      if (over) {
        await store.deleteProject(projectId);
        void reply.code(413).send(over);
        return 'over';
      }
      const meta = await store.putCsvFile(projectId, filename, data, parsePlotFile(data, format?.keys.count ?? 1).plotIds);
      return { csvFileId: meta.id, filename, plots: meta.plotCount };
    };
    const base = original.surveyName.replace(/[^\w.-]+/g, '_') || 'backup';
    let doneFile: StoredFile | null = null;
    let toDoFile: StoredFile | null = null;
    if (format) {
      const csv = (plots: (DesignedPlot & { id: string })[]) => Buffer.from(plotFileCsv(plots, format.keys, format.extra), 'utf8');
      const donePlots = [...withRecords.values()].filter((p) => done.has(p.id));
      if (donePlots.length > 0) {
        const kept = await storeFile(`${base}_plots_done.csv`, csv(donePlots));
        if (kept === 'over') return reply;
        doneFile = kept;
      }
      let toDo: Buffer | null = null;
      if (plotFile) {
        const rows = plotFile.rows.filter((r) => !done.has(r.plot));
        if (rows.length > 0) {
          toDo = Buffer.concat([
            ...(plotFile.header ? [plotFile.data.subarray(plotFile.header.start, plotFile.header.next)] : []),
            ...rows.map((r) => plotFile.data.subarray(r.start, r.next)),
          ]);
        }
      } else {
        const rest = [...withRecords.values()].filter((p) => !done.has(p.id));
        if (rest.length > 0) toDo = csv(rest);
      }
      if (toDo) {
        const asked = typeof body.plotFileName === 'string' ? body.plotFileName.trim().replace(/[^\w.-]+/g, '_') : '';
        const kept = await storeFile(plotFile && asked ? asked : `${base}_plots.csv`, toDo);
        if (kept === 'over') return reply;
        toDoFile = kept;
      }
    }

    // The records, as a sync stores them (last write wins, record events), each read against the served survey
    for (const { userId } of operators.values()) {
      if (userId && !(await store.listMemberships(userId)).some((m) => m.projectId === projectId)) await store.addMembership(projectId, userId, 'operator');
    }
    const addRound = info.state === 'added' && firstRound !== null;
    let records = 0;
    const receivedAt = Date.now();
    for (const r of read.records) {
      const xml = addRound ? withRound(r.xml, served.root, firstRound) : r.xml;
      let again: BackupRecord;
      try {
        again = readRecord(served, r.path, xml);
      } catch (e) {
        if (!(e instanceof BackupError)) throw e;
        continue;
      }
      const operator = operators.get(r.operator)!.username;
      const recordKey = again.keyValues.join(',');
      const modifiedOn = r.modifiedOn ?? receivedAt;
      const envelope = {
        recordKey,
        surveyUri: served.uri,
        operator,
        modifiedOn,
        activelySaved: r.activelySaved,
        step: r.step,
        xml,
        summary: again.summary,
        deleted: false,
        payloadVersion: 1,
        activeSeconds: null,
      };
      const kept = await store.putRecordWithEvent(projectId, recordKey, operator, (existing, submittedBefore) => {
        // Received when it was saved: it did not come late (the Progress tab's "work that arrives late")
        const { row, status } = applyLww(envelope, existing, modifiedOn);
        if (status !== 'stored') return null;
        const next = { ...row, projectId };
        return { row: next, event: recordEventOf(existing, next, submittedBefore) };
      });
      if (kept) records++;
    }

    try {
      await store.appendAudit(projectId, {
        actorUserId: user.id,
        action: 'project.imported',
        details: { source: 'backup', surveyUri: original.uri, records, collectors: operators.size, plotsWithRecords: withRecords.size, plotFile: plotFile !== null },
      });
      for (const file of [toDoFile, doneFile]) {
        if (file) await store.appendAudit(projectId, { actorUserId: user.id, action: 'csv.uploaded', details: { csvFileId: file.csvFileId, plots: file.plots } });
      }
    } catch (err) {
      request.log.error({ err }, 'audit log write failed');
    }
    request.log.info({ projectId, records, round: info.state }, 'project made from a Collect Earth backup');
    return reply.code(201).send({
      projectId,
      name,
      round: info.state,
      layout,
      plotFile: toDoFile,
      doneFile,
      records,
      // the plot files cannot be written when the survey identifies a plot by several keys (plotFileFormat)
      plotFilesMade: format !== null,
      collectors: [...operators].map(([typed, o]) => ({ name: typed, username: o.username, account: o.userId !== null })),
      // what the preview showed, for the report
      backup: preview(read, plotFile),
    });
  });
}
