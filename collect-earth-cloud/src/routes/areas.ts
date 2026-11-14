import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { AREA_LIMITS, areasFileText, clearEarlierTotalAreas, comparable, earlierTotalArea, parseAreaSettings, strataOfFile, type AreaSettings } from '../areas.js';
import { attachment } from '../download.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { isPlotUnit } from '../progress.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import type { Store } from '../store/store.js';
import type { AreasData, AreasSaved } from '../wire/plotFiles.js';
import { firstAssessments, modelOf, plotFilesOf, plotFileValues, projectFactors, questionOf, strataValues, type Parsed } from './analysis.js';
import type { AreasSource } from '../wire/analysis.js';

/** The strata found in the plots and listed on the page, beyond those with an area (a column of many values). */
const MAX_LISTED = 500;

/** The project file's survey and areas files; without a readable one, no questions: the strata are the plot files' columns. */
export async function surveyOf(store: Store, projectId: string): Promise<NonNullable<Parsed>> {
  const cep = await store.getCep(projectId);
  return (cep ? modelOf(cep) : null) ?? { model: { languages: [], tables: [{ name: 'plot', labels: {}, keyColumn: null, columns: [] }], lists: {} } };
}

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

  /** The areas in use, as a setting: the dashboard's, else the project file's areas_per_attribute.csv, else a total typed before. */
  const shownOf = async (projectId: string, parsed: NonNullable<Parsed>): Promise<{ source: AreasSource | 'uncertainty' | null; areas: AreaSettings | null; unreadable: number }> => {
    const settings = await store.getAreaSettings(projectId);
    if (settings) return { source: settings.mode, areas: settings, unreadable: 0 };
    if (parsed.regionAreas) return { source: 'region_areas.csv', areas: null, unreadable: 0 };
    const file = parsed.attributeAreas ? strataOfFile(parsed.attributeAreas) : null;
    if (file) return { source: 'areas_per_attribute.csv', areas: { mode: 'strata', ...file.areas } as AreaSettings, unreadable: file.unreadable };
    const total = await earlierTotalArea(store, projectId);
    return total ? { source: 'uncertainty', areas: { mode: 'total', area: total } as AreaSettings, unreadable: 0 } : { source: null, areas: null, unreadable: 0 };
  };

  app.get('/v1/projects/:pid/areas', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const parsed = await surveyOf(store, projectId);
    const [shown, served, rows] = await Promise.all([shownOf(projectId, parsed), states.get(projectId, request.log), store.listRecordSummaries(projectId, { firstSubmissions: true })]);
    const { context } = served.state;
    const firsts = firstAssessments(rows, recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders }));
    const plotFiles = plotFilesOf(store, projectId);
    const factors = await projectFactors(store, projectId, parsed, firsts, context.info, plotFiles);
    // ?columns=a,b: the strata other columns would make (choosing them), nothing saved
    const query = (request.query ?? {}) as { columns?: unknown };
    const asked = typeof query.columns === 'string' ? query.columns.split(',').map((c) => c.trim()).filter((c) => c !== '').slice(0, AREA_LIMITS.columns) : null;
    const saved = shown.areas?.mode === 'strata' ? shown.areas.columns : [];
    const columns = asked ?? saved;
    const sameColumns = columns.length === saved.length && columns.every((c, i) => c.toLowerCase() === saved[i].toLowerCase());
    // The plots of the plot files by stratum (a column only in the answers: not counted), and the plots assessed
    const files = await plotFileValues(plotFiles, context.info, columns);
    const inFiles = columns.every((c, i) => files.found[i] || !questionOf(parsed.model, c)) ? columns.map((_, i) => files.found[i]) : null;
    const isPlot = isPlotUnit(context.info);
    const keyOf = (values: readonly (string | undefined)[]) => values.map(comparable).join('\u0000');
    const strata = new Map<string, { values: string[]; area: number | null; plots: number | null; assessed: number }>();
    const given = shown.areas?.mode === 'strata' && sameColumns ? shown.areas.strata : [];
    for (const s of given) strata.set(keyOf(s.values), { values: s.values, area: s.area, plots: inFiles?.every(Boolean) ? 0 : null, assessed: 0 });
    let more = 0;
    const entry = (values: readonly (string | undefined)[]) => {
      const key = keyOf(values);
      let s = strata.get(key);
      if (!s) {
        if (strata.size >= given.length + MAX_LISTED) return null;
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
      const { values } = await strataValues(plotFiles, parsed.model, context.info, columns, firsts);
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
    } satisfies AreasData);
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
    // One place for the areas: a total typed before on another page goes, also when going back to the project file's
    await clearEarlierTotalAreas(store, projectId);
    await audit(store, request, 'settings.changed', { setting: 'areas', mode: settings?.mode ?? null, strata: settings?.mode === 'strata' ? settings.strata.length : null });
    return reply.send({ settings } satisfies AreasSaved);
  });

  app.get('/v1/projects/:pid/areas/file', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const { areas } = await shownOf(projectId, await surveyOf(store, projectId));
    if (areas?.mode !== 'strata') return reply.code(404).send({ error: 'no_strata', message: 'The project has no strata with areas.' });
    return reply
      .header('cache-control', 'no-store')
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment('areas_per_attribute.csv', 'areas_per_attribute.csv'))
      .send(areasFileText(areas));
  });
}
