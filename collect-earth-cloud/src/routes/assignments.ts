import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import type { RoundInfo } from '../cep.js';
import type { Config } from '../config.js';
import { checksumOf } from '../csv.js';
import { checkUploadFits } from '../limits.js';
import { buildPlotFile, parsePlotFile, type RoundColumn } from '../plots.js';
import { fileKeyCount, keyShape } from '../rounds.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store, UserPlots } from '../store/store.js';
import type { Assignment } from '../types.js';
import { plotFileOf, registerDivisionRoutes } from './division.js';

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
 */
export async function registerAssignmentRoutes(app: FastifyInstance, store: Store, config: Config): Promise<void> {
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
      const meta = await store.putCsvFile(projectId, filename, data, parsePlotFile(data, keyCount).plotIds);
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
  app.get(
    '/v1/projects/:pid/csv-files/:id/content',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const id = (request.params as { id: string }).id;
      const isAdmin = request.membership!.role === 'admin';
      const mine = (request.query as { mine?: string }).mine === '1';
      const userId = request.userId;
      const file = isUuid(id) ? await store.getCsvFile(projectId, id) : null;
      if (!file) {
        return reply.code(404).send({ error: 'not_found' });
      }
      let data = file.data;
      let checksum = file.checksum;
      const info = await store.getRoundInfo(projectId);
      if (file.distribution && (mine || !isAdmin)) {
        const plots = userId ? await store.listUserPlots(projectId, id, userId) : null;
        const own = plots && plots.plotKeys.length > 0 ? ownFile(file, plots, info) : null;
        if (!own) {
          return reply.code(404).send({ error: 'not_found' });
        }
        ({ data, checksum } = own);
      } else if (!isAdmin && !(userId && (await store.isAssigned(projectId, id, userId)))) {
        return reply.code(404).send({ error: 'not_found' });
      } else if (mine || !isAdmin) {
        ({ data, checksum } = wholeFile(file, info));
      }
      return reply
        .header('content-type', 'text/csv')
        .header('x-checksum-sha256', checksum)
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .send(data);
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
      const assignments: ReturnType<typeof entry>[] = [];
      for (const f of files) {
        if (!withRound) {
          assignments.push(entry(f));
          continue;
        }
        // The file as this person gets it (with the round column): its checksum and
        // count, downloaded with ?mine=1.
        let whole = cachedWholeFile(f, info);
        if (!whole) {
          const file = await store.getCsvFile(projectId, f.id);
          if (!file) {
            continue;
          }
          whole = wholeFile(file, info);
        }
        assignments.push(entry({ ...f, checksum: whole.checksum, plotCount: whole.plotCount }, '?mine=1'));
      }
      // Divided files where the caller holds plots: their own file's checksum and count.
      const holdings = userId ? await store.listPlotHoldings(projectId, userId) : [];
      for (const holding of holdings) {
        const file = await store.getCsvFile(projectId, holding.csvFileId);
        const own = file ? ownFile(file, holding, info) : null;
        if (file && own) {
          assignments.push(entry({ ...file, checksum: own.checksum, plotCount: own.plotCount }, '?mine=1'));
        }
      }
      return reply.send({ assignments });
    },
  );

  await registerDivisionRoutes(app, store);
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

interface ServedFile {
  data: Buffer;
  checksum: string;
  plotCount: number;
}

/** Whole files with the round column inserted, by checksum and key count: the same for everyone. */
const wholeFiles = new Map<string, ServedFile>();
const WHOLE_CACHE_SIZE = 4;

function cachedWholeFile(file: { checksum: string }, info: RoundInfo | null): ServedFile | null {
  if (info?.state !== 'added') {
    return null;
  }
  const cacheKey = `${file.checksum}:${fileKeyCount(info)}`;
  const cached = wholeFiles.get(cacheKey);
  if (!cached) {
    return null;
  }
  wholeFiles.delete(cacheKey);
  wholeFiles.set(cacheKey, cached);
  return cached;
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
  const keyCount = fileKeyCount(info);
  const plotFile = plotFileOf(file, keyCount);
  const data = buildPlotFile(plotFile, null, round);
  const built = { data, checksum: checksumOf(data), plotCount: plotFile.plotIds.length };
  wholeFiles.set(`${file.checksum}:${keyCount}`, built);
  while (wholeFiles.size > WHOLE_CACHE_SIZE) {
    wholeFiles.delete(wholeFiles.keys().next().value as string);
  }
  return built;
}

/**
 * One person's file of a divided plot file, from the plots they hold, with the round
 * column when the survey has one to fill in; null when none of their plots is in the
 * file (any more). The plot keys are the file's first fileKeyCount(info) columns.
 */
function ownFile(file: { checksum: string; data: Buffer }, plots: UserPlots, info: RoundInfo | null): ServedFile | null {
  const plotFile = plotFileOf(file, fileKeyCount(info));
  const inFile = new Set(plotFile.plotIds);
  const keys = new Set(plots.plotKeys.filter((k) => inFile.has(k)));
  if (keys.size === 0) {
    return null;
  }
  const round = roundColumnOf(info, new Set(plots.copyKeys)) ?? undefined;
  const data = buildPlotFile(plotFile, keys, round);
  return { data, checksum: checksumOf(data), plotCount: keys.size };
}
