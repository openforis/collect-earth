import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { Assignment } from '../types.js';

interface AssignmentsBody {
  assignments?: { userId?: string; csvFileId?: string }[];
}

/**
 * Phase-B routes: plot CSV files and per-operator assignments. Admins upload CSVs
 * and set the csv↔operator mapping; an operator fetches only its own assignment
 * (my-assignment) plus the CSV content it is entitled to download.
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
      const meta = await store.putCsvFile(request.membership!.projectId, filename, data);
      return reply.code(201).send(meta);
    },
  );

  // List a project's CSV files (admin).
  app.get(
    '/v1/projects/:pid/csv-files',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ csvFiles: await store.listCsvFiles(request.membership!.projectId) });
    },
  );

  // Download a CSV's content. Admins may fetch any; operators only files assigned
  // to them. The checksum is returned in a header so the client can verify.
  app.get(
    '/v1/projects/:pid/csv-files/:id/content',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const id = (request.params as { id: string }).id;
      const isAdmin = request.membership!.role === 'admin';
      if (!isAdmin) {
        const userId = request.userId;
        if (!userId || !(await store.isAssigned(projectId, id, userId))) {
          return reply.code(404).send({ error: 'not_found' });
        }
      }
      const file = await store.getCsvFile(projectId, id);
      if (!file) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply
        .header('content-type', 'text/csv')
        .header('x-checksum-sha256', file.checksum)
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .send(file.data);
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
      return reply.send({
        assignments: files.map((f) => ({
          csvFileId: f.id,
          filename: f.filename,
          checksum: f.checksum,
          plotCount: f.plotCount,
          downloadPath: `/v1/projects/${projectId}/csv-files/${f.id}/content`,
          downloadUrl: base ? `${base}/v1/projects/${projectId}/csv-files/${f.id}/content` : null,
        })),
      });
    },
  );
}
