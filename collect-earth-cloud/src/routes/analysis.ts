import { audit } from '../activity.js';
import { isPositionKey, withoutPositions } from '../positions.js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { analysisModel, analysisTables, ATTRIBUTE_AREAS_CSV, csvTextOf, expansionFactors, recordId, REGION_AREAS_CSV, type AnalysisModel, type AnalysisRecord, type Factors } from '../analysis.js';
import { earlierTotalArea, strataFactors, strataOfFile, totalFactors } from '../areas.js';
import { plotFileOf } from '../plotFileCache.js';
import { fileKeyCount } from '../rounds.js';
import type { RoundInfo } from '../types.js';
import { readCep } from '../cep.js';
import { attachment } from '../download.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import { periodSummaryKey, withPeriodColumns } from '../repeatSurvey.js';
import type { Store } from '../store/store.js';
import type { RecordRow, SharedAnalysisView } from '../types.js';
import type { AnalysisAnswer, AreasSource, SharedAnalysisViewsAnswer, StandaloneAnalysis } from '../wire/analysis.js';

/** The stand-alone page in the built dashboard, and where its data goes in it (web/standalone.config.ts writes both). */
export const STANDALONE_FILE = 'analysis-standalone.html';
export const STANDALONE_DATA = '<!--CE_ANALYSIS_DATA-->';

/** The stand-alone page of the built dashboard (read again when the file changes), or null when it was not built. */
let template: { path: string; mtimeMs: number; html: string } | null = null;
function standaloneTemplate(webDir: string | null): string | null {
  if (!webDir) return null;
  const path = join(webDir, STANDALONE_FILE);
  try {
    const { mtimeMs } = statSync(path);
    if (!template || template.path !== path || template.mtimeMs !== mtimeMs) template = { path, mtimeMs, html: readFileSync(path, 'utf8') };
    return template.html.includes(STANDALONE_DATA) ? template.html : null;
  } catch {
    return null;
  }
}

/** At most so many shared views per project, each at most so big (a view is a few kilobytes). */
const MAX_VIEWS = 200;
const MAX_VIEW_BYTES = 64 * 1024;

export type Parsed = { model: AnalysisModel; regionAreas?: string; attributeAreas?: string } | null;
/** The model of the last project files, by checksum (reading a survey takes a moment; the file changes rarely). */
const models = new Map<string, Parsed>();
const MAX_MODELS = 8;

export function modelOf(cep: Buffer): Parsed {
  const checksum = createHash('sha256').update(cep).digest('hex');
  if (models.has(checksum)) return models.get(checksum)!;
  let out: Parsed = null;
  try {
    const files = readCep(cep);
    const text = (path: string) => {
      // the file at the root of the project file, whatever its folder inside the zip
      const entry = [...files.entries].find(([name]) => name === path || name.endsWith(`/${path}`));
      return entry ? csvTextOf(entry[1]) : undefined;
    };
    out = { model: analysisModel(new TextDecoder().decode(files.entries.get(files.surveyPath)!)), regionAreas: text(REGION_AREAS_CSV), attributeAreas: text(ATTRIBUTE_AREAS_CSV) };
  } catch {
    out = null;
  }
  models.set(checksum, out);
  if (models.size > MAX_MODELS) models.delete(models.keys().next().value!);
  return out;
}

/**
 * `GET /v1/projects/:pid/analysis`: what the dashboard's analysis page (the Saiku replacement) needs, in one answer,
 * gzipped when the browser takes it: the model of the survey (tables, columns, labels, code lists) and the rows of every
 * table as CSV with their DuckDB types, plus the expansion factors from the project file's areas file.
 *
 * Who sees what: coordinators and reviewers every record of the project, the round and whether it is a first assessment
 * or a check included; a collector their own records only, without the round (nothing tells them which of their plots are
 * checks, as on My work). Training records are never in it (they are kept apart). The local mode has its one account as
 * coordinator: everything.
 */
export async function registerAnalysisRoutes(app: FastifyInstance, store: Store, states: ProjectStateCache, webDir: string | null = null): Promise<void> {
  const member = { preHandler: requireProjectMembership(store) };
  app.get('/v1/projects/:pid/analysis', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = await analysisPayload(request, reply);
    if (!payload) return reply;
    const body = JSON.stringify(payload);
    reply.header('cache-control', 'no-store').type('application/json; charset=utf-8');
    if (/\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
      return reply.header('content-encoding', 'gzip').send(gzipSync(body, { level: 6 }));
    }
    return reply.send(body);
  });

  /**
   * `GET /v1/projects/:pid/analysis/standalone`: the analysis as one HTML file that opens in any browser with no server,
   * no internet and no installation (what replaces the stand-alone Saiku tool): the dashboard's stand-alone page (built
   * into web/dist by web/standalone.config.ts) with the same data as the page above, for whoever asks (a collector their
   * own records), gzipped inside it.
   */
  app.get('/v1/projects/:pid/analysis/standalone', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const template = standaloneTemplate(webDir);
    if (!template) return reply.code(404).send({ error: 'no_standalone', message: 'This server was installed without the stand-alone analysis page.' });
    // Without plot locations (?coordinates=none): a file to share with whoever only needs the figures
    const noPositions = withoutPositions(request.query);
    const payload = await analysisPayload(request, reply, noPositions);
    if (!payload) return reply;
    const project = await store.getProject(request.membership!.projectId);
    const records = payload.tables.find((t) => t.name === 'plot')?.rows ?? 0;
    // A file that is easy to pass around: who took it, and whether with the plots' places
    await audit(store, request, 'export.downloaded', { kind: 'analysis', records, coordinates: !noPositions });
    const made = new Date();
    const data: StandaloneAnalysis = { ...payload, project: { id: request.membership!.projectId, name: project?.name ?? '' }, made: made.toISOString(), withoutPositions: noPositions };
    const embedded = `<script>window.__CE_ANALYSIS=${JSON.stringify(gzipSync(JSON.stringify(data), { level: 6 }).toString('base64'))}</script>`;
    // A function replacement: a replacement string would read "$&" or "$`" in the data as patterns
    const html = template.replace(STANDALONE_DATA, () => embedded);
    return reply
      .header('cache-control', 'no-store')
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-disposition', attachment(`${project?.name ?? 'project'} - analysis ${made.toISOString().slice(0, 10)}.html`, 'analysis.html'))
      .send(html);
  });

  /** The page's data for whoever asks, or null when an error was sent instead. */
  async function analysisPayload(request: FastifyRequest, reply: FastifyReply, noPositions = false): Promise<AnalysisAnswer | null> {
    const projectId = request.membership!.projectId;
    const role = request.membership!.role;
    const cep = await store.getCep(projectId);
    if (!cep) {
      reply.code(404).send({ error: 'no_project_file', message: 'Upload the project file first: the analysis is built from its survey.' });
      return null;
    }
    const read = modelOf(cep);
    // The places of the plots left out, when asked: their columns are not in the model, so not in the tables
    const parsed = read && noPositions ? { ...read, model: modelWithoutPositions(read.model) } : read;
    if (!parsed) {
      reply.code(409).send({ error: 'survey_unreadable', message: 'The survey of the project file cannot be read.' });
      return null;
    }

    const [served, rows] = await Promise.all([states.get(projectId, request.log), store.listRecordSummaries(projectId, { firstSubmissions: true })]);
    const { context } = served.state;
    const resolve = recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders });
    const everyone = role === 'admin' || role === 'reviewer';
    const username = everyone ? null : (served.members.find((m) => m.userId === request.userId)?.username ?? null);

    // A repeat survey's earlier periods: their answers as columns of the plot table, by the plot as they are kept
    const repeat = await store.getRepeatSettings(projectId);
    const periods = repeat
      ? await Promise.all(repeat.earlier.map(async (p) => ({ label: p.label, byPlot: new Map((await store.listPeriodAnswers(projectId, p.label)).map((a) => [a.plotKey, a.answers])) })))
      : [];
    const model = withPeriodColumns(parsed.model, periods.map((p) => ({ label: p.label, answered: new Set([...p.byPlot.values()].flatMap((a) => Object.keys(a).filter((k) => a[k] !== ''))) })));
    const withEarlier = (summary: Record<string, string>, plot: string): Record<string, string> => {
      if (model === parsed.model) return summary;
      const out = { ...summary };
      for (const p of periods) for (const [k, v] of Object.entries(p.byPlot.get(plot) ?? {})) out[periodSummaryKey(p.label, k)] = v;
      return out;
    };

    const records: AnalysisRecord[] = [];
    for (const r of rows) {
      if (r.deleted) continue;
      if (!everyone && r.operator !== username) continue;
      const { unit, round } = resolve(r);
      records.push({
        recordKey: r.recordKey,
        operator: r.operator,
        plot: unit,
        round: round.round,
        assessment: round.assessment,
        submitted: r.activelySaved,
        modifiedOn: r.modifiedOn,
        summary: withEarlier(r.summary, round.plot),
      });
    }

    // The expansion factors are the plots', from their first assessments: over the whole project, whoever asks
    const firsts = firstAssessments(rows, resolve);
    const factors = await projectFactors(store, projectId, parsed, firsts, context.info);

    const tables = analysisTables(model, records, factors ? factorsByRecord(factors, firsts) : null, { hideRounds: !everyone });
    return {
      model,
      scope: everyone ? 'project' : 'own',
      areas: factors
        ? { source: factors.source, plots: factors.byPlot.size, unmatched: factors.unmatched, unknownColumns: factors.unknownColumns, noStratum: factors.noStratum }
        : null,
      tables,
    };
  }

  // The views a coordinator shares with the team: everyone in the project sees them, coordinators save and delete them
  app.get('/v1/projects/:pid/analysis/views', member, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.header('cache-control', 'no-store').send({ views: await store.getAnalysisViews(request.membership!.projectId) } satisfies SharedAnalysisViewsAnswer);
  });

  const coordinator = { preHandler: requireProjectMembership(store, 'admin') };
  app.put('/v1/projects/:pid/analysis/views', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const table = typeof body.table === 'string' ? body.table : '';
    const language = typeof body.language === 'string' ? body.language : '';
    const config = body.config;
    if (!name || name.length > 80 || !table || table.length > 200 || !language || language.length > 10 || !config || typeof config !== 'object' || Array.isArray(config)) {
      return reply.code(400).send({ error: 'invalid_view', message: 'A view needs a name (at most 80 characters), its table, its language and its configuration.' });
    }
    if (Buffer.byteLength(JSON.stringify(config)) > MAX_VIEW_BYTES) return reply.code(413).send({ error: 'view_too_large', message: 'This view is too large to share.' });
    const projectId = request.membership!.projectId;
    const [views, served] = await Promise.all([store.getAnalysisViews(projectId), states.get(projectId, request.log)]);
    const others = views.filter((v) => !(v.name === name && v.table === table));
    if (others.length >= MAX_VIEWS) return reply.code(409).send({ error: 'too_many_views', message: `A project shares at most ${MAX_VIEWS} views: delete some first.` });
    const savedBy = served.members.find((m) => m.userId === request.userId)?.username ?? '';
    const view: SharedAnalysisView = { name, table, language, config: config as Record<string, unknown>, savedBy, savedAt: Date.now() };
    const next = [...others, view].sort((a, b) => a.name.localeCompare(b.name) || a.table.localeCompare(b.table));
    await store.setAnalysisViews(projectId, next);
    return reply.send({ views: next } satisfies SharedAnalysisViewsAnswer);
  });

  app.delete('/v1/projects/:pid/analysis/views', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, unknown>;
    const name = typeof q.name === 'string' ? q.name : '';
    const table = typeof q.table === 'string' ? q.table : '';
    const projectId = request.membership!.projectId;
    const views = await store.getAnalysisViews(projectId);
    const next = views.filter((v) => !(v.name === name && v.table === table));
    if (next.length === views.length) return reply.code(404).send({ error: 'not_found' });
    await store.setAnalysisViews(projectId, next);
    return reply.send({ views: next } satisfies SharedAnalysisViewsAnswer);
  });
}

/**
 * The first assessment of each plot of the project, by plot unit: submitted, not deleted, not a check (training records
 * are kept apart, never listed). What the expansion factors and the uncertainty (routes/uncertainty.ts) are worked out from.
 */
export interface FirstAssessment {
  recordKey: string;
  operator: string;
  summary: Record<string, string>;
}
export function firstAssessments(rows: readonly RecordRow[], resolve: ReturnType<typeof recordResolver>): Map<string, FirstAssessment> {
  const firsts = new Map<string, FirstAssessment & { at: number }>();
  for (const r of rows) {
    if (r.deleted || !r.activelySaved) continue;
    const { unit, round } = resolve(r);
    if (unit === null || round.assessment !== 'main') continue;
    // several main assessments of a plot: the first submitted, whatever order the store lists them in
    const at = r.firstSubmittedOn ?? r.modifiedOn;
    const had = firsts.get(unit);
    if (had && (had.at < at || (had.at === at && recordId(had.recordKey, had.operator) <= recordId(r.recordKey, r.operator)))) continue;
    firsts.set(unit, { recordKey: r.recordKey, operator: r.operator, summary: r.summary, at });
  }
  return firsts;
}

/**
 * The expansion factors of the plots: from the project's strata and areas set on the dashboard (src/areas.ts), else the
 * project file's areas file, else a total area typed before on another page (earlierTotalArea); null when there is none
 * of them. The analysis, the uncertainty, the IPCC files and a repeat survey's change areas all read them here.
 */
export async function projectFactors(
  store: Store,
  projectId: string,
  parsed: NonNullable<Parsed>,
  firsts: ReadonlyMap<string, FirstAssessment>,
  info: RoundInfo | null,
  files: PlotFiles = plotFilesOf(store, projectId),
): Promise<Factors | null> {
  const settings = await store.getAreaSettings(projectId);
  if (settings?.mode === 'total') return totalFactors(settings.area, firsts.keys());
  if (settings?.mode === 'strata') {
    const { values, unknownColumns } = await strataValues(files, parsed.model, info, settings.columns, firsts);
    return strataFactors(settings, values, { source: 'strata', unknownColumns });
  }
  if (parsed.regionAreas) return expansionFactors(parsed.regionAreas, new Map([...firsts].map(([unit, f]) => [unit, f.summary])), parsed.model);
  // The project file's areas_per_attribute.csv: its columns read as the dashboard's strata are, plot files included
  const file = parsed.attributeAreas ? strataOfFile(parsed.attributeAreas) : null;
  if (file) {
    const { values, unknownColumns } = await strataValues(files, parsed.model, info, file.areas.columns, firsts);
    return strataFactors(file.areas, values, { source: ATTRIBUTE_AREAS_CSV, unknownColumns, unmatched: file.unreadable });
  }
  const total = await earlierTotalArea(store, projectId);
  return total ? totalFactors(total, firsts.keys()) : null;
}

/** Where the areas come from, in projectFactors' order: the dashboard's setting, a file, or a total typed before. */
export async function areasSource(store: Store, projectId: string, parsed: NonNullable<Parsed>): Promise<AreasSource | null> {
  const settings = await store.getAreaSettings(projectId);
  if (settings) return settings.mode;
  if (parsed.regionAreas) return REGION_AREAS_CSV;
  if (parsed.attributeAreas) return ATTRIBUTE_AREAS_CSV;
  return (await earlierTotalArea(store, projectId)) ? 'total' : null;
}

/** The survey's plot question of a column's name (any case), or null: a column of the plot files only. */
export const questionOf = (model: AnalysisModel, name: string) =>
  model.tables[0].columns.find((c) => c.name === name) ?? model.tables[0].columns.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null;

/**
 * Each first-assessed plot's values of the strata's columns: a question of the survey from its answers, any other
 * column from the plot's row in the plot files. `unknownColumns`: in neither.
 */
export async function strataValues(
  plotFiles: PlotFiles,
  model: AnalysisModel,
  info: RoundInfo | null,
  columns: readonly string[],
  firsts: ReadonlyMap<string, FirstAssessment>,
): Promise<{ values: Map<string, (string | undefined)[]>; unknownColumns: string[] }> {
  const keys = columns.map((c) => questionOf(model, c)?.key ?? null);
  const files = keys.some((k) => k === null) ? await plotFileValues(plotFiles, info, columns) : null;
  // A column no question of the survey: the plot file's, else what Collect Earth sent as text (an older project's way)
  const sent = columns.map((c) => `collect_text_${c}`);
  const valueOf = (unit: string, summary: Record<string, string>, i: number) =>
    keys[i] !== null ? summary[keys[i]!] : (files?.values.get(unit)?.[i] ?? summary[sent[i]]);
  const values = new Map([...firsts].map(([unit, first]) => [unit, columns.map((_, i) => valueOf(unit, first.summary, i))] as const));
  const unknownColumns = columns.filter((_, i) => keys[i] === null && !files?.found[i] && ![...firsts.values()].some((f) => sent[i] in f.summary));
  return { values, unknownColumns };
}

/** The project's plot files, fetched at most once however many times they are asked for (in one request). */
export type PlotFiles = () => Promise<NonNullable<Awaited<ReturnType<Store['getCsvFile']>>>[]>;
export function plotFilesOf(store: Store, projectId: string): PlotFiles {
  let read: ReturnType<PlotFiles> | null = null;
  return () =>
    (read ??= store.listCsvFiles(projectId).then(async (metas) => {
      const files = await Promise.all(metas.map((m) => store.getCsvFile(projectId, m.id)));
      return files.filter((f) => f !== null);
    }));
}

/**
 * The plots' values of some columns of the plot files (by header, any case), by plot unit (a plot in several files: its
 * first row). `found`: whether each column is in some file. `headers`: the files' other columns, for choosing.
 */
export async function plotFileValues(
  plotFiles: PlotFiles,
  info: RoundInfo | null,
  columns: readonly string[],
): Promise<{ values: Map<string, (string | undefined)[]>; found: boolean[]; headers: string[] }> {
  const keyCount = fileKeyCount(info);
  const values = new Map<string, (string | undefined)[]>();
  const found = columns.map(() => false);
  const headers = new Map<string, string>();
  for (const file of await plotFiles()) {
    const parsedFile = plotFileOf(file, keyCount);
    const header = parsedFile.header?.fields ?? [];
    // the keys and the place (latitude, longitude) make no strata
    header.forEach((h, i) => {
      const name = h.trim();
      if (i >= keyCount + 2 && name !== '' && !headers.has(name.toLowerCase())) headers.set(name.toLowerCase(), name);
    });
    const at = columns.map((c) => header.findIndex((h) => h.trim().toLowerCase() === c.toLowerCase()));
    at.forEach((i, n) => {
      if (i >= 0) found[n] = true;
    });
    if (at.every((i) => i < 0)) continue;
    for (const row of parsedFile.rows) if (!values.has(row.id)) values.set(row.id, at.map((i) => (i >= 0 ? row.fields[i] : undefined)));
  }
  return { values, found, headers: [...headers.values()] };
}

/** The factors by the record that counts for each plot (its first assessment): what analysisTables writes. */
export function factorsByRecord(factors: Factors, firsts: ReadonlyMap<string, FirstAssessment>): Map<string, { factor: number; weight: number }> {
  const out = new Map<string, { factor: number; weight: number }>();
  for (const [unit, first] of firsts) {
    const f = factors.byPlot.get(unit);
    if (f) out.set(recordId(first.recordKey, first.operator), f);
  }
  return out;
}

/** The model with no column that says where a plot is (src/positions.ts). */
function modelWithoutPositions(model: AnalysisModel): AnalysisModel {
  return { ...model, tables: model.tables.map((t) => ({ ...t, columns: t.columns.filter((c) => !c.key || !isPositionKey(c.key)) })) };
}
