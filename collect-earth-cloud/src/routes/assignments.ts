import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { audit, noteActivity } from '../activity.js';
import type { RoundInfo } from '../cep.js';
import type { Config } from '../config.js';
import { checksumOf } from '../csv.js';
import { copiesSubmittedAsMain } from '../division.js';
import { attachment } from '../download.js';
import { checkUploadFits } from '../limits.js';
import { buildPlotFile, parsePlotFile, type RoundColumn } from '../plots.js';
import { referenceCopyPlan } from '../reference.js';
import { fileKeyCount, keyShape, recordKeysOfUnit } from '../rounds.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store, UserPlots } from '../store/store.js';
import type { Assignment, RecordRow } from '../types.js';
import { plotFileOf } from '../plotFileCache.js';
import type { ProjectStateCache } from '../projectState.js';
import type { SamplingService } from '../samplingService.js';
import { loadPlotContext, type Log } from '../qualityService.js';
import { recheckFileId, sentBackTo, type RecheckFile } from '../sendBack.js';
import type { Question } from '../surveyOutline.js';
import { registerDivisionRoutes } from './division.js';

interface AssignmentsBody {
  assignments?: { userId?: string; csvFileId?: string }[];
}

/**
 * Phase-B routes: plot CSV files and per-operator assignments. Admins upload CSVs
 * and set the csv↔operator mapping; an operator fetches only its own assignment
 * (my-assignment) plus the CSV content it is entitled to download. A divided file
 * (its plots shared out one by one, see division.ts) is served to each person as
 * their own file: the header row plus only their plots.
 *
 * While the survey has a round the server can fill in (roundColumnOf), every file a
 * person gets carries it: Collect Earth reads the plot's keys from the first columns
 * and the coordinates right after them, so a file without the round column would put
 * the coordinates in the wrong place. Admins still get the uploaded file without
 * ?mine=1.
 *
 * Plots sent back for another look (src/sendBack.ts) come as one more file per plot
 * file, "To check again – <file>", listed after the others, under an id worked out from
 * the plot file's (recheckFileId): only the person's own plots sent back and not yet
 * submitted again, each with the round of their own record.
 */
export async function registerAssignmentRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
  deps: {
    outline?: (projectId: string, log: Log) => Promise<ReadonlyMap<string, Question> | null>;
    /** The Progress and People pages' project state: its plot context is shared (else loaded each time). */
    states?: ProjectStateCache;
    /** The check sampling: a due draw is made before a plot list is answered. */
    sampling?: SamplingService;
  } = {},
): Promise<void> {
  /**
   * The person's "To check again" files (none for a project token). The plot context is read
   * only when a plot of theirs may still be waiting (sentBackTo's waitingOnly).
   */
  const recheckFilesFor = async (projectId: string, userId: string | undefined, info: RoundInfo | null, log: Log): Promise<RecheckFile[]> => {
    if (!userId) return [];
    const user = await store.getUserById(userId);
    if (!user) return [];
    const sent = await sentBackTo(store, projectId, { userId, username: user.username }, {
      info,
      waitingOnly: true,
      context: async () => (deps.states ? (await deps.states.get(projectId, log)).state.context : loadPlotContext(store, projectId, log, { info })),
      outline: () => (deps.outline ? deps.outline(projectId, log) : Promise.resolve(null)),
    });
    return sent.files;
  };

  // Upload / replace a plot CSV (admin). Raw CSV body (text/csv or octet-stream).
  app.put(
    '/v1/projects/:pid/csv-files/:filename',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const filename = (request.params as { filename: string }).filename;
      // Reject path-traversal / separator characters: the filename is echoed back to
      // clients that use it to build a local write path.
      if (!filename || /[/\\\0]/.test(filename) || filename === '.' || filename === '..' || filename.includes('..')) {
        return reply.code(400).send({ error: 'bad_request', reason: 'invalid filename' });
      }
      const data = request.body;
      if (!Buffer.isBuffer(data) || data.length === 0) {
        return reply.code(400).send({ error: 'bad_request', reason: 'expected a non-empty CSV body' });
      }
      const over = await checkUploadFits(store, request.membership!.projectId, { kind: 'csv', filename }, data.length);
      if (over) {
        return reply.code(413).send(over);
      }
      // The new content's plot ids (as many key columns as the survey has, less the
      // round the server added): a divided file keeps the holdings of those.
      const projectId = request.membership!.projectId;
      const keyCount = fileKeyCount(await store.getRoundInfo(projectId));
      const plotIds = parsePlotFile(data, keyCount).plotIds;
      // A reference plot must be in one plot file only (Task 14: its records are paired by plot
      // across files, and a second file could give it a second first assessment). Refused rather
      // than unmarking it quietly: unmarking changes the accuracy figures and drops copies, which
      // the coordinator decides on the Quality tab ("Remove"), then uploads again.
      const references = await store.listReferencePlots(projectId);
      if (references.length > 0) {
        const existing = (await store.listCsvFiles(projectId)).find((f) => f.filename === filename);
        const elsewhere = new Set(references.filter((r) => r.csvFileId !== existing?.id).map((r) => r.plotKey));
        const clash = plotIds.filter((id) => elsewhere.has(id));
        if (clash.length > 0) {
          return reply.code(409).send({
            error: 'reference_plot_in_file',
            reason: 'This file holds reference plots of another plot file. Remove them as reference plots first (Quality tab), or leave them out of this file.',
            plots: clash.slice(0, 20),
          });
        }
      }
      const meta = await store.putCsvFile(projectId, filename, data, plotIds);
      await audit(store, request, 'csv.uploaded', { csvFileId: meta.id, plots: meta.plotCount });
      return reply.code(201).send(meta);
    },
  );

  // List a project's CSV files (admin), each saying whether it is divided and
  // between how many people (those holding at least one plot).
  app.get(
    '/v1/projects/:pid/csv-files',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const [files, holders] = await Promise.all([store.listCsvFiles(projectId), store.countPlotHolders(projectId)]);
      return reply.send({
        csvFiles: files.map((f) => ({
          ...f,
          divided: Boolean(f.distribution),
          dividedPeople: f.distribution ? holders.get(f.id) ?? 0 : 0,
        })),
      });
    },
  );

  // Download a CSV's content. Admins may fetch any in full (without ?mine=1);
  // operators only files assigned to them. Of a divided file, everyone else (and an
  // admin asking ?mine=1) gets their own file, 404 if they hold no plot in it; of a
  // whole file, the file with the round column when the survey has one to fill in.
  // The checksum of what is served is in a header so the client can verify.
  // my-assignment adds the checksum it listed as ?v=: when the file served now has
  // another (it changed in between), the answer is 409 and nothing is served, so the
  // desktop app does not overwrite its copy with a file it would then refuse.
  app.get(
    '/v1/projects/:pid/csv-files/:id/content',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const id = (request.params as { id: string }).id;
      const isAdmin = request.membership!.role === 'admin';
      const query = request.query as { mine?: string; v?: string };
      const mine = query.mine === '1';
      const expected = typeof query.v === 'string' && query.v.length > 0 ? query.v : null;
      const userId = request.userId;
      const file = isUuid(id) ? await store.getCsvFile(projectId, id) : null;
      if (!file) {
        // A "To check again" file: the caller's own, whatever their role.
        const source = isUuid(id) ? (await store.listCsvFiles(projectId)).find((f) => recheckFileId(f.id) === id) : undefined;
        if (!source) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const info = await store.getRoundInfo(projectId);
        const recheck = (await recheckFilesFor(projectId, userId, info, request.log)).find((f) => f.id === id);
        const sourceFile = recheck ? await store.getCsvFile(projectId, source.id) : null;
        const built = recheck && sourceFile ? recheckServed(sourceFile, recheck, info) : null;
        if (!recheck || !built) {
          // Listed a moment ago (?v= comes from my-assignment) and emptied since (submitted again,
          // the decision undone): 409 changed, Refresh, as any file that changed. Someone with no
          // plot of that plot file never had it: 404.
          if (expected !== null && userId && (await holdsPlotsOf(store, projectId, source.id, userId))) {
            return changed(reply);
          }
          return reply.code(404).send({ error: 'not_found' });
        }
        return sendPlotFile(request, reply, recheck.filename, built, expected);
      }
      let data = file.data;
      let checksum = file.checksum;
      const info = await store.getRoundInfo(projectId);
      if (file.distribution && (mine || !isAdmin)) {
        const plots = userId ? await store.listUserPlots(projectId, id, userId) : null;
        const own =
          userId && plots && plots.plotKeys.length > 0
            ? ownFile(file, plots, info, await copiesServedAsMain(store, projectId, userId, info)(plots))
            : null;
        if (!own) {
          return reply.code(404).send({ error: 'not_found' });
        }
        ({ data, checksum } = own);
      } else if (!isAdmin && !(userId && (await store.isAssigned(projectId, id, userId)))) {
        return reply.code(404).send({ error: 'not_found' });
      } else if (mine || !isAdmin) {
        ({ data, checksum } = wholeFile(file, info));
      }
      return sendPlotFile(request, reply, file.filename, { data, checksum }, expected);
    },
  );

  // Replace the project's whole assignment set (admin).
  app.put(
    '/v1/projects/:pid/assignments',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as AssignmentsBody;
      const raw = Array.isArray(body.assignments) ? body.assignments : [];
      const assignments: Assignment[] = [];
      for (const a of raw) {
        if (typeof a?.userId === 'string' && typeof a?.csvFileId === 'string') {
          assignments.push({ userId: a.userId, csvFileId: a.csvFileId });
        }
      }
      await store.setAssignments(request.membership!.projectId, assignments);
      await audit(store, request, 'assignments.set', { count: assignments.length });
      return reply.send({ ok: true, count: assignments.length });
    },
  );

  // View the full assignment matrix (admin).
  app.get(
    '/v1/projects/:pid/assignments',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ assignments: await store.listAssignments(request.membership!.projectId) });
    },
  );

  // The caller's own assigned CSVs, with download URLs + checksums (operator view).
  app.get(
    '/v1/projects/:pid/my-assignment',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      // A user session yields request.userId; a bare project (operator) token has no
      // user, so it has no personal assignment — return an empty list rather than 404.
      const userId = request.userId;
      // A check draw put off by its 10 minutes is made now, so a checker's Refresh gets its copies.
      await deps.sampling?.runIfDue(projectId, request.log);
      // A collector without a copy of a reference plot yet (joined since it was marked, or a
      // collector since) gets it now, so it is in the plot list below (Task 14).
      if (userId && request.membership!.role === 'operator') {
        await addOwnReferenceCopies(store, projectId, userId).catch((err: unknown) =>
          request.log.error({ err, projectId }, 'my-assignment: could not add the reference plots'),
        );
      }
      const files = userId ? await store.listAssignmentsForUser(projectId, userId) : [];
      const base = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/+$/, '') : '';
      const entry = (f: { id: string; filename: string; checksum: string; plotCount: number }, query = '') => {
        const path = `/v1/projects/${projectId}/csv-files/${f.id}/content${query}`;
        return {
          csvFileId: f.id,
          filename: f.filename,
          checksum: f.checksum,
          plotCount: f.plotCount,
          downloadPath: path,
          downloadUrl: base ? `${base}${path}` : null,
        };
      };
      const info = await store.getRoundInfo(projectId);
      const withRound = roundColumnOf(info, new Set()) !== null;
      // Built files are downloaded with ?mine=1 and the checksum listed here (?v=).
      const built = (f: Parameters<typeof entry>[0], served: ServedFile) =>
        entry({ ...f, checksum: served.checksum, plotCount: served.plotCount }, `?mine=1&v=${served.checksum}`);
      // A file that cannot be read or built is left out (and logged), never a 500.
      const tryBuild = async <T>(csvFileId: string, build: () => Promise<T>): Promise<T | null> => {
        try {
          return await build();
        } catch (err) {
          request.log.error({ err, csvFileId }, 'my-assignment: could not build the plot file');
          return null;
        }
      };
      const assignments: ReturnType<typeof entry>[] = [];
      for (const f of files) {
        if (!withRound) {
          // Served as uploaded: its stored checksum, also as ?v= so a file replaced
          // in between is refused (409) before the desktop app writes it.
          assignments.push(entry(f, `?v=${f.checksum}`));
          continue;
        }
        // The file as this person gets it, with the round column.
        const whole = await tryBuild(f.id, async () => {
          const cached = cachedWholeFile(f, info);
          if (cached) {
            return cached;
          }
          const file = await store.getCsvFile(projectId, f.id);
          return file ? wholeFile(file, info) : null;
        });
        if (whole) {
          assignments.push(built(f, whole));
        }
      }
      // Divided files where the caller holds plots: their own file's checksum and count.
      const holdings = userId ? await store.listPlotHoldings(projectId, userId) : [];
      const asMainOf = userId ? copiesServedAsMain(store, projectId, userId, info) : null;
      const metas = holdings.length > 0 ? new Map((await store.listCsvFiles(projectId)).map((f) => [f.id, f])) : new Map();
      for (const holding of holdings) {
        const meta = metas.get(holding.csvFileId);
        if (!meta) {
          continue;
        }
        const own = await tryBuild(holding.csvFileId, async () => {
          const asMain = await asMainOf!(holding);
          const cached = cachedOwnFile(meta, holding, info, asMain);
          if (cached !== undefined) {
            return cached;
          }
          const file = await store.getCsvFile(projectId, holding.csvFileId);
          return file ? ownFile(file, holding, info, asMain) : null;
        });
        if (own) {
          assignments.push(built(meta, own));
        }
      }
      // The plots sent back for another look, one file per plot file, after the others: Collect
      // Earth keeps selected the last listed file whose name ends the path of the file in use,
      // and "To check again – north.csv" ends with "north.csv".
      const rechecks = (await tryBuild('to-check-again', () => recheckFilesFor(projectId, userId, info, request.log))) ?? [];
      for (const recheck of rechecks) {
        const servedRecheck = await tryBuild(recheck.sourceFileId, async () => {
          const file = await store.getCsvFile(projectId, recheck.sourceFileId);
          return file ? recheckServed(file, recheck, info) : null;
        });
        if (servedRecheck) {
          assignments.push(built({ id: recheck.id, filename: recheck.filename, checksum: servedRecheck.checksum, plotCount: servedRecheck.plotCount }, servedRecheck));
        }
      }
      noteActivity(request, { plotsDownload: true }, { desktop: true });
      return reply.send({ assignments });
    },
  );

  await registerDivisionRoutes(app, store);
}

/** 409: the file changed (or emptied) after my-assignment listed it. */
function changed(reply: FastifyReply) {
  return reply.code(409).send({
    error: 'changed',
    reason: 'This plot file changed after the list of your plot files was read. Press Refresh to get the new list, then download it again.',
  });
}

/** Whether a person is given a plot file whole or holds a plot of it (divided). */
async function holdsPlotsOf(store: Store, projectId: string, csvFileId: string, userId: string): Promise<boolean> {
  return (await store.isAssigned(projectId, csvFileId, userId)) || (await store.listUserPlots(projectId, csvFileId, userId)).plotKeys.length > 0;
}

/**
 * Sends a plot file as served (its checksum in a header), or 409 when my-assignment listed
 * another checksum (?v=): the file changed in between, and the desktop app would refuse it.
 */
function sendPlotFile(
  request: FastifyRequest,
  reply: FastifyReply,
  filename: string,
  served: { data: Buffer; checksum: string },
  expected: string | null,
) {
  if (expected !== null && expected !== served.checksum) {
    return changed(reply);
  }
  noteActivity(request, { plotsDownload: true }, { desktop: true });
  return reply
    .header('content-type', 'text/csv')
    .header('x-checksum-sha256', served.checksum)
    .header('content-disposition', attachment(filename))
    .send(served.data);
}

/**
 * The round column of the files one person gets, or null when files are served as
 * uploaded. `copies` are the plot units they hold as quality-check copies.
 * - round added by the server: inserted after the id, 2 on copies and 1 elsewhere;
 * - the survey's own round with a reassessment code: that code on copies, the file's
 *   own value elsewhere;
 * - otherwise (no round, or own round without a reassessment code): none.
 */
export function roundColumnOf(info: RoundInfo | null, copies: ReadonlySet<string>): RoundColumn | null {
  if (info?.state === 'added') {
    return { kind: 'insert', value: (plotId) => (copies.has(plotId) ? '2' : '1') };
  }
  const { roundIndex } = keyShape(info);
  const code = info?.reassessmentCode ?? null;
  if (info?.state === 'own' && code !== null && roundIndex !== null) {
    return { kind: 'replace', index: roundIndex, value: (plotId, current) => (copies.has(plotId) ? code : current) };
  }
  return null;
}

/**
 * For one person: which of their copies (in a divided file) are served as main, as
 * they submitted the plot's main assessment (copiesSubmittedAsMain). Only matters
 * while files get a round column; only the person's records of their copies' plots are read,
 * each key once for all the files of one plot list.
 */
function copiesServedAsMain(
  store: Store,
  projectId: string,
  userId: string,
  info: RoundInfo | null,
): (plots: UserPlots) => Promise<ReadonlySet<string>> {
  let user: Promise<{ username: string } | null> | null = null;
  // The person's records read so far, by record key; each file's copies read the keys not read yet
  // (one memo for every file of the list: the first file's keys alone would leave a later file's
  // copies unread, and its listed checksum would differ from the download's).
  const records = new Map<string, RecordRow[]>();
  return async (plots) => {
    if (plots.copyKeys.length === 0 || roundColumnOf(info, new Set()) === null) {
      return new Set();
    }
    user ??= store.getUserById(userId).then((u) => (u ? { username: u.username } : null));
    const who = await user;
    if (!who) {
      return new Set();
    }
    // Only the records the copies' plots can have (every collector holds copies once there are
    // reference plots, Task 14: reading every record of the project for each plot list would not do).
    const keys = new Set<string>();
    for (const unit of plots.copyKeys) for (const k of recordKeysOfUnit(unit, info)) keys.add(k);
    const missing = [...keys].filter((k) => !records.has(k));
    if (missing.length > 0) {
      for (const k of missing) records.set(k, []);
      for (const r of await store.listRecordsByKeys(projectId, missing)) {
        if (r.operator === who.username) records.get(r.recordKey)?.push(r);
      }
    }
    const mine = [...keys].flatMap((k) => records.get(k) ?? []);
    return copiesSubmittedAsMain(mine, userId, who.username, plots, info);
  };
}

/**
 * The reference copies a collector does not hold yet (Task 14): added in one transaction, only
 * while each plot is still a reference plot of a divided file (changeReferencePlots).
 */
async function addOwnReferenceCopies(store: Store, projectId: string, userId: string): Promise<void> {
  const references = await store.listReferencePlots(projectId);
  if (references.length === 0) return;
  const holdings = new Map<string, { plotKey: string; userId: string; overlap: boolean }[]>(references.map((r) => [r.csvFileId, []]));
  for (const h of await store.listPlotHoldings(projectId, userId)) {
    const copies = new Set(h.copyKeys);
    holdings.set(h.csvFileId, h.plotKeys.map((plotKey) => ({ plotKey, userId, overlap: copies.has(plotKey) })));
  }
  const plan = referenceCopyPlan({
    references,
    members: [{ userId, username: '', role: 'operator' }],
    holdings,
    hasRecord: () => false,
    only: userId,
  });
  if (plan.add.length > 0) {
    await store.changeReferencePlots(projectId, { unmark: [], dropCopies: [], mark: [], addCopies: plan.add, at: Date.now(), by: null });
  }
}

interface ServedFile {
  data: Buffer;
  checksum: string;
  plotCount: number;
}

/**
 * Recently built files, the same for my-assignment and the download that follows it:
 * at most 32, and 128 MB in all. A null entry is a person with no plot left in the file.
 */
const SERVED_CACHE_ENTRIES = 32;
const SERVED_CACHE_BYTES = 128 * 1024 * 1024;
const servedFiles = new Map<string, ServedFile | null>();
let servedBytes = 0;

function cacheGet(key: string): ServedFile | null | undefined {
  if (!servedFiles.has(key)) {
    return undefined;
  }
  const value = servedFiles.get(key)!;
  servedFiles.delete(key);
  servedFiles.set(key, value);
  return value;
}

function cacheSet(key: string, value: ServedFile | null): void {
  const old = servedFiles.get(key);
  if (old) {
    servedBytes -= old.data.length;
  }
  servedFiles.delete(key);
  if (value && value.data.length > SERVED_CACHE_BYTES / 4) {
    return; // a very big file is built each time rather than pushing everything out
  }
  servedFiles.set(key, value);
  servedBytes += value?.data.length ?? 0;
  while (servedFiles.size > SERVED_CACHE_ENTRIES || servedBytes > SERVED_CACHE_BYTES) {
    const [oldest, entry] = servedFiles.entries().next().value as [string, ServedFile | null];
    servedFiles.delete(oldest);
    servedBytes -= entry?.data.length ?? 0;
  }
}

/** What a built file depends on, apart from the plots: the content and the round. */
function roundKey(file: { checksum: string }, info: RoundInfo | null): string {
  return [file.checksum, fileKeyCount(info), info?.state ?? '-', info?.roundIndex ?? '-', info?.reassessmentCode ?? '-'].join(':');
}

function wholeKey(file: { checksum: string }, info: RoundInfo | null): string {
  return `whole:${roundKey(file, info)}`;
}

function ownKey(file: { checksum: string }, plots: UserPlots, info: RoundInfo | null, asMain: ReadonlySet<string>): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([[...plots.plotKeys].sort(), [...plots.copyKeys].sort(), [...asMain].sort()]))
    .digest('hex');
  return `own:${roundKey(file, info)}:${hash}`;
}

/** The whole file with the round column inserted, when it was built recently. */
function cachedWholeFile(file: { checksum: string }, info: RoundInfo | null): ServedFile | null {
  return info?.state === 'added' ? cacheGet(wholeKey(file, info)) ?? null : null;
}

/** One person's built file when it was built recently (null: none of their plots), else undefined. */
function cachedOwnFile(
  file: { checksum: string },
  plots: UserPlots,
  info: RoundInfo | null,
  asMain: ReadonlySet<string>,
): ServedFile | null | undefined {
  return cacheGet(ownKey(file, plots, info, asMain));
}

/**
 * A whole (not divided) file as people get it. Only an inserted round changes it: a
 * whole file has no quality-check copies, so a replaced round would keep every value,
 * and the file is served as uploaded.
 */
function wholeFile(file: { checksum: string; data: Buffer; plotCount: number }, info: RoundInfo | null): ServedFile {
  const round = roundColumnOf(info, new Set());
  if (round?.kind !== 'insert') {
    return { data: file.data, checksum: file.checksum, plotCount: file.plotCount };
  }
  const cached = cachedWholeFile(file, info);
  if (cached) {
    return cached;
  }
  const plotFile = plotFileOf(file, fileKeyCount(info));
  const data = buildPlotFile(plotFile, null, round);
  const built = { data, checksum: checksumOf(data), plotCount: plotFile.plotIds.length };
  cacheSet(wholeKey(file, info), built);
  return built;
}

/**
 * One person's "To check again" file (src/sendBack.ts): the header row and the rows of their
 * plots sent back, in file order, each with the round of their own record (2 or the
 * reassessment code on a check, as on the copy they were given); null when none of them is in
 * the file (any more).
 */
function recheckServed(file: { checksum: string; data: Buffer }, recheck: RecheckFile, info: RoundInfo | null): ServedFile | null {
  const hash = createHash('sha256')
    .update(JSON.stringify([[...recheck.plots].sort(), [...recheck.checks].sort()]))
    .digest('hex');
  const key = `recheck:${roundKey(file, info)}:${hash}`;
  const cached = cacheGet(key);
  if (cached !== undefined) {
    return cached;
  }
  const plotFile = plotFileOf(file, fileKeyCount(info));
  const keys = new Set(plotFile.plotIds.filter((id) => recheck.plots.has(id)));
  let built: ServedFile | null = null;
  if (keys.size > 0) {
    const round = roundColumnOf(info, recheck.checks) ?? undefined;
    const data = buildPlotFile(plotFile, keys, round);
    built = { data, checksum: checksumOf(data), plotCount: keys.size };
  }
  cacheSet(key, built);
  return built;
}

/**
 * One person's file of a divided plot file, from the plots they hold, with the round
 * column when the survey has one to fill in; null when none of their plots is in the
 * file (any more). The plot keys are the file's first fileKeyCount(info) columns.
 * `asMain` are the copies served with the main round (copiesServedAsMain): the value
 * 1 (added) or the file's own value, not the reassessment code.
 */
function ownFile(
  file: { checksum: string; data: Buffer },
  plots: UserPlots,
  info: RoundInfo | null,
  asMain: ReadonlySet<string>,
): ServedFile | null {
  const key = ownKey(file, plots, info, asMain);
  const cached = cacheGet(key);
  if (cached !== undefined) {
    return cached;
  }
  const plotFile = plotFileOf(file, fileKeyCount(info));
  const inFile = new Set(plotFile.plotIds);
  const keys = new Set(plots.plotKeys.filter((k) => inFile.has(k)));
  let built: ServedFile | null = null;
  if (keys.size > 0) {
    const round = roundColumnOf(info, new Set(plots.copyKeys.filter((k) => !asMain.has(k)))) ?? undefined;
    const data = buildPlotFile(plotFile, keys, round);
    built = { data, checksum: checksumOf(data), plotCount: keys.size };
  }
  cacheSet(key, built);
  return built;
}
