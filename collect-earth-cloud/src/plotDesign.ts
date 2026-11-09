// Plot design (as Collect Earth Online's): plots laid out over an area of interest (a GeoJSON file,
// or a zipped shapefile of polygons) at random, on a systematic grid, or at random within strata,
// written as a plot file in the format the plot-file upload takes. Nothing leaves the server: no
// elevation lookup, so elevation, slope and aspect are 0.
import { CepError, readZip } from './cep.js';
import { prng } from './division.js';
import { degreesPerMetre } from './plotShape.js';
import { readDbf, readShpPolygons, signedArea2 } from './shapefile.js';

/** Most plots one design may make. */
export const MAX_DESIGN_PLOTS = 50_000;
/** Most points a grid may try (a thin area across a wide box), and the vertices an area may have. */
const MAX_GRID_CANDIDATES = 5_000_000;
const MAX_VERTICES = 2_000_000;
const EARTH_RADIUS_M = 6378137;

/** Why an area or a design cannot be used, in words for the coordinator. */
export class DesignError extends Error {
  constructor(
    public code: 'bad_area' | 'too_many',
    message: string,
  ) {
    super(message);
  }
}

/** One feature of the area: its rings ([lon, lat], closed) and whether each adds (+1) or cuts out (-1, a hole). */
export interface AreaFeature {
  rings: [number, number][][];
  signs: number[];
  attributes: Record<string, string>;
}

export interface AreaOfInterest {
  features: AreaFeature[];
  /** The attribute names, in the order first met. */
  fields: string[];
}

export type Design =
  | { method: 'random'; count: number }
  | { method: 'grid'; spacingMeters: number; randomOffset: boolean }
  | { method: 'stratified'; field: string; allocation: 'equal' | 'proportional'; count: number };

export interface DesignedPlot {
  lon: number;
  lat: number;
  stratum?: string;
}

const bad = (message: string) => new DesignError('bad_area', message);

/** A ring checked and closed: at least three distinct corners, every point a longitude and latitude. */
function ringOf(points: unknown): [number, number][] {
  if (!Array.isArray(points)) throw bad('A polygon ring is not a list of points.');
  const ring = points.map((p): [number, number] => {
    const [x, y] = Array.isArray(p) ? p : [];
    if (typeof x !== 'number' || typeof y !== 'number' || !(Math.abs(x) <= 180) || !(Math.abs(y) <= 90)) {
      throw bad('The area has coordinates that are not longitude and latitude (WGS84). Save it in WGS84 (EPSG:4326) and try again.');
    }
    return [x, y];
  });
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
  if (ring.length < 4) throw bad('A polygon of the area has fewer than three corners.');
  return ring;
}

function attributeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
}

function withFields(features: AreaFeature[]): AreaOfInterest {
  if (features.length === 0) throw bad('The file has no polygons.');
  if (features.reduce((n, f) => n + f.rings.reduce((m, r) => m + r.length, 0), 0) > MAX_VERTICES) {
    throw bad(`The area has more than ${MAX_VERTICES.toLocaleString('en')} points. Simplify it and try again.`);
  }
  return { features, fields: [...new Set(features.flatMap((f) => Object.keys(f.attributes)))] };
}

/** The polygons of a GeoJSON text (a FeatureCollection, a Feature or a geometry); points and lines are left out. */
export function areaFromGeoJson(text: string): AreaOfInterest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw bad('The file is not GeoJSON: it cannot be read as JSON.');
  }
  const features: AreaFeature[] = [];
  const add = (geometry: unknown, properties: unknown) => {
    const g = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown } | null;
    const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : null;
    if (g?.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      for (const part of g.geometries) add(part, properties);
      return;
    }
    if (!polygons) return;
    const rings: [number, number][][] = [];
    const signs: number[] = [];
    for (const polygon of polygons) {
      if (!Array.isArray(polygon)) throw bad('A polygon of the area is not a list of rings.');
      polygon.forEach((ring, i) => {
        rings.push(ringOf(ring));
        signs.push(i === 0 ? 1 : -1);
      });
    }
    const attributes = Object.fromEntries(Object.entries((properties ?? {}) as Record<string, unknown>).map(([k, v]) => [k, attributeText(v)]));
    if (rings.length > 0) features.push({ rings, signs, attributes });
  };
  const root = json as { type?: unknown; features?: unknown; geometry?: unknown; properties?: unknown } | null;
  if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const f of root.features as { geometry?: unknown; properties?: unknown }[]) add(f?.geometry, f?.properties);
  } else if (root?.type === 'Feature') {
    add(root.geometry, root.properties);
  } else {
    add(root, {});
  }
  return withFields(features);
}

/** The polygons of a zipped shapefile (its first .shp, with the .dbf of the same name for the attributes). */
export function areaFromShapefileZip(zip: Uint8Array): AreaOfInterest {
  let files: Map<string, Uint8Array>;
  try {
    files = readZip(zip);
  } catch (err) {
    if (err instanceof CepError) throw bad('The file is not a zip that the server can read.');
    throw err;
  }
  const names = [...files.keys()].filter((n) => !n.startsWith('__MACOSX/') && !/(^|\/)\._/.test(n));
  const shpName = names.filter((n) => /\.shp$/i.test(n)).sort()[0];
  if (!shpName) throw bad('The zip holds no shapefile (.shp).');
  const base = shpName.slice(0, -4).toLowerCase();
  const sibling = (ext: string) => {
    const name = names.find((n) => n.toLowerCase() === `${base}.${ext}`);
    return name ? Buffer.from(files.get(name)!) : null;
  };
  const prj = sibling('prj')?.toString('latin1') ?? '';
  if (/PROJCS/i.test(prj)) throw bad('The shapefile is in a projected coordinate system. Save it in WGS84 (EPSG:4326) and try again.');
  let shapes: ([number, number][][] | null)[];
  let table: { fields: string[]; records: string[][] } = { fields: [], records: [] };
  try {
    shapes = readShpPolygons(Buffer.from(files.get(shpName)!));
    const dbf = sibling('dbf');
    if (dbf) table = readDbf(dbf);
  } catch (err) {
    throw bad(`The shapefile cannot be read: ${(err as Error).message}.`);
  }
  const features: AreaFeature[] = [];
  shapes.forEach((shape, i) => {
    if (!shape || shape.length === 0) return;
    const rings = shape.map(ringOf);
    // The shapefile's rule: outer rings clockwise, holes counterclockwise.
    const signs = rings.map((r) => (signedArea2(r) < 0 ? 1 : -1));
    const record = table.records[i] ?? [];
    features.push({ rings, signs, attributes: Object.fromEntries(table.fields.map((f, j) => [f, record[j] ?? ''])) });
  });
  return withFields(features);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** A ring's area on the sphere, in m² (the method of ol/sphere's getArea). */
function ringAreaM2(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function featureAreaM2(f: AreaFeature): number {
  return Math.max(0, f.rings.reduce((sum, ring, i) => sum + f.signs[i] * ringAreaM2(ring), 0));
}

/** The box around boxes (a loop: spreading millions of values into Math.min overflows the stack). */
function boxOf(boxes: readonly (readonly [number, number, number, number])[]): [number, number, number, number] {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [a, b, c, d] of boxes) {
    box[0] = Math.min(box[0], a);
    box[1] = Math.min(box[1], b);
    box[2] = Math.max(box[2], c);
    box[3] = Math.max(box[3], d);
  }
  return box;
}

/** Bands of latitude a shape's edges are filed in, so a point is tested against the few edges at its latitude. */
const BANDS = 512;

/**
 * One feature, for "is this point inside": even-odd over all its rings, so holes and the parts of a
 * multipolygon need no grouping. shortcut: longitudes are taken as they are, so an area across the
 * antimeridian (±180°) is read wrongly; split such an area in two to use it.
 */
class Shape {
  readonly box: [number, number, number, number];
  private readonly edges: Float64Array;
  private readonly bands: Int32Array[];

  constructor(feature: AreaFeature) {
    this.box = boxOf(feature.rings.flat().map(([x, y]): [number, number, number, number] => [x, y, x, y]));
    const edges: number[] = [];
    for (const ring of feature.rings) for (let i = 0; i + 1 < ring.length; i++) edges.push(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
    this.edges = Float64Array.from(edges);
    const lists: number[][] = Array.from({ length: BANDS }, () => []);
    for (let e = 0; e < this.edges.length; e += 4) {
      const [lo, hi] = [this.band(Math.min(this.edges[e + 1], this.edges[e + 3])), this.band(Math.max(this.edges[e + 1], this.edges[e + 3]))];
      for (let b = lo; b <= hi; b++) lists[b].push(e);
    }
    this.bands = lists.map((l) => Int32Array.from(l));
  }

  private band(y: number): number {
    const [, minY, , maxY] = this.box;
    return maxY > minY ? Math.min(BANDS - 1, Math.max(0, Math.floor(((y - minY) / (maxY - minY)) * BANDS))) : 0;
  }

  contains(x: number, y: number): boolean {
    const [minX, minY, maxX, maxY] = this.box;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const e = this.edges;
    let inside = false;
    for (const i of this.bands[this.band(y)]) {
      const y1 = e[i + 1];
      const y2 = e[i + 3];
      if (y1 > y !== y2 > y && x < e[i] + ((y - y1) * (e[i + 2] - e[i])) / (y2 - y1)) inside = !inside;
    }
    return inside;
  }
}

/**
 * `n` points uniformly at random over the union of the shapes: a shape drawn by the area of its box
 * on the sphere, a point uniform in that box (longitude, and the sine of the latitude), kept when the
 * shape is the first that holds it (so overlaps are not drawn twice as often).
 */
function randomPoints(shapes: readonly Shape[], n: number, random: () => number): [number, number][] {
  const weights = shapes.map(({ box: [minX, minY, maxX, maxY] }) => (maxX - minX) * (Math.sin(rad(maxY)) - Math.sin(rad(minY))));
  const total = weights.reduce((a, b) => a + b, 0);
  const out: [number, number][] = [];
  const maxTries = 2_000_000 + 200 * n;
  for (let tries = 0; out.length < n; tries++) {
    if (tries > maxTries || !(total > 0)) throw bad('The area is too small for its extent to place the plots in it.');
    let r = random() * total;
    let i = 0;
    while (i < shapes.length - 1 && r >= weights[i]) r -= weights[i++];
    const [minX, minY, maxX, maxY] = shapes[i].box;
    const x = minX + random() * (maxX - minX);
    const s0 = Math.sin(rad(minY));
    const y = (Math.asin(s0 + random() * (Math.sin(rad(maxY)) - s0)) * 180) / Math.PI;
    if (shapes[i].contains(x, y) && !shapes.slice(0, i).some((s) => s.contains(x, y))) out.push([x, y]);
  }
  return out;
}

/** The points of a grid `spacing` metres apart (rows south to north, west to east) inside any shape; null over `limit`. */
function gridPoints(shapes: readonly Shape[], spacing: number, offset: [number, number], limit: number): [number, number][] | null {
  const [minX, minY, maxX, maxY] = boxOf(shapes.map((s) => s.box));
  const widest = minY <= 0 && maxY >= 0 ? 0 : Math.min(Math.abs(minY), Math.abs(maxY));
  const candidates = ((maxX - minX) / degreesPerMetre(widest).east / spacing) * ((maxY - minY) / degreesPerMetre((minY + maxY) / 2).north / spacing);
  if (candidates > MAX_GRID_CANDIDATES) return null;
  const out: [number, number][] = [];
  for (let y = minY + offset[1] * spacing * degreesPerMetre(minY).north; y <= maxY; y += spacing * degreesPerMetre(y).north) {
    const dx = spacing * degreesPerMetre(y).east;
    for (let x = minX + offset[0] * dx; x <= maxX; x += dx) {
      if (shapes.some((s) => s.contains(x, y))) {
        out.push([x, y]);
        if (out.length > limit) return null;
      }
    }
  }
  return out;
}

export interface Stratum {
  value: string;
  areaKm2: number;
  plots: number;
}

/** The strata of `field` (by value, numbers in order) with their areas and the plots each gets. */
function strataOf(area: AreaOfInterest, design: Extract<Design, { method: 'stratified' }>): { stratum: Stratum; features: AreaFeature[] }[] {
  const byValue = new Map<string, AreaFeature[]>();
  for (const f of area.features) {
    const v = f.attributes[design.field] ?? '';
    byValue.set(v, [...(byValue.get(v) ?? []), f]);
  }
  const strata = [...byValue.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([value, features]) => ({ value, features, areaM2: features.reduce((s, f) => s + featureAreaM2(f), 0) }));
  let plots = strata.map(() => design.count);
  if (design.allocation === 'proportional') {
    // Largest remainder: the counts add up to `count`, the larger remainders (then the earlier strata) taking the extra ones.
    const total = strata.reduce((s, x) => s + x.areaM2, 0);
    const exact = strata.map((s) => (total > 0 ? (design.count * s.areaM2) / total : 0));
    plots = exact.map(Math.floor);
    const left = design.count - plots.reduce((a, b) => a + b, 0);
    exact
      .map((e, i) => ({ i, r: e - Math.floor(e) }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .slice(0, left)
      .forEach(({ i }) => (plots[i] += 1));
  }
  return strata.map((s, i) => ({ stratum: { value: s.value, areaKm2: s.areaM2 / 1e6, plots: plots[i] }, features: s.features }));
}

export interface DesignPlan {
  /** The plots the design makes (for a grid over the limit, about how many it would). */
  plots: number;
  tooMany: boolean;
  strata: Stratum[] | null;
}

/** The plots of a design, laid out with `seed` (the same area, design and seed give the same plots). Throws DesignError. */
export function designPlots(area: AreaOfInterest, design: Design, seed: number, limit = MAX_DESIGN_PLOTS): DesignedPlot[] {
  const random = prng(seed);
  if (design.method === 'random') {
    return randomPoints(area.features.map((f) => new Shape(f)), design.count, random).map(([lon, lat]) => ({ lon, lat }));
  }
  if (design.method === 'grid') {
    const offset: [number, number] = design.randomOffset ? [random(), random()] : [0.5, 0.5];
    const points = gridPoints(area.features.map((f) => new Shape(f)), design.spacingMeters, offset, limit);
    if (!points) throw new DesignError('too_many', `The grid makes more than ${limit.toLocaleString('en')} plots. Make the spacing larger.`);
    return points.map(([lon, lat]) => ({ lon, lat }));
  }
  const strata = strataOf(area, design);
  if (strata.reduce((s, x) => s + x.stratum.plots, 0) > limit) throw new DesignError('too_many', `The design makes more than ${limit.toLocaleString('en')} plots.`);
  return strata.flatMap(({ stratum, features }) =>
    randomPoints(features.map((f) => new Shape(f)), stratum.plots, random).map(([lon, lat]) => ({ lon, lat, stratum: stratum.value })),
  );
}

/** How many plots a design makes, before it is made (a grid is laid out to count them). */
export function planDesign(area: AreaOfInterest, design: Design, seed: number, limit = MAX_DESIGN_PLOTS): DesignPlan {
  if (design.method === 'random') return { plots: design.count, tooMany: design.count > limit, strata: null };
  if (design.method === 'stratified') {
    const strata = strataOf(area, design).map((s) => s.stratum);
    const plots = strata.reduce((s, x) => s + x.plots, 0);
    return { plots, tooMany: plots > limit, strata };
  }
  try {
    return { plots: designPlots(area, design, seed, limit).length, tooMany: false, strata: null };
  } catch (err) {
    if (!(err instanceof DesignError) || err.code !== 'too_many') throw err;
    const areaM2 = area.features.reduce((s, f) => s + featureAreaM2(f), 0);
    return { plots: Math.round(areaM2 / design.spacingMeters ** 2), tooMany: true, strata: null };
  }
}

/** A field of the plot file: quoted when it holds the separator, a quote or a line break. */
const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The plot file of the plots, as the upload reads it (plots.ts): the key columns (the id, 1, 2...
 * and the survey's own round key with its first-round code), then latitude and longitude, elevation,
 * slope and aspect (0), and the stratum when the design has strata.
 */
export function plotFileCsv(plots: readonly DesignedPlot[], keys: { count: number; roundIndex: number | null; roundCode: string }): string {
  const stratified = plots.some((p) => p.stratum !== undefined);
  const keyNames = Array.from({ length: keys.count }, (_, i) => (i === keys.roundIndex ? 'round' : 'id'));
  const header = [...keyNames, 'YCoordinate', 'XCoordinate', 'elevation', 'slope', 'aspect', ...(stratified ? ['stratum'] : [])];
  const lines = plots.map((p, n) => [
    ...keyNames.map((k) => (k === 'round' ? keys.roundCode : String(n + 1))),
    p.lat.toFixed(6),
    p.lon.toFixed(6),
    '0',
    '0',
    '0',
    ...(stratified ? [field(p.stratum ?? '')] : []),
  ]);
  return [header, ...lines].map((l) => l.join(',')).join('\n') + '\n';
}
