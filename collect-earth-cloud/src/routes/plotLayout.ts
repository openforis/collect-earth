import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { cepProperties, CepError, readCep, roundInfoOf, withProperties } from '../cep.js';
import { checkUploadFits } from '../limits.js';
import { checkPlotLayout, plotLayoutOf, rewritePlotLayout } from '../plotLayout.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { PlotPlaceReader } from './plotPlaces.js';

/**
 * The plot layout of the project file (Collect Earth's Settings > Plot): read by any member (Collect Earth
 * asks during its sync and applies a change by itself), changed by the coordinator on the Project file tab.
 * Cloud only (LOCAL_OFF_ROUTES): alone, the person changes it in Collect Earth's settings.
 */
export async function registerPlotLayoutRoutes(app: FastifyInstance, store: Store, places: PlotPlaceReader): Promise<void> {
  app.get(
    '/v1/projects/:pid/plot-layout',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      // Read from the facts kept per project file (Collect Earth asks every few minutes)
      const { properties } = await places.surveyFacts(projectId, request.log);
      if (!properties) return reply.code(404).send({ error: 'not_found' });
      return reply.send({ layout: plotLayoutOf(properties), recordsExist: await store.hasRecords(projectId) });
    },
  );

  // Rewrites the layout keys of project_definition.properties in the served project file (and the one as
  // uploaded, so that downloading it keeps the layout); nothing else of it changes.
  app.put(
    '/v1/projects/:pid/plot-layout',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const [served, before] = await Promise.all([store.getCep(projectId), store.getCepInfo(projectId)]);
      if (!served || !before) return reply.code(404).send({ error: 'not_found' });
      let current;
      try {
        current = plotLayoutOf(cepProperties(readCep(served)));
      } catch (e) {
        if (e instanceof CepError) return reply.code(409).send({ error: 'unreadable', reason: 'the project file cannot be read' });
        throw e;
      }
      const checked = checkPlotLayout(request.body, current);
      if ('reason' in checked) return reply.code(400).send({ error: 'bad_request', reason: checked.reason });
      const { changes } = checked;
      const changed = Object.entries(changes).some(([k, v]) => current[k as keyof typeof current] !== v);
      if (!changed) return reply.send({ layout: current });

      const date = new Date();
      const rewrite = (zip: Buffer) => withProperties(zip, (data) => rewritePlotLayout(data, changes), date);
      const stored = await store.getOriginalCep(projectId);
      const original = stored && !stored.equals(served) ? rewrite(stored) : null;
      const next = rewrite(served);
      const over = await checkUploadFits(store, projectId, { kind: 'cep' }, next.length + (original?.length ?? 0));
      if (over) return reply.code(413).send(over);
      await store.putCep(projectId, next, (await store.getRoundInfo(projectId)) ?? roundInfoOf(next), original);

      // Collect Earth applies the new layout by itself: who had the project file before still has it,
      // so the dashboard does not tell the coordinator to send them a link for a new one.
      const after = await store.getCepInfo(projectId);
      if (after) {
        for (const a of await store.listMemberActivity(projectId)) {
          if (a.lastCepDownloadAt !== null && a.lastCepDownloadAt >= before.updatedAt) {
            await store.touchMemberActivity(projectId, a.userId, { lastCepDownloadAt: after.updatedAt });
          }
        }
      }
      await audit(store, request, 'settings.changed', { setting: 'plotLayout' });
      return reply.send({ layout: { ...current, ...changes } });
    },
  );
}
