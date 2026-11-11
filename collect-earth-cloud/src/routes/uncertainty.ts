import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cell } from '../analysis.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import type { Store } from '../store/store.js';
import { parseSettings, uncertainty } from '../uncertainty.js';
import { areasSource, firstAssessments, modelOf, projectFactors, type Parsed } from './analysis.js';

/**
 * The uncertainty analysis (src/uncertainty.ts), for coordinators and reviewers (it is over every plot of the project):
 * - `GET /v1/projects/:pid/uncertainty/settings`: the setup, and the survey's code questions and lists to make it with;
 * - `PUT …/uncertainty/settings` (coordinators): saves it;
 * - `GET /v1/projects/:pid/uncertainty`: the tables, from the plots' first assessments, as the expansion factors are.
 */
export async function registerUncertaintyRoutes(app: FastifyInstance, store: Store, states: ProjectStateCache): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const coordinator = { preHandler: requireProjectMembership(store, 'admin') };

  /** The project file's survey, or null when an error was sent instead. */
  const parsedOf = async (projectId: string, reply: FastifyReply): Promise<NonNullable<Parsed> | null> => {
    const cep = await store.getCep(projectId);
    if (!cep) {
      reply.code(404).send({ error: 'no_project_file', message: 'Upload the project file first: the analysis is built from its survey.' });
      return null;
    }
    const parsed = modelOf(cep);
    if (!parsed) reply.code(409).send({ error: 'survey_unreadable', message: 'The survey of the project file cannot be read.' });
    return parsed;
  };
  /** The plot's code questions (one answer each), by name: their list. */
  const codeColumns = (parsed: NonNullable<Parsed>) =>
    new Map(parsed.model.tables[0].columns.filter((c) => c.type === 'code' && !c.multiple && c.list && parsed.model.lists[c.list]).map((c) => [c.name, c.list!]));

  app.get('/v1/projects/:pid/uncertainty/settings', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const parsed = await parsedOf(projectId, reply);
    if (!parsed) return reply;
    const columns = codeColumns(parsed);
    const questions = parsed.model.tables[0].columns.filter((c) => columns.has(c.name)).map((c) => ({ name: c.name, labels: c.labels, list: c.list, parent: c.parent, fromPlotFile: c.fromPlotFile, calculated: c.calculated }));
    const lists = Object.fromEntries([...new Set(columns.values())].map((l) => [l, parsed.model.lists[l]]));
    return reply.header('cache-control', 'no-store').send({
      settings: await store.getUncertaintySettings(projectId),
      languages: parsed.model.languages,
      questions,
      lists,
      // the strata or total set on the dashboard, else the project file's areas file (the page's own total area: null)
      areas: await areasSource(store, projectId, parsed),
      canEdit: request.membership!.role === 'admin',
    });
  });

  app.put('/v1/projects/:pid/uncertainty/settings', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const parsed = await parsedOf(projectId, reply);
    if (!parsed) return reply;
    const settings = parseSettings(request.body, codeColumns(parsed), parsed.model.lists);
    if (typeof settings === 'string') return reply.code(400).send({ error: 'invalid_settings', message: settings });
    await store.setUncertaintySettings(projectId, settings);
    return reply.send({ settings });
  });

  app.get('/v1/projects/:pid/uncertainty', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const parsed = await parsedOf(projectId, reply);
    if (!parsed) return reply;
    const settings = await store.getUncertaintySettings(projectId);
    if (!settings) return reply.code(409).send({ error: 'not_set_up', message: 'Choose the land use questions and map their codes first.' });
    const plotColumns = parsed.model.tables[0].columns;
    const initial = plotColumns.find((c) => c.name === settings.initial && c.type === 'code');
    const final = plotColumns.find((c) => c.name === settings.final && c.type === 'code');
    if (!initial?.list || !final?.list) return reply.code(409).send({ error: 'question_missing', message: 'A land use question of the setup is no longer in the survey: choose it again.' });

    const [served, rows] = await Promise.all([states.get(projectId, request.log), store.listRecordSummaries(projectId)]);
    const { context } = served.state;
    const firsts = firstAssessments(rows, recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders }));
    const factors = await projectFactors(store, projectId, parsed, firsts, context.info);
    if (!factors) return reply.code(409).send({ error: 'needs_total_area', message: 'The project has no areas: enter the total area in hectares, or the strata and their areas on the Plot files tab.' });

    // The strata: their areas are the factors of their plots (one stratum of the total area when there is one)
    const strata = new Map<string, number>();
    for (const f of factors.byPlot.values()) if (f.factor > 0) strata.set(f.stratum, (strata.get(f.stratum) ?? 0) + f.factor);
    const plots = [...firsts].map(([unit, { summary }]) => {
      const f = factors.byPlot.get(unit);
      return { initial: cell(initial, summary[initial.key]), final: cell(final, summary[final.key]), stratum: f && f.factor > 0 ? f.stratum : null };
    });
    const result = uncertainty(plots, strata, { codes: settings.codes, initialList: initial.list, finalList: final.list });
    return reply.header('cache-control', 'no-store').send({ settings, areas: factors.source, ...result });
  });
}
