import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { audit } from '../activity.js';
import {
  divide,
  hasSubmitted,
  moveUnfinished,
  parseDivisionRequest,
  submittedByPlot,
  summarize,
  type DistributionSummary,
} from '../division.js';
import { columnValues, plotColumns } from '../plotColumns.js';
import { plotFileOf } from '../plotFileCache.js';
import { loadPlotContext, type Log } from '../qualityService.js';
import { fileKeyCount, keyShape, splitKey } from '../rounds.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { PlotAssignment } from '../types.js';

/** Everything a division route needs about one file and the people of the project. */
async function loadFile(store: Store, projectId: string, csvFileId: string, log: Log) {
  const file = isUuid(csvFileId) ? await store.getCsvFile(projectId, csvFileId) : null;
  if (!file) {
    return null;
  }
  const [members, records, info] = await Promise.all([
    store.listMembers(projectId),
    store.listRecordSummaries(projectId),
    store.getRoundInfo(projectId),
  ]);
  const plotFile = plotFileOf(file, fileKeyCount(info));
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  const userIdByUsername = new Map(members.map((m) => [m.username, m.userId]));
  // Who holds a plot as a quality-check copy tells the check from the main
  // assessment when the key has no round (and picks the unit of a check record):
  // from every divided file, as the export and the quality figures read it, so
  // someone holding a plot as main in another file is not taken for its checker.
  const { copyHolders } = await loadPlotContext(store, projectId, log, { info, members });
  const submitted = submittedByPlot(records, new Set(plotFile.plotIds), userIdByUsername, info, copyHolders);
  // A survey with its own round may have several units (rounds) of one plot.
  const shape = keyShape(info);
  const plotOf =
    info?.state === 'own' && shape.roundIndex !== null
      ? (unit: string) => splitKey(unit, shape.count, shape.roundIndex).plot
      : (unit: string) => unit;
  return { file, plotFile, usernames, submitted, plotOf };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadFile>>>;

/** The people a whole file is given to (the grid). */
async function wholeFileAssignees(store: Store, projectId: string, csvFileId: string): Promise<string[]> {
  return (await store.listAssignments(projectId)).filter((a) => a.csvFileId === csvFileId).map((a) => a.userId);
}

/** GET /distribution for a whole file: every assignee holds every plot. */
function wholeSummary(loaded: Loaded, assignees: string[]): DistributionSummary {
  const { plotFile, usernames, submitted } = loaded;
  const people = assignees.map((userId) => {
    let done = 0;
    for (const plot of submitted.keys()) {
      if (hasSubmitted(submitted, plot, userId)) {
        done += 1;
      }
    }
    return {
      userId,
      username: usernames.get(userId) ?? userId,
      plots: plotFile.plotIds.length,
      overlap: 0,
      sampled: 0,
      submitted: done,
    };
  });
  people.sort((a, b) => a.username.localeCompare(b.username));
  return {
    distribution: null,
    plotCount: plotFile.plotIds.length,
    unassigned: assignees.length > 0 ? 0 : plotFile.plotIds.length,
    people,
  };
}

async function currentSummary(store: Store, projectId: string, loaded: Loaded): Promise<DistributionSummary> {
  const { file, plotFile, usernames, submitted } = loaded;
  if (!file.distribution) {
    return wholeSummary(loaded, await wholeFileAssignees(store, projectId, file.id));
  }
  const holdings = await store.listPlotAssignments(projectId, file.id);
  return summarize(file.distribution, plotFile.plotIds, holdings, submitted, usernames);
}

function csvFileId(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

/**
 * Dividing one plot file's plots between people (admin): the file's columns, its
 * current division, applying one (or a dry run), moving someone's unfinished plots,
 * and the quality-check report of plots collected twice.
 */
export async function registerDivisionRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/csv-files/:id/columns', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const id = csvFileId(request);
    const file = isUuid(id) ? await store.getCsvFile(projectId, id) : null;
    if (!file) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const plotFile = plotFileOf(file, fileKeyCount(await store.getRoundInfo(projectId)));
    const columns = plotColumns(plotFile);
    return reply.send({
      plotCount: plotFile.plotIds.length,
      hasHeader: plotFile.header !== null,
      separator: plotFile.separator,
      columns,
    });
  });

  app.get('/v1/projects/:pid/csv-files/:id/distribution', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request), request.log);
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send(await currentSummary(store, projectId, loaded));
  });

  // Body: a division ({mode: 'whole' | 'even' | 'column', ...}), optionally with
  // dryRun: true (nothing saved). Answers what GET /distribution would afterwards.
  app.put('/v1/projects/:pid/csv-files/:id/distribution', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request), request.log);
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { file, plotFile, usernames, submitted, plotOf } = loaded;
    const dryRun = (request.body as { dryRun?: unknown } | null)?.dryRun === true;
    const parsed = parseDivisionRequest(request.body, new Set(usernames.keys()), plotFile.columnCount, () =>
      randomInt(0, 2 ** 31),
    );
    if ('reason' in parsed) {
      return reply.code(400).send({ error: 'bad_request', reason: parsed.reason });
    }
    if (parsed.mode === 'whole') {
      if (!dryRun && file.distribution) {
        await store.setDivision(projectId, file.id, null, []);
        await audit(store, request, 'division.applied', { csvFileId: file.id, mode: 'whole', people: 0, plots: plotFile.plotIds.length });
      }
      // A divided file has no grid assignments: whole again, it starts with nobody.
      const assignees = file.distribution ? [] : await wholeFileAssignees(store, projectId, file.id);
      return reply.send(wholeSummary(loaded, assignees));
    }
    const values = parsed.mode === 'column' ? columnValues(plotFile, parsed.column) : null;
    // The copies the check sampling drew stay with their checkers (Task 13); going back to
    // the whole file (above) drops them with every other holding. Reference plots (Task 14) are
    // not dealt again: they keep their assessor and their copies as they are (the whole file
    // again unmarks them).
    const held = file.distribution ? await store.listPlotAssignments(projectId, file.id) : [];
    const drawn = held.filter((a) => a.sampledAt !== undefined);
    const reference = file.distribution ? new Set((await store.listReferencePlots(projectId)).filter((r) => r.csvFileId === file.id).map((r) => r.plotKey)) : new Set<string>();
    const dealt = reference.size === 0 ? plotFile.plotIds : plotFile.plotIds.filter((id) => !reference.has(id));
    const dealtValues = reference.size === 0 || values === null ? values : values.filter((_, i) => !reference.has(plotFile.plotIds[i]));
    const plots = [
      ...divide(parsed, dealt, dealtValues, submitted, plotOf, drawn.filter((a) => !reference.has(a.plotKey))),
      ...held.filter((a) => reference.has(a.plotKey)),
    ];
    if (!dryRun) {
      await store.setDivision(projectId, file.id, parsed, plots);
      const people = new Set(plots.map((a) => a.userId)).size;
      await audit(store, request, 'division.applied', { csvFileId: file.id, mode: parsed.mode, people, plots: plotFile.plotIds.length });
    }
    return reply.send(summarize(parsed, plotFile.plotIds, plots, submitted, usernames));
  });

  // Body: {fromUserId, toUserId}. Gives the plots `from` has not submitted to `to`.
  app.post('/v1/projects/:pid/csv-files/:id/move-unfinished', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request), request.log);
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { file, plotFile, usernames, submitted, plotOf } = loaded;
    const body = (request.body ?? {}) as { fromUserId?: unknown; toUserId?: unknown };
    const from = typeof body.fromUserId === 'string' ? body.fromUserId : '';
    const to = typeof body.toUserId === 'string' ? body.toUserId : '';
    if (!isUuid(from)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'fromUserId is required' });
    }
    if (!usernames.has(to)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'toUserId must be a member of the project' });
    }
    if (from === to) {
      return reply.code(400).send({ error: 'bad_request', reason: 'fromUserId and toUserId are the same person' });
    }
    let holdings: PlotAssignment[];
    if (file.distribution) {
      holdings = await store.listPlotAssignments(projectId, file.id);
    } else {
      // A whole file is first divided as it is: every assignee holds every plot.
      const assignees = await wholeFileAssignees(store, projectId, file.id);
      holdings = assignees.flatMap((userId) => plotFile.plotIds.map((plotKey) => ({ plotKey, userId, overlap: false })));
    }
    const inFile = new Set(plotFile.plotIds);
    holdings = holdings.filter((a) => inFile.has(a.plotKey));
    // Reference plots (Task 14) never move: their assessor keeps them, every collector their copy.
    const reference = file.distribution ? new Set((await store.listReferencePlots(projectId)).filter((r) => r.csvFileId === file.id).map((r) => r.plotKey)) : new Set<string>();
    const kept = holdings.filter((a) => reference.has(a.plotKey));
    holdings = holdings.filter((a) => !reference.has(a.plotKey));
    if (!holdings.some((a) => a.userId === from)) {
      return reply.send({ ...(await currentSummary(store, projectId, loaded)), moved: 0, notMoved: 0, droppedChecks: 0 });
    }
    const result = moveUnfinished(holdings, from, to, submitted, plotOf);
    result.plots.push(...kept);
    const distribution = { mode: 'manual' as const };
    await store.setDivision(projectId, file.id, distribution, result.plots);
    await audit(store, request, 'plots.moved', { csvFileId: file.id, fromUserId: from, toUserId: to, moved: result.moved });
    return reply.send({
      ...summarize(distribution, plotFile.plotIds, result.plots, submitted, usernames),
      moved: result.moved,
      // Plots `to` already checked (or assessed, for a copy, or holds a copy of another
      // unit of) stay with `from`; copies of `from` where `to` is the main holder are
      // dropped.
      notMoved: result.notMoved,
      droppedChecks: result.droppedChecks,
    });
  });
}
