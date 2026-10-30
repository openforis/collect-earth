import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { plotFileOf } from '../plotFileCache.js';
import { isNumber } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { fileKeyCount } from '../rounds.js';
import type { Store } from '../store/store.js';

/** Most plots one call may ask for (a page of the Quality tab's differences). */
export const MAX_PLACES = 200;
/** Longest plot id, as for a decision. */
const MAX_PLOT = 1000;

export interface PlotPlace {
  plot: string;
  lat: number;
  lon: number;
}

/**
 * A coordinate field as Collect Earth reads it (KmlGenerator.getPlotObject): a decimal
 * comma is a point, and it must be a number; null otherwise or out of range.
 */
function coordinate(value: string | undefined, limit: number): number | null {
  const text = (value ?? '').replace(',', '.').trim();
  if (!isNumber(text)) {
    return null;
  }
  const n = Number(text);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * Where some plots are, read from the project's plot files the way Collect Earth reads
 * them: the latitude is the column after the plot's key columns and the longitude the
 * next one. A plot in several files takes the first file listed; a plot in none, or
 * without numeric coordinates, is left out.
 */
export async function plotPlaces(store: Store, projectId: string, plots: readonly string[], log: FastifyRequest['log']): Promise<PlotPlace[]> {
  const wanted = new Set(plots);
  const found = new Map<string, PlotPlace>();
  if (wanted.size === 0) {
    return [];
  }
  const [info, files] = await Promise.all([store.getRoundInfo(projectId), store.listCsvFiles(projectId)]);
  const keyCount = fileKeyCount(info);
  for (const meta of files) {
    if (found.size === wanted.size) {
      break;
    }
    try {
      const file = await store.getCsvFile(projectId, meta.id);
      if (!file) {
        continue;
      }
      for (const row of plotFileOf(file, keyCount).rows) {
        if (!wanted.has(row.id) || found.has(row.id)) {
          continue;
        }
        const lat = coordinate(row.fields[keyCount], 90);
        const lon = coordinate(row.fields[keyCount + 1], 180);
        if (lat !== null && lon !== null) {
          found.set(row.id, { plot: row.id, lat, lon });
        }
      }
    } catch (err) {
      log.error({ err, csvFileId: meta.id }, 'could not read the plot file');
    }
  }
  return [...wanted].flatMap((plot) => found.get(plot) ?? []);
}

/**
 * Where the plots of the Quality tab's differences are (admin, read-only), so the
 * dashboard can link each to Google Earth: POST { plots: [...] } -> { places: [{ plot, lat, lon }] }.
 * The plots are units as the quality figures pair them (Difference.plot).
 */
export async function registerPlotPlaceRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  app.post('/v1/projects/:pid/quality/places', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const plots = (request.body as { plots?: unknown } | null)?.plots;
    if (
      !Array.isArray(plots) ||
      plots.length > MAX_PLACES ||
      !plots.every((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= MAX_PLOT)
    ) {
      return reply.code(400).send({ error: 'bad_request', reason: `plots must be a list of at most ${MAX_PLACES} plot ids of 1-${MAX_PLOT} characters` });
    }
    return reply.send({ places: await plotPlaces(store, request.membership!.projectId, plots, request.log) });
  });
}
