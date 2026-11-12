import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { audit } from '../activity.js';
import {
  divide,
  hasSubmitted,
  keptBy,
  moveUnfinished,
  parseDivisionRequest,
  rebalancePlan,
  submittedByPlot,
  summarize,
  type DistributionSummary,
  type RebalanceShare,
} from '../division.js';
import { nearbyAvailability, nearbyRanksOf, servedNearby, type NearbyAvailability } from '../nearby.js';
import { columnValues, plotColumns } from '../plotColumns.js';
import { plotFileOf } from '../plotFileCache.js';
import { loadPlotContext, type Log } from '../qualityService.js';
import { isWgs84, PlotPlaceReader } from './plotPlaces.js';
import { fileKeyCount, keyShape, splitKey } from '../rounds.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { PlotAssignment, StoredDistribution } from '../types.js';

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
  const plotIds = new Set(plotFile.plotIds);
  const submitted = submittedByPlot(records, plotIds, userIdByUsername, info, copyHolders);
  // What stays with a copy's holder in a division or a move: also a check begun, when checks have no key of their own.
  const kept = keptBy(submitted, records, plotIds, userIdByUsername, info, copyHolders);
  // A survey with its own round may have several units (rounds) of one plot.
  const shape = keyShape(info);
  const plotOf =
    info?.state === 'own' && shape.roundIndex !== null
      ? (unit: string) => splitKey(unit, shape.count, shape.roundIndex).plot
      : (unit: string) => unit;
  return { file, plotFile, usernames, submitted, kept, plotOf, keyCount: fileKeyCount(info) };
}

/**
 * Whether order 'nearby' (Task 15) can be used on the file, and its plots' places: the
 * survey's first spatial reference system must be latitude and longitude, and some plots
 * must have a place (as the map reads them: the two columns after the keys). The places are
 * the reader's, kept per checksum (not read again on every call).
 */
async function nearbyOf(
  reader: PlotPlaceReader,
  projectId: string,
  file: { id: string; checksum: string; data: Buffer },
  plotCount: number,
  keyCount: number,
  log: FastifyRequest['log'],
): Promise<{ availability: NearbyAvailability; places: ReadonlyMap<string, readonly [number, number]> }> {
  const { srid } = await reader.surveyFacts(projectId, log);
  // The file in hand is parsed (not read again by id): the places are of this very content.
  const places = isWgs84(srid)
    ? ((await reader.placesOfFile(projectId, file.id, file.checksum, keyCount, log, file))?.places ?? new Map<string, readonly [number, number]>())
    : new Map<string, readonly [number, number]>();
  return { availability: nearbyAvailability(srid, places.size, plotCount), places };
}

/** Why order 'nearby' is refused, for the 400. */
function nearbyRefusal(availability: NearbyAvailability): string {
  return availability.reason === 'other_srs'
    ? `order 'nearby' needs latitude and longitude; the survey's coordinates are in ${availability.srid}`
    : "order 'nearby' needs plots with latitude and longitude (the two columns after the plot id); this file has none";
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadFile>>>;

/** The most plots one move takes by count or by list (a selection on the map). */
const MAX_MOVE = 20000;

/** The reference plots of one file (Task 14). */
async function referenceOf(store: Store, projectId: string, csvFileId: string): Promise<Set<string>> {
  return new Set((await store.listReferencePlots(projectId)).filter((r) => r.csvFileId === csvFileId).map((r) => r.plotKey));
}

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
      reference: 0,
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
  return summarize(file.distribution, plotFile.plotIds, holdings, submitted, usernames, await referenceOf(store, projectId, file.id));
}

function csvFileId(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

/**
 * Dividing one plot file's plots between people (admin): the file's columns, its
 * current division, applying one (or a dry run), moving someone's unfinished plots,
 * and the quality-check report of plots collected twice.
 */
export async function registerDivisionRoutes(app: FastifyInstance, store: Store, placeReader = new PlotPlaceReader(store)): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/csv-files/:id/columns', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const id = csvFileId(request);
    const file = isUuid(id) ? await store.getCsvFile(projectId, id) : null;
    if (!file) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const keyCount = fileKeyCount(await store.getRoundInfo(projectId));
    const plotFile = plotFileOf(file, keyCount);
    const columns = plotColumns(plotFile);
    const { availability } = await nearbyOf(placeReader, projectId, file, plotFile.plotIds.length, keyCount, request.log);
    return reply.send({
      plotCount: plotFile.plotIds.length,
      hasHeader: plotFile.header !== null,
      separator: plotFile.separator,
      columns,
      // Whether order 'nearby' can be chosen, and how many plots have no place (they go last).
      nearby: availability,
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
    const { file, plotFile, usernames, submitted, plotOf, keyCount } = loaded;
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
    // Order 'nearby': the curve over the whole file (reference plots included), as the served rows.
    let rank: ReadonlyMap<string, number> = new Map();
    if (parsed.order === 'nearby') {
      const nearby = await nearbyOf(placeReader, projectId, file, plotFile.plotIds.length, keyCount, request.log);
      if (!nearby.availability.available) {
        return reply.code(400).send({ error: 'bad_request', reason: nearbyRefusal(nearby.availability) });
      }
      rank = await nearbyRanksOf(file, keyCount, async () => nearby.places);
    }
    const values = parsed.mode === 'column' ? columnValues(plotFile, parsed.column) : null;
    // The copies the check sampling drew stay with their checkers (Task 13); going back to
    // the whole file (above) drops them with every other holding. Reference plots (Task 14) are
    // not dealt again: they keep their assessor and their copies as they are (the whole file
    // again unmarks them).
    const held = file.distribution ? await store.listPlotAssignments(projectId, file.id) : [];
    const drawn = held.filter((a) => a.sampledAt !== undefined);
    const reference = file.distribution ? await referenceOf(store, projectId, file.id) : new Set<string>();
    const dealt = reference.size === 0 ? plotFile.plotIds : plotFile.plotIds.filter((id) => !reference.has(id));
    const dealtValues = reference.size === 0 || values === null ? values : values.filter((_, i) => !reference.has(plotFile.plotIds[i]));
    const plots = [
      ...divide(parsed, dealt, dealtValues, loaded.kept, plotOf, drawn.filter((a) => !reference.has(a.plotKey)), rank),
      ...held.filter((a) => reference.has(a.plotKey)),
    ];
    if (!dryRun) {
      await store.setDivision(projectId, file.id, parsed, plots);
      const people = new Set(plots.map((a) => a.userId)).size;
      await audit(store, request, 'division.applied', { csvFileId: file.id, mode: parsed.mode, people, plots: plotFile.plotIds.length });
    }
    return reply.send(summarize(parsed, plotFile.plotIds, plots, submitted, usernames, reference));
  });

  /** The holdings a move or a rebalance may change: a whole file divided as it is first, reference plots apart (they never move). */
  async function movableHoldings(projectId: string, loaded: Loaded) {
    const { file, plotFile } = loaded;
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
    const reference = file.distribution ? await referenceOf(store, projectId, file.id) : new Set<string>();
    return { holdings: holdings.filter((a) => !reference.has(a.plotKey)), kept: holdings.filter((a) => reference.has(a.plotKey)), reference };
  }

  /** What a division is stored as after a move: by hand, a 'nearby' order kept (Task 15). */
  const manualOf = (distribution: StoredDistribution | null | undefined): StoredDistribution =>
    servedNearby(distribution) ? { mode: 'manual', order: 'nearby' } : { mode: 'manual' };

  // Body: {fromUserId, toUserId, count?, plots?}. Gives the plots `from` has not submitted to `to`: all
  // of them, or `count` of the plots they have to assess (the last of their list), or only `plots`.
  app.post('/v1/projects/:pid/csv-files/:id/move-unfinished', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request), request.log);
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { file, plotFile, usernames, submitted, kept: keptWith, plotOf } = loaded;
    const body = (request.body ?? {}) as { fromUserId?: unknown; toUserId?: unknown; count?: unknown; plots?: unknown };
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
    const which: { count?: number; plots?: Set<string> } = {};
    if (body.count !== undefined) {
      if (typeof body.count !== 'number' || !Number.isInteger(body.count) || body.count < 1 || body.count > MAX_MOVE) {
        return reply.code(400).send({ error: 'bad_request', reason: `count must be a whole number from 1 to ${MAX_MOVE}` });
      }
      which.count = body.count;
    }
    if (body.plots !== undefined) {
      if (!Array.isArray(body.plots) || body.plots.length === 0 || body.plots.length > MAX_MOVE || !body.plots.every((p) => typeof p === 'string')) {
        return reply.code(400).send({ error: 'bad_request', reason: `plots must be a list of 1 to ${MAX_MOVE} plot ids` });
      }
      which.plots = new Set(body.plots as string[]);
    }
    const { holdings, kept } = await movableHoldings(projectId, loaded);
    if (!holdings.some((a) => a.userId === from)) {
      return reply.send({ ...(await currentSummary(store, projectId, loaded)), moved: 0, notMoved: 0, droppedChecks: 0 });
    }
    const result = moveUnfinished(holdings, from, to, keptWith, plotOf, which);
    result.plots.push(...kept);
    const distribution = manualOf(file.distribution);
    const reference = new Set(kept.map((a) => a.plotKey));
    await store.setDivision(projectId, file.id, distribution, result.plots);
    await audit(store, request, 'plots.moved', { csvFileId: file.id, fromUserId: from, toUserId: to, moved: result.moved });
    return reply.send({
      ...summarize(distribution, plotFile.plotIds, result.plots, submitted, usernames, reference),
      moved: result.moved,
      // Plots `to` already checked (or assessed, for a copy, or holds a copy of another
      // unit of) stay with `from`; copies of `from` where `to` is the main holder are
      // dropped.
      notMoved: result.notMoved,
      droppedChecks: result.droppedChecks,
    });
  });

  // Body: {people: [{userId, weight}], dryRun?}. Shares again the plots still to assess of these people,
  // by their weights (see rebalancePlan); what is submitted stays. dryRun: the plan, nothing saved.
  app.post('/v1/projects/:pid/csv-files/:id/rebalance', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request), request.log);
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { file, plotFile, usernames, submitted, kept: keptWith, plotOf } = loaded;
    if (!file.distribution) {
      // Everyone holds every plot of a whole file: there is nothing to share out
      return reply.code(409).send({ error: 'whole_file' });
    }
    const body = (request.body ?? {}) as { people?: unknown; dryRun?: unknown };
    const people = Array.isArray(body.people) ? body.people : [];
    const shares: RebalanceShare[] = [];
    for (const p of people) {
      const { userId, weight } = (p ?? {}) as { userId?: unknown; weight?: unknown };
      if (typeof userId !== 'string' || !usernames.has(userId) || shares.some((x) => x.userId === userId)) {
        return reply.code(400).send({ error: 'bad_request', reason: 'people: each a member of the project, once' });
      }
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1000) {
        return reply.code(400).send({ error: 'bad_request', reason: 'weight must be a number from 0 to 1000' });
      }
      shares.push({ userId, weight });
    }
    if (shares.length < 2 || !shares.some((x) => x.weight > 0)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'people: at least two, one of them with a weight above 0' });
    }
    const { holdings, kept } = await movableHoldings(projectId, loaded);
    const plan = rebalancePlan(holdings, keptWith, shares);
    if (body.dryRun === true) {
      return reply.send({ ...plan, saved: false });
    }
    let plots = holdings;
    let moved = 0;
    let notMoved = 0;
    for (const m of plan.moves) {
      const result = moveUnfinished(plots, m.from, m.to, keptWith, plotOf, { count: m.count });
      plots = result.plots;
      moved += result.moved;
      notMoved += result.notMoved;
    }
    const distribution = manualOf(file.distribution);
    const all = [...plots, ...kept];
    await store.setDivision(projectId, file.id, distribution, all);
    await audit(store, request, 'plots.rebalanced', { csvFileId: file.id, people: shares.length, moved });
    return reply.send({
      ...summarize(distribution, plotFile.plotIds, all, submitted, usernames, new Set(kept.map((a) => a.plotKey))),
      ...plan,
      saved: true,
      moved,
      notMoved,
    });
  });
}
