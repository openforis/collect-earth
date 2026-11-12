import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { attachment } from '../download.js';
import { ipccPlots, ipccSurvey, landUnitsCsv, matrixSheets, perPlotCsv, strataMatrixSheets, type IpccPlot, type IpccSurvey } from '../ipcc.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import type { Store } from '../store/store.js';
import { xlsxOf } from '../xlsx.js';
import { firstAssessments, modelOf, projectFactors } from './analysis.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV = 'text/csv; charset=utf-8';

/** The files, by the name of their route: what each is made of, its name (the desktop's in its LULUCF zip) and its type. */
const FILES: Record<string, { name: string; type: string; make: (survey: IpccSurvey, plots: IpccPlot[]) => string | Uint8Array }> = {
  matrix: { name: 'LU_Matrixes.xlsx', type: XLSX, make: (s, p) => xlsxOf(matrixSheets(s, p)) },
  'matrix-strata': { name: 'LU_Matrixes_stratified.xlsx', type: XLSX, make: (s, p) => xlsxOf(strataMatrixSheets(s, p)) },
  plots: { name: 'LU_Timeseries_per_plot.csv', type: CSV, make: perPlotCsv },
  'land-units': { name: 'LU_Timeseries_grouped.csv', type: CSV, make: landUnitsCsv },
};

/**
 * Collect Earth's IPCC exports (src/ipcc.ts), for coordinators, from the plots' first assessments (as the Analysis
 * page's areas): not in the local mode, where Collect Earth makes them itself.
 * - `GET /v1/projects/:pid/exports/ipcc`: what the survey lacks for them, the plots, where their areas come from;
 * - `GET …/exports/ipcc/:file`: one file (FILES), each download noted (`export.downloaded { kind: 'ipcc', file }`).
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
    if (survey.missing.length > 0) return { survey, plots: [] as IpccPlot[], areas: null };
    const [served, rows] = await Promise.all([states.get(projectId, request.log), store.listRecordSummaries(projectId, { firstSubmissions: true })]);
    const { context } = served.state;
    const firsts = firstAssessments(rows, recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders }));
    const factors = await projectFactors(store, projectId, parsed, firsts, context.info);
    const plots = ipccPlots(survey, [...firsts].map(([unit, f]) => ({ id: unit, summary: f.summary, area: factors?.byPlot.get(unit)?.factor ?? null })));
    return { survey, plots, areas: factors?.source ?? null };
  };

  app.get('/v1/projects/:pid/exports/ipcc', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const loaded = await load(request, reply);
    if (!loaded) return reply;
    return reply.header('cache-control', 'no-store').send({ missing: loaded.survey.missing, plots: loaded.plots.length, areas: loaded.areas });
  });

  app.get('/v1/projects/:pid/exports/ipcc/:file', coordinator, async (request: FastifyRequest, reply: FastifyReply) => {
    const file = (request.params as { file: string }).file;
    const spec = Object.hasOwn(FILES, file) ? FILES[file] : undefined;
    if (!spec) return reply.code(404).send({ error: 'not_found' });
    const loaded = await load(request, reply);
    if (!loaded) return reply;
    if (loaded.survey.missing.length > 0) return reply.code(409).send({ error: 'survey_not_ipcc', missing: loaded.survey.missing });
    if (loaded.plots.length === 0) return reply.code(409).send({ error: 'no_plots', message: 'No plot has a submitted first assessment yet.' });
    const body = spec.make(loaded.survey, loaded.plots);
    await audit(store, request, 'export.downloaded', { kind: 'ipcc', file, plots: loaded.plots.length });
    return reply
      .header('cache-control', 'no-store')
      .header('content-type', spec.type)
      .header('content-disposition', attachment(spec.name, spec.name))
      .send(typeof body === 'string' ? body : Buffer.from(body));
  });
}
