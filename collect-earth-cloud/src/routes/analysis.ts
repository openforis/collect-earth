import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { analysisModel, analysisTables, ATTRIBUTE_AREAS_CSV, expansionFactors, REGION_AREAS_CSV, type AnalysisModel, type AnalysisRecord } from '../analysis.js';
import { readCep } from '../cep.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import type { Store } from '../store/store.js';

type Parsed = { model: AnalysisModel; regionAreas?: string; attributeAreas?: string } | null;
/** The model of the last project files, by checksum (reading a survey takes a moment; the file changes rarely). */
const models = new Map<string, Parsed>();
const MAX_MODELS = 8;

function modelOf(cep: Buffer): Parsed {
  const checksum = createHash('sha256').update(cep).digest('hex');
  if (models.has(checksum)) return models.get(checksum)!;
  let out: Parsed = null;
  try {
    const files = readCep(cep);
    const text = (path: string) => {
      // the file at the root of the project file, whatever its folder inside the zip
      const entry = [...files.entries].find(([name]) => name === path || name.endsWith(`/${path}`));
      return entry ? new TextDecoder().decode(entry[1]) : undefined;
    };
    out = { model: analysisModel(new TextDecoder().decode(files.entries.get(files.surveyPath)!)), regionAreas: text(REGION_AREAS_CSV), attributeAreas: text(ATTRIBUTE_AREAS_CSV) };
  } catch {
    out = null;
  }
  models.set(checksum, out);
  if (models.size > MAX_MODELS) models.delete(models.keys().next().value!);
  return out;
}

/**
 * `GET /v1/projects/:pid/analysis`: what the dashboard's analysis page (the Saiku replacement) needs, in one answer,
 * gzipped when the browser takes it: the model of the survey (tables, columns, labels, code lists) and the rows of every
 * table as CSV with their DuckDB types, plus the expansion factors from the project file's areas file.
 *
 * Who sees what: coordinators and reviewers every record of the project, the round and whether it is a first assessment
 * or a check included; a collector their own records only, without the round (nothing tells them which of their plots are
 * checks, as on My work). Training records are never in it (they are kept apart). The local mode has its one account as
 * coordinator: everything.
 */
export async function registerAnalysisRoutes(app: FastifyInstance, store: Store, states: ProjectStateCache): Promise<void> {
  const member = { preHandler: requireProjectMembership(store) };
  app.get('/v1/projects/:pid/analysis', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const role = request.membership!.role;
    const cep = await store.getCep(projectId);
    if (!cep) return reply.code(404).send({ error: 'no_project_file', message: 'Upload the project file first: the analysis is built from its survey.' });
    const parsed = modelOf(cep);
    if (!parsed) return reply.code(409).send({ error: 'survey_unreadable', message: 'The survey of the project file cannot be read.' });

    const [served, rows] = await Promise.all([states.get(projectId, request.log), store.listRecordSummaries(projectId)]);
    const { context } = served.state;
    const resolve = recordResolver({ info: context.info, units: context.units, copyHolders: context.copyHolders });
    const everyone = role === 'admin' || role === 'reviewer';
    const username = everyone ? null : (served.members.find((m) => m.userId === request.userId)?.username ?? null);

    const records: AnalysisRecord[] = [];
    for (const r of rows) {
      if (r.deleted) continue;
      if (!everyone && r.operator !== username) continue;
      const { unit, round } = resolve(r);
      records.push({
        recordKey: r.recordKey,
        operator: r.operator,
        plot: unit,
        round: round.round,
        assessment: round.assessment,
        submitted: r.activelySaved,
        modifiedOn: r.modifiedOn,
        summary: r.summary,
      });
    }

    // The expansion factors are the plots', from their first assessments: over the whole project, whoever asks
    let factors = null as ReturnType<typeof expansionFactors>;
    if (parsed.regionAreas || parsed.attributeAreas) {
      const firsts = new Map<string, Record<string, string>>();
      for (const r of rows) {
        if (r.deleted || !r.activelySaved) continue;
        const { unit, round } = resolve(r);
        if (unit !== null && round.assessment === 'main' && !firsts.has(unit)) firsts.set(unit, r.summary);
      }
      factors = expansionFactors({ regionAreas: parsed.regionAreas, attributeAreas: parsed.attributeAreas }, firsts, parsed.model);
    }

    const tables = analysisTables(parsed.model, records, factors?.byPlot ?? null, { hideRounds: !everyone });
    const body = JSON.stringify({
      model: parsed.model,
      scope: everyone ? 'project' : 'own',
      areas: factors ? { source: factors.source, plots: factors.byPlot.size, unmatched: factors.unmatched } : null,
      tables,
    });
    reply.header('cache-control', 'no-store').type('application/json; charset=utf-8');
    if (/\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
      return reply.header('content-encoding', 'gzip').send(gzipSync(body, { level: 6 }));
    }
    return reply.send(body);
  });
}
