// The plot layout of a project (src/plotLayout.ts), kept in its project file:
// - GET /v1/projects/:pid/plot-layout (reviewer) -> { layout, polygons, canEdit }: the layout as Collect Earth reads it,
//   and whether the plot files carry polygons (the plots are then drawn from them, whatever the shape);
// - PUT /v1/projects/:pid/plot-layout { layout } (admin) -> { layout, changed }: written into the served project file
//   (and the one as uploaded, which the server serves again after a change of rounds). The project file then counts as
//   new: the people who have the older one get the new one as for an upload (People).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { cepProperties, readCep } from '../cep.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { layoutChanges, layoutOf, parseLayout, withLayout } from '../plotLayout.js';
import { hasPolygonColumn } from '../plotShape.js';
import { parsePlotFile } from '../plots.js';
import { fileKeyCount } from '../rounds.js';
import type { Store } from '../store/store.js';

export async function registerPlotLayoutRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  /** The served project file's properties, or null when the answer was sent (no project file, or one not read). */
  const propertiesOf = async (projectId: string, reply: FastifyReply) => {
    const cep = await store.getCep(projectId);
    if (!cep) {
      void reply.code(404).send({ error: 'no_project_file', reason: 'Upload the project file first: the plot layout is kept in it.' });
      return null;
    }
    try {
      return { cep, properties: cepProperties(readCep(cep)) };
    } catch {
      void reply.code(409).send({ error: 'cep_unreadable', reason: 'The project file cannot be read.' });
      return null;
    }
  };

  app.get('/v1/projects/:pid/plot-layout', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const found = await propertiesOf(projectId, reply);
    if (!found) return reply;
    // A plot file whose rows carry a polygon: Collect Earth draws those (KmlGeneratorService), the layout aside
    const keyCount = fileKeyCount(await store.getRoundInfo(projectId));
    let polygons = false;
    for (const file of await store.listCsvFiles(projectId)) {
      const full = await store.getCsvFile(projectId, file.id);
      const rows = full ? parsePlotFile(full.data, keyCount).rows : [];
      if (rows.length > 0 && hasPolygonColumn(rows[0].fields)) {
        polygons = true;
        break;
      }
    }
    return reply.header('cache-control', 'no-store').send({ layout: layoutOf(found.properties), polygons, canEdit: request.membership!.role === 'admin' });
  });

  app.put('/v1/projects/:pid/plot-layout', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const layout = parseLayout(((request.body ?? {}) as { layout?: unknown }).layout);
    if (typeof layout === 'string') return reply.code(400).send({ error: 'invalid_layout', reason: layout });
    const found = await propertiesOf(projectId, reply);
    if (!found) return reply;
    // What the desktop's settings page would write: nothing when nothing changed, and then nobody is asked to get a new
    // project file
    const changes = layoutChanges(found.properties, layout);
    if (Object.keys(changes).length === 0) return reply.send({ layout: layoutOf(found.properties), changed: false });
    const [info, original] = await Promise.all([store.getRoundInfo(projectId), store.getOriginalCep(projectId)]);
    if (!info) return reply.code(409).send({ error: 'cep_unreadable', reason: 'The project file cannot be read.' });
    const now = new Date();
    const served = withLayout(found.cep, changes, now);
    let originalOut: Buffer | null = null;
    if (original) {
      try {
        // the file as uploaded, which the server serves again after a change of rounds: the same settings
        readCep(original);
        originalOut = withLayout(original, changes, now);
      } catch {
        originalOut = null;
      }
    }
    await store.putCep(projectId, served, info, originalOut);
    await audit(store, request, 'settings.changed', { setting: 'plotLayout', shape: layout.sample_shape, points: Number(layout.number_of_sampling_points_in_plot) });
    request.log.info({ projectId, shape: layout.sample_shape }, 'plot layout changed');
    return reply.send({ layout: layoutOf(cepProperties(readCep(served))), changed: true });
  });
}
