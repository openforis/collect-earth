import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resubmittedAfterRecheck } from '../flags.js';
import { visibleId } from '../plotShape.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { GEO_PAGE_SIZE, GEO_STATUSES, geoPage, plotsGeo, type GeoFile, type GeoMap } from '../plotsGeo.js';
import { isPlotUnit } from '../progress.js';
import type { ProjectStateCache } from '../projectState.js';
import { remember, sha256, type Log, type QualityService, type ServedReport } from '../qualityService.js';
import { fileKeyCount } from '../rounds.js';
import type { Store } from '../store/store.js';
import type { CsvFile, DecisionKind } from '../types.js';
import { isWgs84, placesOfPlotFile, type PlotPlaceReader } from './plotPlaces.js';
import { MAX_NAME } from './quality.js';

/**
 * The map of progress (Task 9, monitoring Phase 5), for coordinators and reviewers
 * (collectors and project tokens 403):
 *
 * GET /v1/projects/:pid/map/plots?file=&person=&offset=&size=&version= gives the plots of the
 * plot files that have a latitude and longitude, as compact arrays: `points` [lat, lon, status,
 * holder], `plots` (each point's plot id) and `names` (the id the collector sees, or null),
 * GEO_PAGE_SIZE at most a page (`next` is the next page's offset). With them, on every page:
 * the plots per status (`counts`, those off the map included), `notOnMap`, the files (`plots`,
 * `onMap`), and for coordinators the people (`people`, the person filter) and the groups of
 * people holding a plot (`holders`, which `holder` indexes). Reviewers get neither (Decision 3:
 * they do not see who holds plots), and the person filter is refused to them.
 *
 * A map is built once (the request without `version`) and kept a short while under its
 * `version`; the next pages name it and are slices of that build, so every page of a map
 * agrees, whatever is decided or sent meanwhile. The version is a hash of the map's inputs
 * (mapVersion), so a server that does not have the build (expired, pushed out, or another
 * instance) builds it again when its inputs still give that version; when they no longer do, the
 * page is a 409 `map_changed`: the dashboard reads it again.
 *
 * Not `/plots/geo`: that is the page of a plot named "geo" (GET /plots/:plot).
 *
 * The plots, their state and holders come from the project's state (ProjectStateCache, as the
 * Progress tab), the places from the plot files (read in parallel and kept per project while
 * the files stay the same), the decisions from the store, and the disagreements and plots
 * submitted again after "both need another look" from the quality figures at hand only
 * (QualityService.peek, never awaited). A survey whose coordinates are not latitude and
 * longitude puts no plot on the map (`unsupportedSrs`), as for the Google Earth links.
 */

/** A built map is kept this long for its next pages. */
export const GEO_BUILD_TTL_MS = 2 * 60_000;
/** At most this many built maps are kept (least recently used out first). */
export const MAX_GEO_BUILDS = 8;
/** Projects whose plot places are kept. */
export const MAX_PLACE_PROJECTS = 4;

interface Build {
  projectId: string;
  /** The filters and role it was built for. */
  key: string;
  map: GeoMap;
  at: number;
  extras: Record<string, unknown>;
}

interface PlaceEntry {
  key: string;
  files: Promise<Map<string, ReadonlyMap<string, readonly [number, number]> | null>>;
}

/** Each project's plot places (per plot file), read in parallel once per version of its files. */
export class GeoPlaces {
  private readonly entries = new Map<string, PlaceEntry>();
  /** Plot files read (for tests). */
  reads = 0;

  constructor(private readonly store: Store) {}

  get(projectId: string, files: readonly CsvFile[], keyCount: number, log: Log): Promise<Map<string, ReadonlyMap<string, readonly [number, number]> | null>> {
    const key = JSON.stringify([keyCount, files.map((f) => [f.id, f.checksum])]);
    const hit = this.entries.get(projectId);
    if (hit && hit.key === key) {
      remember(this.entries, projectId, hit, MAX_PLACE_PROJECTS);
      return hit.files;
    }
    const promise = (async () => {
      const read = await Promise.all(
        files.map(async (meta) => {
          try {
            this.reads += 1;
            const file = await this.store.getCsvFile(projectId, meta.id);
            return [meta.id, file ? placesOfPlotFile(file, keyCount).places : null] as const;
          } catch (err) {
            log.error({ err, csvFileId: meta.id }, 'map: could not read the plot file');
            return [meta.id, null] as const;
          }
        }),
      );
      return new Map(read);
    })();
    const entry = { key, files: promise };
    remember(this.entries, projectId, entry, MAX_PLACE_PROJECTS);
    // A failed read is not kept.
    promise.then(
      (files) => {
        if ([...files.values()].some((p) => p === null) && this.entries.get(projectId) === entry) this.entries.delete(projectId);
      },
      () => this.entries.get(projectId) === entry && this.entries.delete(projectId),
    );
    return promise;
  }
}

/**
 * A map's version: a hash of what it is built from (the project state's version, the decisions,
 * the figures at hand by their inputs' version, the survey's coordinate system and hidden keys,
 * which files have places, and the filters and role), the same on every instance for the same
 * inputs.
 */
export function mapVersion(inputs: Record<string, unknown>): string {
  return sha256(JSON.stringify(inputs)).slice(0, 20);
}

export async function registerPlotsGeoRoutes(
  app: FastifyInstance,
  store: Store,
  quality: QualityService,
  states: ProjectStateCache,
  places: PlotPlaceReader,
  options: { now?: () => number; geoPlaces?: GeoPlaces } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const geoPlaces = options.geoPlaces ?? new GeoPlaces(store);
  const builds = new Map<string, Build>();
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const bad = (reply: FastifyReply, reason: string) => reply.code(400).send({ error: 'bad_request', reason });
  const whole = (value: string | undefined, fallback: number): number | null => {
    if (value === undefined) return fallback;
    return /^\d{1,9}$/.test(value) ? Number(value) : null;
  };
  const sweep = () => {
    const at = now();
    for (const [id, b] of builds) if (at - b.at > GEO_BUILD_TTL_MS) builds.delete(id);
  };

  app.get('/v1/projects/:pid/map/plots', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, role } = request.membership!;
    const coordinator = role === 'admin';
    const query = (request.query ?? {}) as { file?: unknown; person?: unknown; offset?: string; size?: string; version?: unknown };
    const offset = whole(typeof query.offset === 'string' ? query.offset : undefined, 0);
    if (offset === null) return bad(reply, 'offset must be a whole number from 0');
    const asked = whole(typeof query.size === 'string' ? query.size : undefined, GEO_PAGE_SIZE);
    if (asked === null || asked < 1) return bad(reply, `size must be a whole number from 1 (at most ${GEO_PAGE_SIZE} are given)`);
    const size = Math.min(asked, GEO_PAGE_SIZE);
    const text = (value: unknown): string | null | false => (value === undefined || value === '' ? null : typeof value === 'string' && value.length <= MAX_NAME ? value : false);
    const file = text(query.file);
    const person = text(query.person);
    const version = text(query.version);
    if (file === false) return bad(reply, `file must be a plot file id of at most ${MAX_NAME} characters`);
    if (person === false) return bad(reply, `person must be a username of at most ${MAX_NAME} characters`);
    if (version === false) return bad(reply, 'version must be the version of the first page');
    if (person !== null && !coordinator) {
      return reply.code(403).send({ error: 'forbidden', reason: 'only coordinators see who holds each plot' });
    }
    const key = JSON.stringify([projectId, file, person, coordinator]);
    sweep();

    if (version !== null) {
      // The next pages of a map: slices of the build the first page made.
      const hit = builds.get(version);
      if (hit && hit.key === key) {
        remember(builds, version, hit, MAX_GEO_BUILDS);
        return reply.send(answer(version, hit, offset, size));
      }
    }
    // A map's version is a hash of what it is built from, so any instance (or this one after the
    // build was pushed out) builds the same map again for it: a page whose version no longer
    // matches the inputs is a 409 `map_changed` (the dashboard reads the map again).
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
    const read = latLon ? await geoPlaces.get(projectId, state.files, fileKeyCount(state.info), request.log) : null;
    const versionWith = (f: ServedReport | null) =>
      mapVersion({
        key,
        state: state.version,
        decisions: decisions.map((d) => [d.plot, d.decision, d.decidedAt]),
        figures: f ? (f.version ?? f.computedAt) : null,
        srid: facts.srid,
        hidden: facts.hidden,
        places: state.files.map((x) => read?.get(x.id) != null),
      });
    let id = versionWith(figures);
    if (version !== null && version !== id) {
      // The instance that built it may have had other figures at hand (none, or those of the inputs
      // now while this one holds older ones): those are tried, the computed ones only on this miss.
      const others: (() => Promise<ServedReport | null>)[] = [async () => null, () => quality.report(projectId, request.log)];
      for (const other of figures ? others : others.slice(1)) {
        let f: ServedReport | null;
        try {
          f = await other();
        } catch (err) {
          request.log.warn({ err, projectId }, 'map: the figures could not be worked out for a page');
          continue;
        }
        if (versionWith(f) === version) {
          figures = f;
          id = version;
          break;
        }
      }
      if (id !== version) {
        return reply.code(409).send({ error: 'map_changed', reason: 'this map is no longer kept: read it again from its first page' });
      }
    }
    // A reviewer's map has no reference plot, on it or in its counts (Decision 10: which plots
    // they are is the coordinators'; a status of their many checks would say so).
    const reference = coordinator ? null : state.context.reference;
    const unitsOf = (fileId: string) => {
      const units = state.context.fileUnits.get(fileId) ?? [];
      return reference && reference.size > 0 ? units.filter((u) => !reference.has(u)) : units;
    };
    const files: GeoFile[] = state.files.map((meta) => ({
      id: meta.id,
      filename: meta.filename,
      units: unitsOf(meta.id),
      places: read?.get(meta.id) ?? null,
    }));
    const hidden = facts.hidden;
    const map = plotsGeo({
      files,
      isPlot: isPlotUnit(state.info),
      progress: state.units,
      decisions: new Map<string, DecisionKind>(decisions.map((d) => [d.plot, d.decision])),
      differing: figures ? new Set(figures.report.pairs.plot) : null,
      resubmitted: figures ? new Set(resubmittedAfterRecheck(figures.flags, decisions).map((r) => r.plot)) : null,
      nameOf: hidden && hidden.some(Boolean) ? (unit) => visibleId(unit, hidden) : null,
      people: coordinator,
      file,
      person,
    });
    const build: Build = {
      projectId,
      key,
      map,
      at: now(),
      extras: {
        figures: figures ? { computedAt: figures.computedAt, stale: figures.stale } : null,
        // When the plots' state is older than the records (a newer one is being worked out).
        asOf: served.stale ? state.builtAt : null,
        ...(latLon ? {} : { unsupportedSrs: facts.srid }),
      },
    };
    remember(builds, id, build, MAX_GEO_BUILDS);
    return reply.send(answer(id, build, offset, size));
  });

  function answer(version: string, build: Build, offset: number, size: number) {
    const { map } = build;
    const page = geoPage(map, offset, size);
    return {
      // Every page of one map has it; the next pages send it back.
      version,
      offset,
      total: map.plots.length,
      next: page.next,
      points: page.points,
      plots: page.plots,
      names: page.names,
      statuses: GEO_STATUSES,
      counts: map.counts,
      notOnMap: map.notOnMap,
      files: map.files,
      people: map.people,
      holders: map.holders,
      ...build.extras,
    };
  }
}
