import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { cepProperties, CepError, readCep, roundInfoOf, withProperties } from '../cep.js';
import { checkImagery, imageryOf } from '../imagery.js';
import { checkUploadFits } from '../limits.js';
import { checkPlotLayout, plotLayoutOf, rewriteProperties } from '../plotLayout.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { ImageryAnswer, PlotLayoutAnswer, PlotLayoutChangeAnswer, PropertiesValues } from '../wire/projects.js';
import type { PlotPlaceReader } from './plotPlaces.js';

type Values = Record<string, string | undefined>;

/** The keys a setting has, with their values (a key the properties lack is left out, as JSON leaves it). */
const present = (values: Values): PropertiesValues =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined));

/** Settings of Collect Earth the coordinator keeps in the project file's project_definition.properties. */
interface ProjectSettings {
  /** The route under /v1/projects/:pid/ */
  path: string;
  /** Its name in the activity log (settings.changed) */
  setting: string;
  of(properties: ReadonlyMap<string, string>): Values;
  check(body: unknown, current: Values): { changes: Values } | { reason: string };
  /** The GET's answer */
  read(values: PropertiesValues, projectId: string): Promise<object>;
  /** The PUT's answer: the values as they are now */
  written(values: PropertiesValues): object;
}

/**
 * Settings of the project file that the coordinator changes in the dashboard's Setup (Plot layout & imagery): the plot layout (Collect Earth's
 * Settings > Plot) and the imagery windows (Settings > Imagery). Read by any member (Collect Earth asks during its sync
 * and applies a change by itself). Cloud only (LOCAL_OFF_ROUTES): alone, the person changes them in Collect Earth's
 * settings.
 */
export async function registerPlotLayoutRoutes(app: FastifyInstance, store: Store, places: PlotPlaceReader): Promise<void> {
  registerProjectSettings(app, store, places, {
    path: 'plot-layout',
    setting: 'plotLayout',
    of: plotLayoutOf,
    check: checkPlotLayout,
    read: async (layout, projectId) => ({ layout, recordsExist: await store.hasRecords(projectId) }) satisfies PlotLayoutAnswer,
    written: (layout) => ({ layout }) satisfies PlotLayoutChangeAnswer,
  });
  registerProjectSettings(app, store, places, {
    path: 'imagery',
    setting: 'imagery',
    of: imageryOf,
    check: (body, current) => checkImagery(body, current),
    read: async (imagery) => ({ imagery }) satisfies ImageryAnswer,
    written: (imagery) => ({ imagery }) satisfies ImageryAnswer,
  });
}

function registerProjectSettings(app: FastifyInstance, store: Store, places: PlotPlaceReader, settings: ProjectSettings): void {
  const url = `/v1/projects/:pid/${settings.path}`;
  app.get(url, { preHandler: requireProjectMembership(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    // Read from the facts kept per project file (Collect Earth asks every few minutes)
    const { properties } = await places.surveyFacts(projectId, request.log);
    if (!properties) return reply.code(404).send({ error: 'not_found' });
    return reply.send(await settings.read(present(settings.of(properties)), projectId));
  });

  // Rewrites the keys of project_definition.properties in the served project file (and the one as uploaded, so that
  // downloading it keeps them); nothing else of it changes.
  app.put(url, { preHandler: requireProjectMembership(store, 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [served, before] = await Promise.all([store.getCep(projectId), store.getCepInfo(projectId)]);
    if (!served || !before) return reply.code(404).send({ error: 'not_found' });
    let current: Values;
    try {
      current = settings.of(cepProperties(readCep(served)));
    } catch (e) {
      if (e instanceof CepError) return reply.code(409).send({ error: 'unreadable', reason: 'the project file cannot be read' });
      throw e;
    }
    const checked = settings.check(request.body, current);
    if ('reason' in checked) return reply.code(400).send({ error: 'bad_request', reason: checked.reason });
    const { changes } = checked;
    const changed = Object.entries(changes).some(([k, v]) => current[k] !== v);
    if (!changed) return reply.send(settings.written(present(current)));

    const date = new Date();
    const rewrite = (zip: Buffer) => withProperties(zip, (data) => rewriteProperties(data, changes), date);
    const stored = await store.getOriginalCep(projectId);
    const original = stored && !stored.equals(served) ? rewrite(stored) : null;
    const next = rewrite(served);
    const over = await checkUploadFits(store, projectId, { kind: 'cep' }, next.length + (original?.length ?? 0));
    if (over) return reply.code(413).send(over);
    await store.putCep(projectId, next, (await store.getRoundInfo(projectId)) ?? roundInfoOf(next), original);

    // Collect Earth applies the change by itself: who had the project file before still has it,
    // so the dashboard does not tell the coordinator to send them a link for a new one.
    const after = await store.getCepInfo(projectId);
    if (after) {
      for (const a of await store.listMemberActivity(projectId)) {
        if (a.lastCepDownloadAt !== null && a.lastCepDownloadAt >= before.updatedAt) {
          await store.touchMemberActivity(projectId, a.userId, { lastCepDownloadAt: after.updatedAt });
        }
      }
    }
    await audit(store, request, 'settings.changed', { setting: settings.setting });
    return reply.send(settings.written(present({ ...current, ...changes })));
  });
}
