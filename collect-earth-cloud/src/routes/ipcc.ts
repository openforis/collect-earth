import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { cell } from '../analysis.js';
import { readCep } from '../cep.js';
import { attachment } from '../download.js';
import {
  ghgiXml,
  ipccPlots,
  ipccSurvey,
  itemDescriptions,
  landUnitsCsv,
  MANAGEMENT_TYPES,
  matrixSheets,
  perPlotCsv,
  strataMatrixSheets,
  timeSeriesXml,
  type IpccPlot,
  type IpccSurvey,
} from '../ipcc.js';
import { IPCC_COUNTRIES } from '../ipccCountries.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import type { Store } from '../store/store.js';
import type { IpccExports } from '../wire/data.js';
import { xlsxOf } from '../xlsx.js';
import { firstAssessments, modelOf, projectFactors } from './analysis.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV = 'text/csv; charset=utf-8';
const XML = 'application/xml; charset=utf-8';

/** The files, by the name of their route: what each is made of, its name (the desktop's in its LULUCF zip) and its type. */
const FILES: Record<string, { name: string; type: string; make: (survey: IpccSurvey, plots: IpccPlot[]) => string | Uint8Array }> = {
  matrix: { name: 'LU_Matrixes.xlsx', type: XLSX, make: (s, p) => xlsxOf(matrixSheets(s, p)) },
  'matrix-strata': { name: 'LU_Matrixes_stratified.xlsx', type: XLSX, make: (s, p) => xlsxOf(strataMatrixSheets(s, p)) },
  plots: { name: 'LU_Timeseries_per_plot.csv', type: CSV, make: perPlotCsv },
  'land-units': { name: 'LU_Timeseries_grouped.csv', type: CSV, make: landUnitsCsv },
  timeseries: { name: 'LU_Timeseries.xml', type: XML, make: timeSeriesXml },
};
/** The region question the desktop's form chose first, when the survey has it. */
const DEFAULT_REGIONS = ['province', 'country', 'district'];

/**
 * Collect Earth's IPCC exports (src/ipcc.ts), for coordinators, from the plots' first assessments (as the Analysis
 * page's areas): not in the local mode, where Collect Earth makes them itself.
 * - `GET /v1/projects/:pid/exports/ipcc`: what the survey lacks for them, the plots, where their areas come from, and
 *   what the form of the file for the IPCC Inventory Software offers (countries, region questions, subdivisions);
 * - `GET …/exports/ipcc/:file`: one file (FILES);
 * - `POST …/exports/ipcc/ghgi { country, region, management: { "<category>/<code>": type } }`: the file for the IPCC
 *   Inventory Software, a subdivision without a valid choice keeping its default management type.
 * Each download is noted (`export.downloaded { kind: 'ipcc', file }`).
 */
export async function registerIpccRoutes(app: FastifyInstance, store: Store, states: ProjectStateCache): Promise<void> {
  const coordinator = { preHandler: requireProjectMembership(store, 'admin') };

  /** The survey and the plots, or null when an error was sent instead. */
  const load = async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const cep = await store.getCep(projectId);
    if (!cep) {
      reply.code(404).send({ error: 'no_project_file', message: 'Upload the project file first: the IPCC exports are made from its survey.' });
      return null;
    }
    const parsed = modelOf(cep);
    if (!parsed) {
      reply.code(409).send({ error: 'survey_unreadable', message: 'The survey of the project file cannot be read.' });
      return null;
    }
    const survey = ipccSurvey(parsed.model);
    // The questions that can hold the region: the plot's texts and codes of one answer
    const regions = parsed.model.tables[0].columns.filter((c) => (c.type === 'text' || c.type === 'code') && !c.multiple && !c.keyAttr);
    if (survey.missing.length > 0) return { cep, survey, regions, plots: [] as IpccPlot[], areas: null };
    const [served, rows] = await Promise.all([states.get(projectId, request.log), store.listRecordSummaries(projectId, { firstSubmissions: true })]);
    const { context } = served.state;
    const firsts = firstAssessments(rows, recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders }));
    const factors = await projectFactors(store, projectId, parsed, firsts, context.info);
    const plots = ipccPlots(survey, [...firsts].map(([unit, f]) => ({ id: unit, summary: f.summary, area: factors?.byPlot.get(unit)?.factor ?? null })));
    return { cep, survey, regions, plots, areas: factors?.source ?? null };
  };

  /**
   * Sends a file made of the plots, noted in the activity; refused when there is nothing to make it of.
   * shortcut: made in memory on the request thread (50,000 plots in a few strata: 0.3 s a file; in hundreds of strata
   * the stratified files take seconds and grow to hundreds of MB, as the desktop's); move to a worker if projects do.
   */
  const send = async (request: FastifyRequest, reply: FastifyReply, loaded: NonNullable<Awaited<ReturnType<typeof load>>>, file: string, spec: { name: string; type: string }, make: () => string | Uint8Array) => {
    if (loaded.survey.missing.length > 0) return reply.code(409).send({ error: 'survey_not_ipcc', missing: loaded.survey.missing });
    if (loaded.plots.length === 0) return reply.code(409).send({ error: 'no_plots', message: 'No plot has a submitted first assessment yet.' });
    const body = make();
    await audit(store, request, 'export.downloaded', { kind: 'ipcc', file, plots: loaded.plots.length });
    return reply
      .header('cache-control', 'no-store')
      .header('content-type', spec.type)
      .header('content-disposition', attachment(spec.name, spec.name))
      .send(typeof body === 'string' ? body : Buffer.from(body));
  };

  app.get('/v1/projects/:pid/exports/ipcc', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const loaded = await load(request, reply);
    if (!loaded) return reply;
    const regions = loaded.regions.map((c) => c.name);
    return reply.header('cache-control', 'no-store').send({
      missing: loaded.survey.missing,
      plots: loaded.plots.length,
      areas: loaded.areas,
      countries: IPCC_COUNTRIES,
      regions,
      region: DEFAULT_REGIONS.find((r) => regions.includes(r)) ?? regions[0] ?? null,
      subdivisions: loaded.survey.subdivisions.map(({ category, code, name, management }) => ({ category, code, name, management })),
    } satisfies IpccExports);
  });

  app.get('/v1/projects/:pid/exports/ipcc/:file', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const file = (request.params as { file: string }).file;
    const spec = Object.hasOwn(FILES, file) ? FILES[file] : undefined;
    if (!spec) return reply.code(404).send({ error: 'not_found' });
    const loaded = await load(request, reply);
    if (!loaded) return reply;
    return send(request, reply, loaded, file, spec, () => spec.make(loaded.survey, loaded.plots));
  });

  app.post('/v1/projects/:pid/exports/ipcc/ghgi', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { country?: unknown; region?: unknown; management?: unknown };
    const loaded = await load(request, reply);
    if (!loaded) return reply;
    const country = IPCC_COUNTRIES.find(([code]) => code === body.country)?.[0];
    const region = loaded.regions.find((c) => c.name === body.region);
    if (!country || !region) return reply.code(400).send({ error: 'invalid_choice', message: 'Choose the country and the question that holds the region.' });
    const chosen = body.management && typeof body.management === 'object' ? (body.management as Record<string, unknown>) : {};
    const subdivisions = loaded.survey.subdivisions.map((s) => {
      const management = chosen[`${s.category}/${s.code}`];
      return typeof management === 'string' && MANAGEMENT_TYPES[s.category].includes(management) ? { ...s, management } : s;
    });
    const make = () => {
      const files = readCep(loaded.cep);
      const soilList = loaded.survey.columns.soil.list ?? '';
      return ghgiXml({ ...loaded.survey, subdivisions }, loaded.plots, {
        country,
        regionOf: (p) => {
          const value = cell(region, p.summary[region.key]);
          return value.trim() === '' ? null : value;
        },
        soilRemarks: itemDescriptions(new TextDecoder().decode(files.entries.get(files.surveyPath)!), soilList),
      });
    };
    return send(request, reply, loaded, 'ghgi', { name: 'GHGi_tool_data.xml', type: XML }, make);
  });
}
