import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import {
  copyHoldersOf,
  divide,
  hasSubmitted,
  moveUnfinished,
  overlapReport,
  parseDivisionRequest,
  submittedByPlot,
  summarize,
  type DistributionSummary,
} from '../division.js';
import { parsePlotFile, type PlotFile } from '../plots.js';
import { fileKeyCount } from '../rounds.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { PlotAssignment } from '../types.js';

/** Most distinct values a column may have for them to be listed (dividing by column). */
export const MAX_LISTED_VALUES = 200;

// A few recently parsed files, by checksum and key count: my-assignment and the file
// page read the same file again and again, and a big one takes a moment to parse.
const PARSED_CACHE_SIZE = 4;
const parsedFiles = new Map<string, PlotFile>();

/**
 * The parsed plot file of stored content (cached by checksum and key count).
 * `keyCount` is fileKeyCount of the project's RoundInfo.
 */
export function plotFileOf(file: { checksum: string; data: Buffer }, keyCount: number): PlotFile {
  const cacheKey = `${file.checksum}:${keyCount}`;
  let parsed = parsedFiles.get(cacheKey);
  if (parsed) {
    parsedFiles.delete(cacheKey);
  } else {
    parsed = parsePlotFile(file.data, keyCount);
  }
  parsedFiles.set(cacheKey, parsed);
  while (parsedFiles.size > PARSED_CACHE_SIZE) {
    parsedFiles.delete(parsedFiles.keys().next().value as string);
  }
  return parsed;
}

/** Each plot's value in a column (of its first row), in plotIds order. */
function columnValues(file: PlotFile, column: number): string[] {
  const valueOf = new Map<string, string>();
  for (const row of file.rows) {
    if (!valueOf.has(row.id)) {
      valueOf.set(row.id, row.fields[column] ?? '');
    }
  }
  return file.plotIds.map((id) => valueOf.get(id) ?? '');
}

/** Everything a division route needs about one file and the people of the project. */
async function loadFile(store: Store, projectId: string, csvFileId: string) {
  const file = isUuid(csvFileId) ? await store.getCsvFile(projectId, csvFileId) : null;
  if (!file) {
    return null;
  }
  const [members, records, info, holdings] = await Promise.all([
    store.listMembers(projectId),
    store.listRecordSummaries(projectId),
    store.getRoundInfo(projectId),
    file.distribution ? store.listPlotAssignments(projectId, file.id) : Promise.resolve([]),
  ]);
  const plotFile = plotFileOf(file, fileKeyCount(info));
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  const userIdByUsername = new Map(members.map((m) => [m.username, m.userId]));
  // Who holds a plot as a quality-check copy tells the check from the main
  // assessment when the key has no round (and picks the unit of a check record).
  const copyHolders = copyHoldersOf(holdings, usernames);
  const submitted = submittedByPlot(records, new Set(plotFile.plotIds), userIdByUsername, info, copyHolders);
  return { file, plotFile, usernames, submitted };
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
    const columns = [];
    for (let index = 0; index < plotFile.columnCount; index += 1) {
      const counts = new Map<string, number>();
      for (const value of columnValues(plotFile, index)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      // The id column is never listed: every plot has its own.
      const listed = index > 0 && counts.size <= MAX_LISTED_VALUES;
      columns.push({
        index,
        name: plotFile.header ? plotFile.header.fields[index] ?? '' : null,
        distinctCount: counts.size,
        values: listed
          ? [...counts.entries()]
              .map(([value, count]) => ({ value, count }))
              // By value, the empty value last.
              .sort((a, b) => (a.value === '') !== (b.value === '') ? (a.value === '' ? 1 : -1)
                : a.value.localeCompare(b.value, undefined, { numeric: true }))
          : null,
      });
    }
    return reply.send({
      plotCount: plotFile.plotIds.length,
      hasHeader: plotFile.header !== null,
      separator: plotFile.separator,
      columns,
    });
  });

  app.get('/v1/projects/:pid/csv-files/:id/distribution', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request));
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send(await currentSummary(store, projectId, loaded));
  });

  // Body: a division ({mode: 'whole' | 'even' | 'column', ...}), optionally with
  // dryRun: true (nothing saved). Answers what GET /distribution would afterwards.
  app.put('/v1/projects/:pid/csv-files/:id/distribution', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request));
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { file, plotFile, usernames, submitted } = loaded;
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
      }
      // A divided file has no grid assignments: whole again, it starts with nobody.
      const assignees = file.distribution ? [] : await wholeFileAssignees(store, projectId, file.id);
      return reply.send(wholeSummary(loaded, assignees));
    }
    const values = parsed.mode === 'column' ? columnValues(plotFile, parsed.column) : null;
    const plots = divide(parsed, plotFile.plotIds, values, submitted);
    if (!dryRun) {
      await store.setDivision(projectId, file.id, parsed, plots);
    }
    return reply.send(summarize(parsed, plotFile.plotIds, plots, submitted, usernames));
  });

  // Body: {fromUserId, toUserId}. Gives the plots `from` has not submitted to `to`.
  app.post('/v1/projects/:pid/csv-files/:id/move-unfinished', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadFile(store, projectId, csvFileId(request));
    if (!loaded) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { file, plotFile, usernames, submitted } = loaded;
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
    if (!holdings.some((a) => a.userId === from)) {
      return reply.send({ ...(await currentSummary(store, projectId, loaded)), moved: 0 });
    }
    const result = moveUnfinished(holdings, from, to, submitted);
    const distribution = { mode: 'manual' as const };
    await store.setDivision(projectId, file.id, distribution, result.plots);
    return reply.send({
      ...summarize(distribution, plotFile.plotIds, result.plots, submitted, usernames),
      moved: result.moved,
    });
  });

  app.get('/v1/projects/:pid/overlap', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(overlapReport(await store.listRecordSummaries(request.membership!.projectId)));
  });
}
