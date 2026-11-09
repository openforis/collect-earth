import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NOTE_NAME, noteColumn, plotFileExtraColumns, readCep, type RoundInfo } from '../cep.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import {
  areaFromGeoJson,
  areaFromShapefileZip,
  designPlots,
  DesignError,
  featureAreaM2,
  MAX_DESIGN_PLOTS,
  planDesign,
  plotFileCsv,
  type AreaOfInterest,
  type Design,
} from '../plotDesign.js';
import { fileKeyCount } from '../rounds.js';
import type { Store } from '../store/store.js';

interface DesignBody {
  /** The area: a GeoJSON text, or a zipped shapefile in base64. */
  geojson?: unknown;
  shapefile?: unknown;
  design?: Record<string, unknown>;
  seed?: unknown;
  generate?: unknown;
}

/**
 * The survey's extra plot-file columns, in order (null: no readable project file). The coordinator's
 * note the server added is left out: the server puts that column in the files it serves itself.
 */
async function extraColumns(store: Store, projectId: string, info: RoundInfo | null, log: FastifyRequest['log']): Promise<string[] | null> {
  const cep = await store.getCep(projectId);
  if (!cep) return null;
  try {
    const files = readCep(cep);
    const columns = plotFileExtraColumns(new TextDecoder().decode(files.entries.get(files.surveyPath)!));
    return noteColumn(info) !== null ? columns.filter((c) => c !== NOTE_NAME) : columns;
  } catch (err) {
    log.warn({ err }, 'could not read the plot-file columns of the project file');
    return null;
  }
}

const isCount =(n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_DESIGN_PLOTS;

/** The design asked for, checked; a reason in words when it is not one. */
function designOf(raw: Record<string, unknown>, area: AreaOfInterest): Design | string {
  if (raw.method === 'random') {
    return isCount(raw.count) ? { method: 'random', count: raw.count } : `count must be a whole number from 1 to ${MAX_DESIGN_PLOTS}`;
  }
  if (raw.method === 'grid') {
    const spacing = raw.spacingMeters;
    if (typeof spacing !== 'number' || !(spacing >= 1 && spacing <= 1_000_000)) return 'spacingMeters must be a number of metres from 1 to 1,000,000';
    return { method: 'grid', spacingMeters: spacing, randomOffset: raw.randomOffset === true };
  }
  if (raw.method === 'stratified') {
    if (typeof raw.field !== 'string' || !area.fields.includes(raw.field)) return 'field must be one of the fields of the file';
    if (raw.allocation !== 'equal' && raw.allocation !== 'proportional') return "allocation must be 'equal' or 'proportional'";
    if (!isCount(raw.count)) return `count must be a whole number from 1 to ${MAX_DESIGN_PLOTS}`;
    return { method: 'stratified', field: raw.field, allocation: raw.allocation, count: raw.count };
  }
  return "method must be 'random', 'grid' or 'stratified'";
}

/**
 * Plot design (coordinators): POST /v1/projects/:pid/plot-design with the area of interest (`geojson`
 * text or a zipped `shapefile` in base64) and, optionally, a `design` and a `seed`:
 * - without a design: the area read, `{features, fields, areaKm2, max}`;
 * - with one: also how many plots it makes, `{plots, tooMany, strata, seed}`, nothing made;
 * - with `generate: true`: the plot file itself (text/csv, its plots in `x-plot-count`), which the
 *   dashboard then uploads as any plot file (PUT …/csv-files/:filename), so the division,
 *   assignments and progress work on it unchanged.
 * 400 `bad_request` with a `code` (`bad_area`, `too_many`, `several_keys`) and the reason in words.
 */
export async function registerPlotDesignRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/v1/projects/:pid/plot-design', { preHandler: requireProjectMembership(store, 'admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as DesignBody;
    const refuse = (code: string, reason: string) => reply.code(400).send({ error: 'bad_request', code, reason });
    let area: AreaOfInterest;
    try {
      if (typeof body.geojson === 'string') area = areaFromGeoJson(body.geojson);
      else if (typeof body.shapefile === 'string') area = areaFromShapefileZip(Buffer.from(body.shapefile, 'base64'));
      else return refuse('bad_area', 'Send the area of interest: geojson (text) or shapefile (a zip, in base64).');
    } catch (err) {
      if (err instanceof DesignError) return refuse(err.code, err.message);
      throw err;
    }
    const facts = {
      features: area.features.length,
      fields: area.fields,
      areaKm2: area.features.reduce((s, f) => s + featureAreaM2(f), 0) / 1e6,
      max: MAX_DESIGN_PLOTS,
    };
    if (body.design === undefined) return reply.send(facts);
    const design = designOf(body.design ?? {}, area);
    if (typeof design === 'string') return refuse('bad_design', design);
    const seed = Number.isInteger(body.seed) && (body.seed as number) >= 0 && (body.seed as number) < 2 ** 32 ? (body.seed as number) : randomInt(2 ** 32 - 1);

    // The plot file's key columns as the upload reads them: the id, and the survey's own round key.
    const info = await store.getRoundInfo(request.membership!.projectId);
    const keyCount = fileKeyCount(info);
    const roundIndex = info?.state === 'own' && info.roundIndex !== null && info.roundIndex < keyCount ? info.roundIndex : null;
    if (keyCount > (roundIndex === null ? 1 : 2)) {
      return refuse('several_keys', 'The survey identifies a plot by several keys: the server cannot make up their values. Make the plot file in another tool.');
    }
    const roundCode = info?.roundCodes.find((c) => c.code !== info.reassessmentCode)?.code ?? '1';

    try {
      if (body.generate !== true) return reply.send({ ...facts, ...planDesign(area, design, seed), seed });
      const plots = designPlots(area, design, seed);
      const extra = await extraColumns(store, request.membership!.projectId, info, request.log);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('x-plot-count', String(plots.length))
        .send(plotFileCsv(plots, { count: keyCount, roundIndex, roundCode }, extra));
    } catch (err) {
      if (err instanceof DesignError) return refuse(err.code, err.message);
      throw err;
    }
  });
}
