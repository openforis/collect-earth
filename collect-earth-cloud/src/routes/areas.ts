import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { areasFileText, comparable, parseAreaSettings, strataOfFile, type AreaSettings } from '../areas.js';
import { attachment } from '../download.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { isPlotUnit } from '../progress.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import type { Store } from '../store/store.js';
import { firstAssessments, modelOf, plotFileValues, projectFactors, questionOf, strataValues, type Parsed } from './analysis.js';

/** The strata found in the plots and listed on the page, beyond those with an area (a column of many values). */
const MAX_LISTED = 500;

/**
 * Strata and areas (docs/plans/2026-11-11-strata-areas.md, step 2), what the plots' expansion factors come from:
 * - `GET /v1/projects/:pid/areas` (coordinators, reviewers): where they come from, the strata with their plots in the
 *   plot files, their plots assessed and the hectares a plot stands for, and what does not match;
 * - `PUT …/areas` (coordinators): `{settings}` (src/areas.ts AreaSettings, or null: back to the project file's), or
 *   `{file}`: the text of an areas_per_attribute.csv;
 * - `GET …/areas/file`: the strata as areas_per_attribute.csv, for Collect Earth or a spreadsheet.
 */
export async function registerAreaRoutes(app: FastifyInstance, store: Store, states: ProjectStateCache): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const coordinator = { preHandler: requireProjectMembership(store, 'admin') };

  const parsedOf = async (projectId: string, reply: FastifyReply): Promise<NonNullable<Parsed> | null> => {
    const cep = await store.getCep(projectId);
    if (!cep) {
      reply.code(404).send({ error: 'no_project_file', message: 'Upload the project file first: the strata are read from its survey and the plot files.' });
      return null;
    }
    const parsed = modelOf(cep);
    if (!parsed) reply.code(409).send({ error: 'survey_unreadable', message: 'The survey of the project file cannot be read.' });
    return parsed;
  };

  /** The areas in use, as a setting: the dashboard's, else the project file's areas_per_attribute.csv, else the Uncertainty page's total. */
  const shownOf = async (projectId: string, parsed: NonNullable<Parsed>) => {
    const settings = await store.getAreaSettings(projectId);
    if (settings) return { source: settings.mode as string, areas: settings as AreaSettings, unreadable: 0 };
    if (parsed.regionAreas) return { source: 'region_areas.csv', areas: null, unreadable: 0 };
    const file = parsed.attributeAreas ? strataOfFile(parsed.attributeAreas) : null;
    if (file) return { source: 'areas_per_attribute.csv', areas: { mode: 'strata', ...file.areas } as AreaSettings, unreadable: file.unreadable };
    const total = (await store.getUncertaintySettings(projectId))?.totalArea;
    return total ? { source: 'uncertainty', areas: { mode: 'total', area: total } as AreaSettings, unreadable: 0 } : { source: null, areas: null, unreadable: 0 };
  };

  app.get('/v1/projects/:pid/areas', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const parsed = await parsedOf(projectId, reply);
    if (!parsed) return reply;
    const [shown, served, rows] = await Promise.all([shownOf(projectId, parsed), states.get(projectId, request.log), store.listRecordSummaries(projectId)]);
    const { context } = served.state;
    const firsts = firstAssessments(rows, recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders }));
    const factors = await projectFactors(store, projectId, parsed, firsts, context.info);
    const columns = shown.areas?.mode === 'strata' ? shown.areas.columns : [];
    // The plots of the plot files by stratum (a column only in the answers: not counted), and the plots assessed
    const files = await plotFileValues(store, projectId, context.info, columns);
    const inFiles = columns.every((c, i) => files.found[i] || !questionOf(parsed.model, c)) ? columns.map((_, i) => files.found[i]) : null;
    const isPlot = isPlotUnit(context.info);
    const keyOf = (values: readonly (string | undefined)[]) => values.map(comparable).join('\u0000');
    const strata = new Map<string, { values: string[]; area: number | null; plots: number | null; assessed: number }>();
    if (shown.areas?.mode === 'strata') for (const s of shown.areas.strata) strata.set(keyOf(s.values), { values: s.values, area: s.area, plots: inFiles?.every(Boolean) ? 0 : null, assessed: 0 });
    let more = 0;
    const entry = (values: readonly (string | undefined)[]) => {
      const key = keyOf(values);
      let s = strata.get(key);
      if (!s) {
        if (strata.size >= (shown.areas?.mode === 'strata' ? shown.areas.strata.length : 0) + MAX_LISTED) return null;
        s = { values: values.map((v) => v ?? ''), area: null, plots: inFiles?.every(Boolean) ? 0 : null, assessed: 0 };
        strata.set(key, s);
      }
      return s;
    };
    if (columns.length > 0) {
      if (inFiles?.every(Boolean)) {
        for (const [unit, values] of files.values) {
          if (!isPlot(unit)) continue;
          const s = entry(values);
          if (s) s.plots! += 1;
          else more++;
        }
      }
      const { values } = await strataValues(store, projectId, parsed.model, context.info, columns, firsts);
      for (const v of values.values()) {
        const s = entry(v);
        if (s) s.assessed += 1;
        else more++;
      }
    }
    // The choices: the survey's questions filled from the plot file, then the plot files' other columns
    const questions = parsed.model.tables[0].columns.filter((c) => c.fromPlotFile).map((c) => c.name);
    const choices = [...questions, ...files.headers.filter((h) => !questions.some((q) => q.toLowerCase() === h.toLowerCase()))];
    return reply.header('cache-control', 'no-store').send({
      source: shown.source,
      settings: shown.areas,
      unreadable: shown.unreadable,
      columns: choices,
      strata: [...strata.values()].map((s) => ({ ...s, haPerPlot: s.area !== null && s.assessed > 0 ? s.area / s.assessed : null })),
      more,
      assessed: firsts.size,
      withArea: factors?.byPlot.size ?? 0,
      unknownColumns: factors?.unknownColumns ?? [],
      noStratum: factors?.noStratum ?? { plots: 0, examples: [] },
      canEdit: request.membership!.role === 'admin',
    });
  });

  app.put('/v1/projects/:pid/areas', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { settings?: unknown; file?: unknown };
    let settings: AreaSettings | null;
    if (typeof body.file === 'string') {
      const read = strataOfFile(body.file);
      if (!read) return reply.code(400).send({ error: 'invalid_areas', message: 'The file needs a header: the columns that make the strata, then area.' });
      if (read.areas.strata.length === 0) return reply.code(400).send({ error: 'invalid_areas', message: 'The file has no line with an area.' });
      const checked = parseAreaSettings({ mode: 'strata', ...read.areas });
      if (typeof checked === 'string') return reply.code(400).send({ error: 'invalid_areas', message: checked });
      settings = checked;
    } else if (body.settings === null) {
      settings = null;
    } else {
      const checked = parseAreaSettings(body.settings);
      if (typeof checked === 'string') return reply.code(400).send({ error: 'invalid_areas', message: checked });
      settings = checked;
    }
    await store.setAreaSettings(projectId, settings);
    await audit(store, request, 'settings.changed', { setting: 'areas', mode: settings?.mode ?? null, strata: settings?.mode === 'strata' ? settings.strata.length : null });
    return reply.send({ settings });
  });

  app.get('/v1/projects/:pid/areas/file', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const parsed = await parsedOf(projectId, reply);
    if (!parsed) return reply;
    const { areas } = await shownOf(projectId, parsed);
    if (areas?.mode !== 'strata') return reply.code(404).send({ error: 'no_strata', message: 'The project has no strata with areas.' });
    return reply
      .header('cache-control', 'no-store')
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment('areas_per_attribute.csv', 'areas_per_attribute.csv'))
      .send(areasFileText(areas));
  });
}
