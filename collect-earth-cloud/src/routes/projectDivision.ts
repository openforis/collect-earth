// One division over the project's plots (docs/plans/2026-11-16-plots-from-the-server.md, stage 3). The project's
// plots are one set (src/projectPlots.ts): its plot files are where they came from, and the coordinator divides the
// whole set once, moves someone's unfinished plots over the whole project, or takes plots for themselves, rather than
// file by file. The tools are those of one file (src/division.ts: evenly, by a column, overlap copies, the check
// draws and reference plots kept, order nearby along one curve), run over every plot file's plots together, and
// written back file by file in one transaction (Store.setDivisions). The routes answer as the file's do
// (CsvColumns, DistributionSummary, MoveUnfinishedAnswer), so the dashboard's forms serve both.
// - GET  /v1/projects/:pid/plots/columns           the columns of the project's plots (those of its plot files)
// - GET  /v1/projects/:pid/plots/division          who holds how many of the project's plots
// - PUT  /v1/projects/:pid/plots/division          a division over them ({mode: even | column, ...}, dryRun?)
// - POST /v1/projects/:pid/plots/move-unfinished   {fromUserId, toUserId, count?} over every plot file
// - POST /v1/projects/:pid/plots/take              {count, column?, value?}: the coordinator takes plots nobody holds
// A division over the project is refused while its plot files break the rules (409 not_one_set): they could not be
// one person's plots.
import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { audit } from '../activity.js';
import { divide, keptBy, moveUnfinished, parseDivisionRequest, submittedByPlot, summarize, type DistributionSummary } from '../division.js';
import { sameColumns } from '../myPlots.js';
import { nearbyAvailability, nearbyRanks, servedNearby } from '../nearby.js';
import { columnValues, plotColumns } from '../plotColumns.js';
import { plotFileOf } from '../plotFileCache.js';
import type { PlotFile, PlotRow } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { loadPlotContext, type Log } from '../qualityService.js';
import { fileKeyCount, keyShape, splitKey, unitOfRecord } from '../rounds.js';
import type { Store } from '../store/store.js';
import type { PlotAssignment, StoredDistribution } from '../types.js';
import type { CsvColumns, MoveUnfinishedAnswer, TakePlotsAnswer } from '../wire/plotFiles.js';
import { isWgs84, PlotPlaceReader } from './plotPlaces.js';

/** The most plots one move or take moves */
const MAX_MOVE = 20000;

/** Everything the routes need about the project's plots: every plot file, as one set */
async function loadProject(store: Store, projectId: string, log: Log) {
  const [metas, members, records, info, assignments, references] = await Promise.all([
    store.listCsvFiles(projectId),
    store.listMembers(projectId),
    // (who submitted what: no answers)
    store.listRecordStates(projectId),
    store.getRoundInfo(projectId),
    store.listAssignments(projectId),
    store.listReferencePlots(projectId),
  ]);
  const keyCount = fileKeyCount(info);
  const files: { id: string; filename: string; checksum: string; data: Buffer; distribution: StoredDistribution | null; plotFile: PlotFile }[] = [];
  for (const meta of metas) {
    const file = await store.getCsvFile(projectId, meta.id);
    if (file) files.push({ id: meta.id, filename: meta.filename, checksum: file.checksum, data: file.data, distribution: file.distribution ?? null, plotFile: plotFileOf(file, keyCount) });
  }
  // The columns: those of the file with the most plots; every other file's rows put in that order
  let reference: (typeof files)[number] | null = null;
  for (const f of files) if (!reference || f.plotFile.plotIds.length > reference.plotFile.plotIds.length) reference = f;
  const width = reference?.plotFile.columnCount ?? 0;
  const lead = keyCount + 2;
  const fileOf = new Map<string, string>();
  const broken: { csvFileId: string; filename: string; reason: 'columns_differ' | 'plots_in_other_file' }[] = [];
  const rows: PlotRow[] = [];
  const plotIds: string[] = [];
  for (const f of files) {
    const pf = f.plotFile;
    let order: number[] | null = null;
    if (f !== reference && reference) {
      const ok =
        reference.plotFile.header && pf.header
          ? (order = sameColumns(reference.plotFile.header.fields, pf.header.fields, lead)) !== null
          : reference.plotFile.columnCount === pf.columnCount;
      if (!ok) {
        broken.push({ csvFileId: f.id, filename: f.filename, reason: 'columns_differ' });
        continue;
      }
    }
    if (pf.plotIds.some((id) => fileOf.has(id))) broken.push({ csvFileId: f.id, filename: f.filename, reason: 'plots_in_other_file' });
    for (const id of pf.plotIds) {
      if (!fileOf.has(id)) {
        fileOf.set(id, f.id);
        plotIds.push(id);
      }
    }
    for (const row of pf.rows) {
      if (fileOf.get(row.id) !== f.id) continue;
      rows.push(order ? ({ ...row, fields: order.map((i) => row.fields[i] ?? '') } as PlotRow) : row);
    }
  }
  // The project's plots as one plot file (only what plotColumns and columnValues read of one)
  const combined = { header: reference?.plotFile.header ?? null, rows, plotIds, columnCount: width } as PlotFile;
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  const userIdByUsername = new Map(members.map((m) => [m.username, m.userId]));
  const { copyHolders } = await loadPlotContext(store, projectId, log, { info, members });
  const units = new Set(plotIds);
  const submitted = submittedByPlot(records, units, userIdByUsername, info, copyHolders);
  const kept = keptBy(submitted, records, units, userIdByUsername, info, copyHolders);
  const shape = keyShape(info);
  const plotOf =
    info?.state === 'own' && shape.roundIndex !== null ? (unit: string) => splitKey(unit, shape.count, shape.roundIndex).plot : (unit: string) => unit;
  // Who holds what: a whole file's people hold every plot of it
  const holdingsOf = new Map<string, PlotAssignment[]>();
  for (const f of files) {
    if (!fileOf.size || !f.plotFile.plotIds.some((id) => fileOf.get(id) === f.id)) {
      holdingsOf.set(f.id, []);
      continue;
    }
    const mine = (id: string) => fileOf.get(id) === f.id;
    holdingsOf.set(
      f.id,
      f.distribution
        ? (await store.listPlotAssignments(projectId, f.id)).filter((a) => mine(a.plotKey))
        : assignments.filter((a) => a.csvFileId === f.id).flatMap((a) => f.plotFile.plotIds.filter(mine).map((plotKey) => ({ plotKey, userId: a.userId, overlap: false }))),
    );
  }
  const referenceUnits = new Set(references.filter((r) => fileOf.get(r.plotKey) === r.csvFileId).map((r) => r.plotKey));
  return { info, keyCount, files, broken, combined, plotIds, fileOf, usernames, submitted, kept, plotOf, holdingsOf, referenceUnits, records };
}

type Project = Awaited<ReturnType<typeof loadProject>>;

/** The rule every plot file was divided by when it is the same for all (the project's division), else by hand */
function projectRule(project: Project): StoredDistribution | null {
  const rules = project.files.map((f) => (f.distribution ? JSON.stringify(f.distribution) : null));
  if (rules.length === 0 || rules.some((r) => r === null)) return rules.every((r) => r === null) ? null : { mode: 'manual' };
  return rules.every((r) => r === rules[0]) ? project.files[0].distribution : { mode: 'manual' };
}

function summaryOf(project: Project, holdings?: readonly PlotAssignment[], rule?: StoredDistribution | null): DistributionSummary {
  const all = holdings ?? [...project.holdingsOf.values()].flat();
  return summarize(rule === undefined ? projectRule(project) : rule, project.plotIds, all, project.submitted, project.usernames, project.referenceUnits);
}

/** The holdings split by plot file, each with its reference plots' as they are */
function byFile(project: Project, holdings: readonly PlotAssignment[]): Map<string, PlotAssignment[]> {
  const out = new Map<string, PlotAssignment[]>(project.files.map((f) => [f.id, []]));
  for (const a of holdings) out.get(project.fileOf.get(a.plotKey) ?? '')?.push(a);
  for (const [fileId, held] of project.holdingsOf) {
    for (const a of held) if (project.referenceUnits.has(a.plotKey)) out.get(fileId)?.push(a);
  }
  return out;
}

const NOT_ONE_SET = (broken: Project['broken']) => ({
  error: 'not_one_set',
  reason:
    "The project's plot files break the rules of one set of plots: a plot in two files, or a file whose columns differ. Fix them in Setup › Plots (replace or remove those files), then divide the project's plots.",
  files: broken,
});

export async function registerProjectDivisionRoutes(app: FastifyInstance, store: Store, placeReader = new PlotPlaceReader(store)): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  /** The places of the project's plots, and whether order nearby can be used */
  const nearbyOf = async (projectId: string, project: Project, log: FastifyRequest['log']) => {
    const { srid } = await placeReader.surveyFacts(projectId, log);
    const places = new Map<string, readonly [number, number]>();
    if (isWgs84(srid)) {
      for (const f of project.files) {
        const read = await placeReader.placesOfFile(projectId, f.id, f.checksum, project.keyCount, log, f);
        for (const [id, place] of read?.places ?? []) if (project.fileOf.get(id) === f.id) places.set(id, place);
      }
    }
    return { availability: nearbyAvailability(srid, places.size, project.plotIds.length), places };
  };

  app.get('/v1/projects/:pid/plots/columns', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const project = await loadProject(store, projectId, request.log);
    const { availability } = await nearbyOf(projectId, project, request.log);
    return reply.send({
      plotCount: project.plotIds.length,
      hasHeader: project.combined.header !== null,
      separator: ',',
      columns: plotColumns(project.combined),
      nearby: availability,
    } satisfies CsvColumns);
  });

  app.get('/v1/projects/:pid/plots/division', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const project = await loadProject(store, request.membership!.projectId, request.log);
    return reply.send(summaryOf(project));
  });

  // Body: a division ({mode: 'even' | 'column', ...}, the column one of GET plots/columns), optionally dryRun: true.
  app.put('/v1/projects/:pid/plots/division', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const project = await loadProject(store, projectId, request.log);
    if (project.broken.length > 0) return reply.code(409).send(NOT_ONE_SET(project.broken));
    if (project.plotIds.length === 0) return reply.code(409).send({ error: 'no_plots', reason: 'The project has no plots yet: add a plot file first.' });
    const dryRun = (request.body as { dryRun?: unknown } | null)?.dryRun === true;
    const parsed = parseDivisionRequest(request.body, new Set(project.usernames.keys()), project.combined.columnCount, () => randomInt(0, 2 ** 31));
    if ('reason' in parsed) return reply.code(400).send({ error: 'bad_request', reason: parsed.reason });
    if (parsed.mode === 'whole') {
      return reply.code(400).send({ error: 'bad_request', reason: "mode 'whole' is for one plot file: divide the project's plots evenly or by a column" });
    }
    let rank: ReadonlyMap<string, number> = new Map();
    if (parsed.order === 'nearby') {
      const nearby = await nearbyOf(projectId, project, request.log);
      if (!nearby.availability.available) return reply.code(400).send({ error: 'bad_request', reason: "order 'nearby' needs plots with latitude and longitude" });
      rank = nearbyRanks(project.plotIds, nearby.places);
    }
    const values = parsed.mode === 'column' ? columnValues(project.combined, parsed.column) : null;
    // The reference plots keep their assessor and copies; the copies the check sampling drew stay with their checkers
    const held = [...project.holdingsOf.values()].flat();
    const drawn = held.filter((a) => a.sampledAt !== undefined && !project.referenceUnits.has(a.plotKey));
    const refs = project.referenceUnits;
    const dealt = refs.size === 0 ? project.plotIds : project.plotIds.filter((id) => !refs.has(id));
    const dealtValues = refs.size === 0 || values === null ? values : values.filter((_, i) => !refs.has(project.plotIds[i]));
    const plots = divide(parsed, dealt, dealtValues, project.kept, project.plotOf, drawn, rank);
    const split = byFile(project, plots);
    if (!dryRun) {
      await store.setDivisions(
        projectId,
        project.files.map((f) => ({ csvFileId: f.id, distribution: parsed, plots: split.get(f.id) ?? [] })),
      );
      const people = new Set(plots.map((a) => a.userId)).size;
      await audit(store, request, 'division.applied', { scope: 'project', mode: parsed.mode, people, plots: project.plotIds.length });
    }
    return reply.send(summaryOf(project, [...split.values()].flat(), parsed));
  });

  // Body: {fromUserId, toUserId, count?}: the plots `from` has not submitted, in every plot file, to `to` (all, or the
  // last `count` of their list).
  app.post('/v1/projects/:pid/plots/move-unfinished', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const project = await loadProject(store, projectId, request.log);
    const body = (request.body ?? {}) as { fromUserId?: unknown; toUserId?: unknown; count?: unknown };
    const from = typeof body.fromUserId === 'string' ? body.fromUserId : '';
    const to = typeof body.toUserId === 'string' ? body.toUserId : '';
    if (!isUuid(from)) return reply.code(400).send({ error: 'bad_request', reason: 'fromUserId is required' });
    if (!project.usernames.has(to)) return reply.code(400).send({ error: 'bad_request', reason: 'toUserId must be a member of the project' });
    if (from === to) return reply.code(400).send({ error: 'bad_request', reason: 'fromUserId and toUserId are the same person' });
    const which: { count?: number } = {};
    if (body.count !== undefined) {
      if (typeof body.count !== 'number' || !Number.isInteger(body.count) || body.count < 1 || body.count > MAX_MOVE) {
        return reply.code(400).send({ error: 'bad_request', reason: `count must be a whole number from 1 to ${MAX_MOVE}` });
      }
      which.count = body.count;
    }
    // As a division: with a plot in two files, the file it is not counted in would be rewritten without it
    if (project.broken.length > 0) return reply.code(409).send(NOT_ONE_SET(project.broken));
    const held = [...project.holdingsOf.values()].flat().filter((a) => !project.referenceUnits.has(a.plotKey));
    if (!held.some((a) => a.userId === from)) {
      return reply.send({ ...summaryOf(project), moved: 0, notMoved: 0, droppedChecks: 0 } satisfies MoveUnfinishedAnswer);
    }
    const result = moveUnfinished(held, from, to, project.kept, project.plotOf, which);
    const split = byFile(project, result.plots);
    // Only the files `from` held plots of change (a whole file of theirs becomes divided, by hand)
    const touched = new Set(held.filter((a) => a.userId === from).map((a) => project.fileOf.get(a.plotKey)!));
    const manualOf = (d: StoredDistribution | null): StoredDistribution => (servedNearby(d) ? { mode: 'manual', order: 'nearby' } : { mode: 'manual' });
    await store.setDivisions(
      projectId,
      project.files.filter((f) => touched.has(f.id)).map((f) => ({ csvFileId: f.id, distribution: manualOf(f.distribution), plots: split.get(f.id) ?? [] })),
    );
    await audit(store, request, 'plots.moved', { scope: 'project', fromUserId: from, toUserId: to, moved: result.moved });
    const after = await loadProject(store, projectId, request.log);
    return reply.send({ ...summaryOf(after), moved: result.moved, notMoved: result.notMoved, droppedChecks: result.droppedChecks } satisfies MoveUnfinishedAnswer);
  });

  // Body: {count, column?, value?}: the coordinator takes `count` of the project's plots that nobody holds and nobody
  // submitted, in the project's order (of those with that value in that column, one of GET plots/columns). With a
  // project of hundreds of thousands of plots, a coordinator assesses the ones they choose, not all of them.
  app.post('/v1/projects/:pid/plots/take', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const userId = request.userId;
    if (!userId) return reply.code(403).send({ error: 'forbidden', reason: 'plots are taken by a person, not a project token' });
    const project = await loadProject(store, projectId, request.log);
    // A plot in two files could be taken twice, and plots of a file with other columns would never reach my-plots
    if (project.broken.length > 0) return reply.code(409).send(NOT_ONE_SET(project.broken));
    const body = (request.body ?? {}) as { count?: unknown; column?: unknown; value?: unknown };
    if (typeof body.count !== 'number' || !Number.isInteger(body.count) || body.count < 1 || body.count > MAX_MOVE) {
      return reply.code(400).send({ error: 'bad_request', reason: `count must be a whole number from 1 to ${MAX_MOVE}` });
    }
    let values: string[] | null = null;
    if (body.column !== undefined) {
      if (typeof body.column !== 'number' || !Number.isInteger(body.column) || body.column < 1 || body.column >= project.combined.columnCount || typeof body.value !== 'string') {
        return reply.code(400).send({ error: 'bad_request', reason: 'column: one of the columns of the project’s plots, with a value' });
      }
      values = columnValues(project.combined, body.column);
    }
    // Nobody holds it as main, nobody submitted it, no reference plot
    const heldMain = new Set([...project.holdingsOf.values()].flat().filter((a) => !a.overlap).map((a) => a.plotKey));
    const done = new Set<string>();
    // Once, not per record: plots × records was minutes for a big project
    const known = new Set(project.plotIds);
    for (const r of project.records) {
      if (!r.activelySaved || r.deleted) continue;
      const unit = unitOfRecord(r.recordKey, known, project.info);
      if (unit !== null) done.add(unit);
    }
    const free = project.plotIds.filter((id, i) => !heldMain.has(id) && !done.has(id) && !project.referenceUnits.has(id) && (values === null || values[i] === body.value));
    let taken = 0;
    const want = body.count;
    for (const f of project.files) {
      if (taken >= want) break;
      const candidates = free.filter((id) => project.fileOf.get(id) === f.id);
      if (candidates.length === 0) continue;
      const got = await store.claimUnheldPlots(projectId, f.id, userId, candidates, want - taken);
      if (typeof got === 'number') taken += got;
    }
    await audit(store, request, 'plots.taken', { count: taken });
    const after = await loadProject(store, projectId, request.log);
    return reply.send({ ...summaryOf(after), taken, free: Math.max(0, free.length - taken) } satisfies TakePlotsAnswer);
  });
}

