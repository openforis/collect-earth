// The shapes of a project made from a Collect Earth Online project, copied from CEO in steps (src/ceo/shapes.ts):
// - GET  /v1/projects/:pid/ceo-shapes       -> { state: 'none' | 'reading' | 'done', total, done, missing, error }
// - POST /v1/projects/:pid/ceo-shapes/step  -> the same, after reading the next plots for up to STEP_MS; once all are
//   read, the plot files get their plot_shape column. Coordinators only. A step that CEO stops answering keeps the
//   plots it did not read for the next step, so the job goes on whenever the dashboard asks again.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fetchPlotShape, shapesProgress, withShapes, type CeoShapesJob } from '../ceo/shapes.js';
import { checkUploadFits } from '../limits.js';
import { parsePlotFile } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { fileKeyCount } from '../rounds.js';
import type { Store } from '../store/store.js';

/** How long one step reads, so that it answers well within Cloud Run's request time. */
const STEP_MS = 20_000;
/** Plots read from CEO at once (CEO takes about half a second for each). */
const PARALLEL = 8;
const PLOT_TIMEOUT_MS = 30_000;

// shortcut: one step at a time per project in this process only; two server instances could each run one (a plot read
// twice, the later save winning, nothing lost but time). Upgrade to a row lock if the dashboard runs on several.
const running = new Set<string>();

export async function registerCeoShapesRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const coordinator = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/ceo-shapes', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(shapesProgress(await store.getCeoShapes(request.membership!.projectId)));
  });

  app.post('/v1/projects/:pid/ceo-shapes/step', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    if (running.has(projectId)) return reply.code(409).send({ error: 'busy', reason: 'The shapes are being read already.', ...shapesProgress(await store.getCeoShapes(projectId)) });
    running.add(projectId);
    try {
      const job = await store.getCeoShapes(projectId);
      if (!job || job.state === 'done') return reply.send(shapesProgress(job));
      job.error = null;
      const until = Date.now() + STEP_MS;
      // Each worker takes the next plot until the time is up; a plot CEO did not answer for goes back to the queue
      const failed: [string, string][] = [];
      const work = async () => {
        while (Date.now() < until && job.queue.length > 0 && failed.length === 0) {
          const plot = job.queue.shift()!;
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), PLOT_TIMEOUT_MS);
          try {
            const shape = await fetchPlotShape(plot[1], abort.signal);
            if (shape) job.shapes[plot[0]] = shape;
            else job.missing++;
          } catch (err) {
            failed.push(plot);
            job.error = `Collect Earth Online did not answer (${abort.signal.aborted ? 'it took too long' : (err as Error).message}).`;
          } finally {
            clearTimeout(timer);
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, work));
      job.queue.unshift(...failed);
      if (job.queue.length === 0) {
        const stopped = await applyShapes(store, projectId, job, request.log);
        if (stopped) job.error = stopped;
        else job.state = 'done';
      }
      job.updatedAt = Date.now();
      await store.setCeoShapes(projectId, job);
      if (job.state === 'done') request.log.info({ projectId, plots: job.total, missing: job.missing }, 'plot shapes copied from Collect Earth Online');
      return reply.send(shapesProgress(job));
    } finally {
      running.delete(projectId);
    }
  });
}

/** Every plot file with the shapes in its last column; why it stopped when it could not (null when done). */
async function applyShapes(store: Store, projectId: string, job: CeoShapesJob, log: FastifyRequest['log']): Promise<string | null> {
  const keyCount = fileKeyCount(await store.getRoundInfo(projectId));
  for (const meta of await store.listCsvFiles(projectId)) {
    const file = await store.getCsvFile(projectId, meta.id);
    if (!file) continue;
    const data = withShapes(file.data, keyCount, job.shapes, job.fallback);
    if (!data) continue;
    const over = await checkUploadFits(store, projectId, { kind: 'csv', filename: meta.filename }, data.length);
    if (over) return `The project has no room for the plot file ${meta.filename} with its shapes: its space is full. Free some space, then continue.`;
    const stored = await store.putCsvFile(projectId, meta.filename, data, parsePlotFile(data, keyCount).plotIds);
    try {
      await store.appendAudit(projectId, { actorUserId: null, action: 'csv.uploaded', details: { csvFileId: stored.id, plots: stored.plotCount, shapes: 'ceo' } });
    } catch (err) {
      log.error({ err }, 'audit log write failed');
    }
  }
  return null;
}
