import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { attr, cepProperties, childrenOf, elements, hiddenKeys, parseSurvey, readCep } from '../cep.js';
import { hasPolygonColumn, plotOutline, visibleId, type PlotOutline } from '../plotShape.js';
import { plotFileOf } from '../plotFileCache.js';
import { isNumber } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { fileKeyCount } from '../rounds.js';
import type { Store } from '../store/store.js';

/** Most plots one call may ask for (a page of the Quality tab's differences). */
export const MAX_PLACES = 200;
/** Longest plot id, as for a decision. */
const MAX_PLOT = 1000;
/** Plot files whose places are kept (least recently used out first)... */
export const MAX_CACHED_FILES = 8;
/** ...holding this many places together at most (a file with more is read each time). */
export const MAX_CACHED_PLACES = 250_000;
/** What is read once from a served project file: its first spatial reference system, its plot shape's properties, its hidden keys. */
interface SurveyFacts {
  srid: string;
  properties: Map<string, string> | null;
  hidden: boolean[] | null;
}

/** Served project files whose facts are kept. */
const MAX_CACHED_SRS = 16;

export interface PlotPlace {
  plot: string;
  lat: number;
  lon: number;
  /** The plot id as the collector sees it (keys hidden from the record list left out). */
  name: string;
}

export interface PlotPlaces {
  places: PlotPlace[];
  /** The outline Collect Earth draws around each plot, or only the place (plotShape.ts). */
  outline: PlotOutline;
  /**
   * Set when the survey's coordinates are not latitude and longitude (its first spatial
   * reference system, e.g. "EPSG:32633"): Collect Earth transforms them, this server does
   * not, so no place is given.
   */
  unsupportedSrs?: string;
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

/** Whether Collect Earth takes a spatial reference system for latitude and longitude as they are (GeoUtils.isUsingWGS84). */
export function isWgs84(srid: string): boolean {
  return srid.trim().length === 0 || srid === 'LATLONG' || srid === 'WGS84' || srid === 'EPSG:4326';
}

/** The id of a survey's first spatial reference system ("" when it has none), as KmlGenerator reads it. */
export function firstSrid(idmXml: string): string {
  const { surveyChildren } = parseSurvey(idmXml);
  const list = elements(surveyChildren, 'spatialReferenceSystems')[0];
  const first = list ? elements(childrenOf(list), 'spatialReferenceSystem')[0] : undefined;
  return (first && attr(first, 'srid')) ?? '';
}

/** The places of one plot file, and whether its rows hold polygons. */
interface FilePlaces {
  places: ReadonlyMap<string, readonly [number, number]>;
  polygons: boolean;
}

/** Least recently used out first. */
function touch<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
}

/**
 * Where plots are, read from a project's plot files and served project file, with what
 * was read kept: the places of each plot file by its checksum (so turning the page of
 * the differences does not read every file again), and the spatial reference system of
 * each served project file.
 */
export class PlotPlaceReader {
  private readonly files = new Map<string, FilePlaces>();
  private cachedPlaces = 0;
  private readonly facts = new Map<string, SurveyFacts>();

  constructor(private readonly store: Store) {}

  /**
   * Where some plots are, as Collect Earth places them (KmlGenerator.getPlotObject): the
   * latitude is the column after the plot's key columns and the longitude the next one,
   * in the survey's first spatial reference system. Only latitude and longitude are
   * read (Collect Earth transforms other systems; for those no place is given). A plot
   * in several files takes the first file listed that gives it a place; a plot in none,
   * or without numeric coordinates, is left out.
   */
  async places(projectId: string, plots: readonly string[], log: FastifyRequest['log']): Promise<PlotPlaces> {
    const wanted = new Set(plots);
    const facts = await this.surveyFacts(projectId, log);
    if (wanted.size === 0) {
      return { places: [], outline: plotOutline(facts.properties) };
    }
    if (!isWgs84(facts.srid)) {
      return { places: [], outline: { kind: 'place' }, unsupportedSrs: facts.srid };
    }
    const [info, files] = await Promise.all([this.store.getRoundInfo(projectId), this.store.listCsvFiles(projectId)]);
    const keyCount = fileKeyCount(info);
    const found = new Map<string, PlotPlace>();
    // A plot file with polygons: Collect Earth draws those, not the survey's shape.
    let polygons = false;
    for (const meta of files) {
      if (found.size === wanted.size) {
        break;
      }
      const file = await this.placesOfFile(projectId, meta.id, meta.checksum, keyCount, log);
      polygons ||= file?.polygons ?? false;
      for (const plot of wanted) {
        const at = found.has(plot) ? undefined : file?.places.get(plot);
        if (at) {
          found.set(plot, { plot, lat: at[0], lon: at[1], name: visibleId(plot, facts.hidden) });
        }
      }
    }
    return { places: [...wanted].flatMap((plot) => found.get(plot) ?? []), outline: plotOutline(facts.properties, polygons) };
  }

  /** What the served project file says of its plots ("" srid, no properties, no keys when it has none or cannot be read). */
  private async surveyFacts(projectId: string, log: FastifyRequest['log']): Promise<SurveyFacts> {
    const none: SurveyFacts = { srid: '', properties: null, hidden: null };
    const info = await this.store.getCepInfo(projectId);
    if (!info) {
      return none;
    }
    const key = `${projectId}\u0000${info.bytes}\u0000${info.updatedAt}`;
    const hit = this.facts.get(key);
    if (hit !== undefined) {
      touch(this.facts, key, hit);
      return hit;
    }
    let facts = none;
    try {
      const cep = await this.store.getCep(projectId);
      if (cep) {
        const files = readCep(cep);
        const idm = new TextDecoder().decode(files.entries.get(files.surveyPath)!);
        facts = { srid: firstSrid(idm), properties: cepProperties(files), hidden: hiddenKeys(idm) };
      }
    } catch (err) {
      log.warn({ err }, 'could not read the plot shape of the project file');
    }
    touch(this.facts, key, facts);
    while (this.facts.size > MAX_CACHED_SRS) {
      this.facts.delete(this.facts.keys().next().value as string);
    }
    return facts;
  }

  /** Every place of one plot file (the first row giving a plot a place wins), or null when it cannot be read. */
  private async placesOfFile(
    projectId: string,
    fileId: string,
    checksum: string,
    keyCount: number,
    log: FastifyRequest['log'],
  ): Promise<FilePlaces | null> {
    const key = `${checksum}\u0000${keyCount}`;
    const hit = this.files.get(key);
    if (hit) {
      touch(this.files, key, hit);
      return hit;
    }
    try {
      const file = await this.store.getCsvFile(projectId, fileId);
      if (!file) {
        return null;
      }
      const places = new Map<string, readonly [number, number]>();
      const rows = plotFileOf(file, keyCount).rows;
      // As Collect Earth: a polygon column in the (first) row means the plots are those polygons.
      const polygons = rows.length > 0 && hasPolygonColumn(rows[0].fields);
      for (const row of rows) {
        if (places.has(row.id)) {
          continue;
        }
        const lat = coordinate(row.fields[keyCount], 90);
        const lon = coordinate(row.fields[keyCount + 1], 180);
        if (lat !== null && lon !== null) {
          places.set(row.id, [lat, lon]);
        }
      }
      const result: FilePlaces = { places, polygons };
      this.keep(key, result);
      return result;
    } catch (err) {
      log.error({ err, csvFileId: fileId }, 'could not read the plot file');
      return null;
    }
  }

  private keep(key: string, file: FilePlaces): void {
    if (file.places.size > MAX_CACHED_PLACES) {
      return;
    }
    this.files.set(key, file);
    this.cachedPlaces += file.places.size;
    while (this.files.size > MAX_CACHED_FILES || this.cachedPlaces > MAX_CACHED_PLACES) {
      const [oldest, entry] = this.files.entries().next().value as [string, FilePlaces];
      this.files.delete(oldest);
      this.cachedPlaces -= entry.places.size;
    }
  }
}

/**
 * Where the plots of the Quality tab's differences and the review queue are (coordinators
 * and reviewers, read-only), so the dashboard can link each to Google Earth and Earth Map: POST { plots: [...] } -> { places: [{ plot, lat, lon }] },
 * with `unsupportedSrs` (and no places) when the survey's coordinates are not latitude
 * and longitude. The plots are units as the quality figures pair them (Difference.plot).
 */
export async function registerPlotPlaceRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const reader = new PlotPlaceReader(store);
  app.post('/v1/projects/:pid/quality/places', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const plots = (request.body as { plots?: unknown } | null)?.plots;
    if (
      !Array.isArray(plots) ||
      plots.length > MAX_PLACES ||
      !plots.every((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= MAX_PLOT)
    ) {
      return reply.code(400).send({ error: 'bad_request', reason: `plots must be a list of at most ${MAX_PLACES} plot ids of 1-${MAX_PLOT} characters` });
    }
    return reply.send(await reader.places(request.membership!.projectId, plots, request.log));
  });
}
