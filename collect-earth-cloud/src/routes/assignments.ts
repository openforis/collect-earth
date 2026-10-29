import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import type { Config } from '../config.js';
import { checksumOf } from '../csv.js';
import { checkUploadFits } from '../limits.js';
import { buildPlotFile, parsePlotFile } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
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
      // The new content's plot ids: a divided file keeps the holdings of those.
      const meta = await store.putCsvFile(request.membership!.projectId, filename, data, parsePlotFile(data).plotIds);
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
  // admin asking ?mine=1) gets their own file, 404 if they hold no plot in it. The
  // checksum of what is served is in a header so the client can verify.
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
      if (file.distribution && (mine || !isAdmin)) {
        const keys = userId ? await store.listUserPlotKeys(projectId, id, userId) : [];
        const own = keys.length > 0 ? ownFile(file, keys) : null;
        if (!own) {
          return reply.code(404).send({ error: 'not_found' });
        }
        ({ data, checksum } = own);
      } else if (!isAdmin && !(userId && (await store.isAssigned(projectId, id, userId)))) {
        return reply.code(404).send({ error: 'not_found' });
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
      const assignments = files.map((f) => entry(f));
      // Divided files where the caller holds plots: their own file's checksum and count.
      for (const holding of userId ? await store.listPlotHoldings(projectId, userId) : []) {
        const file = await store.getCsvFile(projectId, holding.csvFileId);
        const own = file ? ownFile(file, holding.plotKeys) : null;
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
 * One person's file of a divided plot file, from the plots they hold; null when none
 * of them is in the file (any more).
 */
function ownFile(
  file: { checksum: string; data: Buffer },
  plotKeys: string[],
): { data: Buffer; checksum: string; plotCount: number } | null {
  const plotFile = plotFileOf(file);
  const inFile = new Set(plotFile.plotIds);
  const keys = new Set(plotKeys.filter((k) => inFile.has(k)));
  if (keys.size === 0) {
    return null;
  }
  const data = buildPlotFile(plotFile, keys);
  return { data, checksum: checksumOf(data), plotCount: keys.size };
}
