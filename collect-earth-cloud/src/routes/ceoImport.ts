// A new project from a Collect Earth Online project (docs/plans/2026-11-09-ceo-bridge.md, B3 to C): the files a
// coordinator saved from CEO (get-project-by-id; get-project-plots for its plots; "Download Sample Data" for its
// answers), its survey, rules, plots and answers translated (src/ceo), shown as a report first, then made into a project
// whose project file goes through the upload path every project file takes (acceptCep), so the round, the note and the
// space limit apply as they do to any; its plots become its plot file, written as the plot design writes one. With the
// answers, the plots answered in CEO go in a plot file of their own (…_done.csv), and the answers become records, one
// per plot and CEO collector, stored as a sync stores them (last write wins, record events), under the account the
// coordinator named or a pseudonym (ceo-collector-N): no email is stored.
//
// - POST /v1/projects/from-ceo/fetch { ceoProjectId } -> { project, plots }: CEO's project and plot list as text, read
//   from app.collect.earth (CEO answers both without a login; its pages send no CORS headers, so the browser cannot).
// - POST /v1/projects/from-ceo/preview { ceoProject, ceoPlots?, ceoAnswers? } -> { name, ceoProjectId, counts, answers,
//   report }: nothing stored.
// - POST /v1/projects/from-ceo { ceoProject, ceoPlots?, ceoAnswers?, collectors?, name? } -> 201 { projectId, name,
//   round, plotFile, doneFile, records, collectors, counts, answers, report }: who may make a project (projectCreation,
//   maxProjectsPerUser) as for POST /v1/projects; the caller is its coordinator.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ceoRecords, submitted, type CeoPlotAnswers } from '../ceo/answers.js';
import { ceoSurvey, CeoImportError, type CeoSurvey } from '../ceo/index.js';
import { ceoProjectFile, reportText } from '../ceo/projectFile.js';
import { readCep } from '../cep.js';
import { checkUploadFits } from '../limits.js';
import { applyLww, recordEventOf } from '../lww.js';
import { plotFileCsv } from '../plotDesign.js';
import { parsePlotFile } from '../plots.js';
import { requireSession } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { acceptCep } from './platform.js';
import { plotFileFormat } from './plotDesign.js';
import { creationRefusal } from './projects.js';

interface ImportBody {
  /** the saved file: its JSON, or its text */
  ceoProject?: unknown;
  /** CEO's plot list (get-project-plots), as saved: its JSON, or its text; optional */
  ceoPlots?: unknown;
  /** CEO's sample data ("Download Sample Data", CSV), as its text; optional, with the plots (Part C) */
  ceoAnswers?: unknown;
  /** CEO's collectors by email: the username of an account to keep their records under; a pseudonym otherwise */
  collectors?: unknown;
  /** the new project's name; CEO's by default */
  name?: unknown;
}

/** The records of a collector given no account: ceo-collector-1, -2... */
const PSEUDONYM_PREFIX = 'ceo-collector-';

const MAX_NAME = 200;

/** What the dashboard shows of an import: the counts, and every entry */
function summary(s: CeoSurvey) {
  const r = s.report;
  return {
    ceoProjectId: s.project.id,
    counts: {
      questions: r.count('imported', 'question') + r.count('changed', 'question'),
      questionsChanged: r.count('changed', 'question'),
      questionsSkipped: r.count('skipped', 'question'),
      rules: r.count('imported', 'rule') + r.count('changed', 'rule'),
      rulesSkipped: r.count('skipped', 'rule'),
      /** null: no plots file */
      plots: s.plots ? s.plots.plots.length : null,
    },
    /** null: no answers file. The emails are the coordinator's to map (never stored: see collectors) */
    answers: s.answers
      ? { plots: s.answers.plots.length, flagged: s.answers.plots.filter((p) => p.flagged).length, collectors: s.answers.collectors }
      : null,
    report: r.entries,
  };
}

/** The plots answered in CEO (one answer submitted at least): their own plot file, not to be given out again. */
const answeredPlots = (answers: readonly CeoPlotAnswers[]) => new Set(answers.filter(submitted).map((p) => p.plot));

/** The survey of the body's CEO file, or the answer refusing it */
function translate(body: ImportBody, reply: FastifyReply): CeoSurvey | null {
  const asText = (raw: unknown) => (typeof raw === 'string' ? raw : raw !== null && typeof raw === 'object' ? JSON.stringify(raw) : null);
  const json = asText(body.ceoProject);
  if (json === null) {
    void reply.code(400).send({ error: 'bad_request', reason: 'ceoProject must be the project file saved from Collect Earth Online' });
    return null;
  }
  const plots = body.ceoPlots === undefined || body.ceoPlots === null ? undefined : asText(body.ceoPlots);
  if (plots === null) {
    void reply.code(400).send({ error: 'bad_request', reason: 'ceoPlots must be the plots file saved from Collect Earth Online' });
    return null;
  }
  const answers = body.ceoAnswers === undefined || body.ceoAnswers === null ? undefined : typeof body.ceoAnswers === 'string' ? body.ceoAnswers : null;
  if (answers === null) {
    void reply.code(400).send({ error: 'bad_request', reason: "ceoAnswers must be the text of CEO's sample data (CSV)" });
    return null;
  }
  if (answers !== undefined && plots === undefined) {
    void reply.code(400).send({ error: 'ceo_unreadable', reason: "The answers need the plots file too: save CEO's plot list (get-project-plots) as well." });
    return null;
  }
  try {
    return ceoSurvey(json, { ...(plots !== undefined ? { plots } : {}), ...(answers !== undefined ? { answers } : {}) });
  } catch (e) {
    if (e instanceof CeoImportError) {
      void reply.code(400).send({ error: 'ceo_unreadable', reason: e.message });
      return null;
    }
    throw e;
  }
}

/** The only place read from: a project number goes into these two fixed addresses. */
export const CEO_BASE = 'https://app.collect.earth/';
const CEO_TIMEOUT_MS = 60_000;
/** Most bytes read of one CEO answer (2616's plot list, 7,933 plots, is 1.2 MB). */
const MAX_CEO_BYTES = 50 * 1024 * 1024;

class CeoFetchError extends Error {}

/** The text CEO answers at `path`; throws CeoFetchError. */
async function ceoText(path: string, signal: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(CEO_BASE + path, { signal, redirect: 'error', headers: { accept: 'application/json' } });
  } catch (err) {
    throw new CeoFetchError(signal.aborted ? 'it took too long' : (err as Error).message);
  }
  if (!res.ok || !res.body) throw new CeoFetchError(`HTTP ${res.status}`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read().catch((err: Error) => {
      throw new CeoFetchError(signal.aborted ? 'it took too long' : err.message);
    });
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_CEO_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new CeoFetchError('its answer is larger than the server reads');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function registerCeoImportRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/v1/projects/from-ceo/fetch', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = ((request.body ?? {}) as { ceoProjectId?: unknown }).ceoProjectId;
    const id = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    // Digits only: nothing else of the caller's reaches the address
    if (!/^\d{1,12}$/.test(id)) return reply.code(400).send({ error: 'bad_request', reason: 'ceoProjectId must be the number of a CEO project' });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CEO_TIMEOUT_MS);
    try {
      const [project, plots] = await Promise.all([ceoText(`get-project-by-id?projectId=${id}`, abort.signal), ceoText(`get-project-plots?projectId=${id}`, abort.signal)]);
      // CEO answers a number it has no project for with a project of nulls
      let name: unknown = null;
      try {
        name = (JSON.parse(project) as { name?: unknown }).name;
      } catch {
        /* not JSON: refused below */
      }
      if (typeof name !== 'string') return reply.code(404).send({ error: 'ceo_not_found', reason: `Collect Earth Online has no project ${id}.` });
      return reply.send({ project, plots });
    } catch (err) {
      if (!(err instanceof CeoFetchError)) throw err;
      request.log.warn({ ceoProjectId: id, why: err.message }, 'Collect Earth Online could not be read');
      return reply.code(502).send({ error: 'ceo_unreachable', reason: `Collect Earth Online could not be read (${err.message}). Save its pages as files and drop them here instead.` });
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  });

  app.post('/v1/projects/from-ceo/preview', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const survey = translate((request.body ?? {}) as ImportBody, reply);
    if (!survey) return reply;
    return reply.send({ name: survey.project.name, ...summary(survey) });
  });

  app.post('/v1/projects/from-ceo', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await store.getUserById(request.userId!);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const refused = await creationRefusal(store, user);
    if (refused) return reply.code(403).send(refused);
    const body = (request.body ?? {}) as ImportBody;
    const survey = translate(body, reply);
    if (!survey) return reply;
    const asked = typeof body.name === 'string' ? body.name.trim() : '';
    const name = (asked || survey.project.name || `CEO project ${survey.project.id ?? ''}`.trim()).slice(0, MAX_NAME);

    // Whose records: the accounts the coordinator named (checked before anything is made), pseudonyms for the others
    const operators = new Map<string, { username: string; userId: string | null }>();
    if (survey.answers) {
      const named = body.collectors !== null && typeof body.collectors === 'object' && !Array.isArray(body.collectors) ? (body.collectors as Record<string, unknown>) : {};
      for (const { email } of survey.answers.collectors) {
        const username = typeof named[email] === 'string' ? (named[email] as string).trim() : '';
        if (!username) continue;
        const account = await store.getUserByUsername(username);
        if (!account || account.disabledAt) {
          return reply.code(400).send({ error: 'unknown_account', reason: `No account "${username}" can take the work of a CEO collector on this server.`, username });
        }
        operators.set(email, { username: account.username, userId: account.id });
      }
      let n = 0;
      for (const { email } of survey.answers.collectors) {
        if (operators.has(email)) continue;
        let pseudonym: string;
        do pseudonym = `${PSEUDONYM_PREFIX}${++n}`;
        while (await store.isAccountUsername(pseudonym));
        operators.set(email, { username: pseudonym, userId: null });
      }
    }

    const cep = ceoProjectFile(survey, new Date());
    const { projectId } = await store.createProject({ name });
    await store.addMembership(projectId, user.id, 'admin');
    const accepted = await acceptCep(store, projectId, cep, request.log);
    if (!accepted.ok) {
      // Nothing half made: the project goes with its refusal
      await store.deleteProject(projectId);
      return reply.code(accepted.status).send(accepted.body);
    }
    // Its plots, as the plot design writes a plot file, through what the plot-file upload stores and logs; with the
    // answers, the plots answered in CEO in a file of their own, so only the others are given out
    type StoredFile = { csvFileId: string; filename: string; plots: number };
    let plotFile: StoredFile | null = null;
    let doneFile: StoredFile | null = null;
    const format = survey.plots ? await plotFileFormat(store, projectId, request.log) : null;
    const storePlotFile = async (filename: string, plots: NonNullable<CeoSurvey['plots']>['plots']): Promise<StoredFile | 'over'> => {
      const data = Buffer.from(plotFileCsv(plots, format?.keys ?? { count: 1, roundIndex: null, roundCode: '1' }, format?.extra ?? null), 'utf8');
      const over = await checkUploadFits(store, projectId, { kind: 'csv', filename }, data.length);
      if (over) {
        await store.deleteProject(projectId);
        void reply.code(413).send(over);
        return 'over';
      }
      const meta = await store.putCsvFile(projectId, filename, data, parsePlotFile(data, format?.keys.count ?? 1).plotIds);
      return { csvFileId: meta.id, filename, plots: meta.plotCount };
    };
    if (survey.plots) {
      const done = survey.answers ? answeredPlots(survey.answers.plots) : new Set<string>();
      // with the columns of the plot file uploaded to CEO, read from its sample data
      const plotColumns = survey.answers?.plotColumns;
      const withColumns = survey.plots.plots.map((p) => {
        const values = plotColumns?.get(p.id);
        return values ? { ...p, columns: Object.fromEntries(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value])) } : p;
      });
      const toDo = withColumns.filter((p) => !done.has(p.id));
      const base = `ceo_${survey.project.id ?? 'project'}_plots`;
      if (toDo.length > 0) {
        const stored = await storePlotFile(`${base}.csv`, toDo);
        if (stored === 'over') return reply;
        plotFile = stored;
      }
      if (done.size > 0) {
        const stored = await storePlotFile(`${base}_done.csv`, withColumns.filter((p) => done.has(p.id)));
        if (stored === 'over') return reply;
        doneFile = stored;
      }
    }

    // CEO's answers, as records Collect Earth would have sent, stored as a sync stores them (last write wins, events)
    let records = 0;
    if (survey.answers && survey.plots && survey.answers.plots.length > 0) {
      for (const { userId } of operators.values()) {
        if (userId && !(await store.listMemberships(userId)).some((m) => m.projectId === projectId)) await store.addMembership(projectId, userId, 'operator');
      }
      const stored = readCep(await store.getCep(projectId) as Buffer);
      const surveyXml = new TextDecoder().decode(stored.entries.get(stored.surveyPath)!);
      const info = await store.getRoundInfo(projectId);
      const roundCode = info && info.state !== 'none' ? info.roundCodes.find((c) => c.code !== info.reassessmentCode)?.code ?? null : null;
      const done = answeredPlots(survey.answers.plots);
      const receivedAt = Date.now();
      const built = ceoRecords(survey.answers.plots, {
        surveyXml,
        roundCode,
        operatorOf: (email) => operators.get(email)!.username,
        plotFile: (done.size > 0 ? doneFile : plotFile)?.filename ?? '',
        centres: new Map(survey.plots.plots.map((p) => [p.id, { lat: p.lat, lon: p.lon }])),
        plotColumns: survey.answers.plotColumns,
        now: receivedAt,
      });
      for (const r of built) {
        const envelope = { recordKey: r.recordKey, surveyUri: `http://www.openforis.org/idm/${survey.surveyName}`, operator: r.operator, modifiedOn: r.modifiedOn,
          activelySaved: r.activelySaved, step: 1, xml: r.xml, summary: r.summary, deleted: false, payloadVersion: 1, activeSeconds: r.activeSeconds };
        const kept = await store.putRecordWithEvent(projectId, r.recordKey, r.operator, (existing, submittedBefore) => {
          // Received when it was saved in CEO: it did not come late (the Progress tab's "work that arrives late")
          const { row, status } = applyLww(envelope, existing, r.modifiedOn);
          if (status !== 'stored') return null;
          const next = { ...row, projectId };
          return { row: next, event: recordEventOf(existing, next, submittedBefore) };
        });
        if (kept) records++;
      }
    }
    const s = summary(survey);
    try {
      await store.appendAudit(projectId, {
        actorUserId: user.id,
        action: 'project.imported',
        details: {
          source: 'ceo',
          ceoProjectId: survey.project.id,
          questions: s.counts.questions,
          questionsChanged: s.counts.questionsChanged,
          questionsSkipped: s.counts.questionsSkipped,
          rules: s.counts.rules,
          rulesSkipped: s.counts.rulesSkipped,
          plots: s.counts.plots,
          ...(survey.answers ? { records, collectors: survey.answers.collectors.length } : {}),
        },
      });
      for (const file of [plotFile, doneFile]) {
        if (file) await store.appendAudit(projectId, { actorUserId: user.id, action: 'csv.uploaded', details: { csvFileId: file.csvFileId, plots: file.plots } });
      }
    } catch (err) {
      request.log.error({ err }, 'audit log write failed');
    }
    request.log.info({ projectId, ceoProjectId: survey.project.id, round: accepted.info.state }, 'project made from a Collect Earth Online project');
    // The collectors' names on this server, by CEO email: for the coordinator, who mapped them (never stored)
    const collectors = survey.answers ? survey.answers.collectors.map((c) => ({ ...c, username: operators.get(c.email)!.username })) : [];
    return reply.code(201).send({ projectId, name, round: accepted.info.state, plotFile, doneFile, records, reportText: reportText(survey), ...s, collectors });
  });
}
