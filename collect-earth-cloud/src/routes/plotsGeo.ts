import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { GEO_PAGE_SIZE, GEO_STATUSES, geoPage, plotsGeo, type GeoFile } from '../plotsGeo.js';
import { isPlotUnit } from '../progress.js';
import type { ProjectStateCache } from '../projectState.js';
import { sha256, type QualityService, type ServedReport } from '../qualityService.js';
import { fileKeyCount } from '../rounds.js';
import type { Store } from '../store/store.js';
import type { DecisionKind } from '../types.js';
import { isWgs84, type PlotPlaceReader } from './plotPlaces.js';
import { MAX_NAME } from './quality.js';

/**
 * The map of progress (Task 9, monitoring Phase 5), for coordinators and reviewers
 * (collectors and project tokens 403):
 *
 * GET /v1/projects/:pid/map/plots?file=&person=&offset=&size= gives the plots of the plot
 * files that have a latitude and longitude, as compact arrays: `points` [lat, lon, status,
 * holder] and `plots` (each point's plot id), GEO_PAGE_SIZE at most a page (`next` is the
 * next page's offset; every page of one map has the same `version`). With them, on every
 * page: the plots per status (`counts`, those off the map included), `notOnMap`, the files
 * (`plots`, `onMap`), and for coordinators the people (`people`, the person filter) and the
 * groups of people holding a plot (`holders`, which `holder` indexes). Reviewers get neither
 * (Decision 3: they do not see who holds plots), and the person filter is refused to them.
 *
 * Not `/plots/geo`: that is the page of a plot named "geo" (GET /plots/:plot).
 *
 * The plots, their state and holders come from the project's state (ProjectStateCache, as
 * the Progress tab), the places from the plot files (PlotPlaceReader, kept), the decisions
 * from the store, and the disagreements from the quality figures at hand only
 * (QualityService.peek, never awaited): without them, `figures` is null and no plot is a
 * disagreement. A survey whose coordinates are not latitude and longitude puts no plot on
 * the map (`unsupportedSrs`), as for the Google Earth links.
 */
export async function registerPlotsGeoRoutes(
  app: FastifyInstance,
  store: Store,
  quality: QualityService,
  states: ProjectStateCache,
  places: PlotPlaceReader,
): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const bad = (reply: FastifyReply, reason: string) => reply.code(400).send({ error: 'bad_request', reason });
  const whole = (value: string | undefined, fallback: number): number | null => {
    if (value === undefined) return fallback;
    return /^\d{1,9}$/.test(value) ? Number(value) : null;
  };

  app.get('/v1/projects/:pid/map/plots', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, role } = request.membership!;
    const coordinator = role === 'admin';
    const query = (request.query ?? {}) as { file?: unknown; person?: unknown; offset?: string; size?: string };
    const offset = whole(typeof query.offset === 'string' ? query.offset : undefined, 0);
    if (offset === null) return bad(reply, 'offset must be a whole number from 0');
    const asked = whole(typeof query.size === 'string' ? query.size : undefined, GEO_PAGE_SIZE);
    if (asked === null || asked < 1) return bad(reply, `size must be a whole number from 1 (at most ${GEO_PAGE_SIZE} are given)`);
    const size = Math.min(asked, GEO_PAGE_SIZE);
    const text = (value: unknown): string | null | false => (value === undefined || value === '' ? null : typeof value === 'string' && value.length <= MAX_NAME ? value : false);
    const file = text(query.file);
    const person = text(query.person);
    if (file === false) return bad(reply, `file must be a plot file id of at most ${MAX_NAME} characters`);
    if (person === false) return bad(reply, `person must be a username of at most ${MAX_NAME} characters`);
    if (person !== null && !coordinator) {
      return reply.code(403).send({ error: 'forbidden', reason: 'only coordinators see who holds each plot' });
    }

    const [served, facts, decisions] = await Promise.all([
      states.get(projectId, request.log),
      places.surveyFacts(projectId, request.log),
      store.listQualityDecisions(projectId),
    ]);
    const { state } = served;
    if (file !== null && !state.files.some((f) => f.id === file)) return bad(reply, 'no plot file of this project has this id');
    let figures: ServedReport | null = null;
    try {
      figures = await quality.peek(projectId, request.log);
    } catch (err) {
      request.log.warn({ err, projectId }, 'map: the figures at hand could not be read');
    }

    const latLon = isWgs84(facts.srid);
    const keyCount = fileKeyCount(state.info);
    const files: GeoFile[] = [];
    for (const meta of state.files) {
      const units = state.context.fileUnits.get(meta.id) ?? [];
      // Every file (kept by the reader), so each says how many of its plots are on the map.
      const at = latLon ? await places.filePlaces(projectId, meta, keyCount, request.log) : null;
      files.push({ id: meta.id, filename: meta.filename, units, places: at });
    }
    const map = plotsGeo({
      files,
      isPlot: isPlotUnit(state.info),
      progress: state.units,
      decisions: new Map<string, DecisionKind>(decisions.map((d) => [d.plot, d.decision])),
      differing: figures ? new Set(figures.report.pairs.plot) : null,
      people: coordinator,
      file,
      person,
    });
    const page = geoPage(map, offset, size);
    return reply.send({
      // The order of the plots: the same for every page of one map.
      version: sha256(JSON.stringify([state.version, facts.srid, file, person, coordinator])).slice(0, 16),
      offset,
      total: map.plots.length,
      next: page.next,
      points: page.points,
      plots: page.plots,
      statuses: GEO_STATUSES,
      counts: map.counts,
      notOnMap: map.notOnMap,
      files: map.files,
      people: map.people,
      holders: map.holders,
      figures: figures ? { computedAt: figures.computedAt, stale: figures.stale } : null,
      // When the plots' state is older than the records (a newer one is being worked out).
      asOf: served.stale ? state.builtAt : null,
      ...(latLon ? {} : { unsupportedSrs: facts.srid }),
    });
  });
}
