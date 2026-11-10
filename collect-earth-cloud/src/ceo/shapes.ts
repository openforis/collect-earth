// The shapes of a Collect Earth Online project's plots and samples, copied into the project so that it does not depend on
// CEO later. CEO keeps them only for plots and samples uploaded as shapes (FRA's hexagons and their 1 ha central squares),
// and gives them one plot at a time (get-plot-sample-geom?plotId=…, without a login): too many calls for one request, so
// the job is read in steps (POST …/ceo-shapes/step, routes/ceoShapes.ts) that the dashboard asks for while it is open,
// its state kept in the project (projects.ceo_shapes) so that it carries on where it stopped. Once every plot is read,
// each plot file gets a last column, plot_shape: the plot and its samples as one WKT MULTIPOLYGON, which Collect Earth
// draws in place of its own square (PolygonWktGenerator), as CEO draws them.
import { hasPolygonColumn, outlineRing, degreesPerMetre, type PlotOutline } from '../plotShape.js';
import { parsePlotFile } from '../plots.js';
import type { CeoProject } from './project.js';

export const CEO_SHAPES_URL = 'https://app.collect.earth/get-plot-sample-geom?plotId=';
/** The plot file's column of the shapes. */
export const SHAPE_COLUMN = 'plot_shape';
/** Vertices closer than this to the line of their neighbours are dropped (CEO's hexagons come with 385). */
const TOLERANCE_M = 0.5;
const MAX_ANSWER_BYTES = 2 * 1024 * 1024;

export interface CeoShapesJob {
  ceoProjectId: number | null;
  /** plots to read in all */
  total: number;
  /** the plots still to read: [plot id in the plot files, CEO's internal plot id] */
  queue: [string, string][];
  /** plot id -> its shape (WKT) */
  shapes: Record<string, string>;
  /** plots CEO had no shape for: drawn with `fallback` */
  missing: number;
  /** what Collect Earth draws for a plot without a shape (a whole file has shapes or none: it tests its first plot) */
  fallback: PlotOutline;
  state: 'reading' | 'done';
  /** why the last step stopped early (CEO not answering…), null when it did not */
  error: string | null;
  updatedAt: number;
}

/** Whether CEO keeps shapes for this project: plots or samples uploaded as a shapefile or GeoJSON. */
export const ceoHasShapes = (p: CeoProject) => [p.plotDistribution, p.sampleDistribution].some((d) => d === 'shp' || d === 'geojson');

export function newShapesJob(ceoProjectId: number | null, plots: readonly { id: string; internal: string }[], fallback: PlotOutline, now = Date.now()): CeoShapesJob {
  return { ceoProjectId, total: plots.length, queue: plots.map((p) => [p.id, p.internal]), shapes: {}, missing: 0, fallback, state: 'reading', error: null, updatedAt: now };
}

/** What the dashboard shows of a job. */
export const shapesProgress = (job: CeoShapesJob | null) =>
  job === null
    ? { state: 'none' as const }
    : { state: job.state, total: job.total, done: job.total - job.queue.length, missing: job.missing, error: job.error };

type Ring = [number, number][];

/** The rings of a GeoJSON Polygon or MultiPolygon (outer rings only; CEO's have no holes). */
function rings(geojson: unknown): Ring[] {
  let g: unknown = geojson;
  if (typeof g === 'string') {
    try {
      g = JSON.parse(g);
    } catch {
      return [];
    }
  }
  if (typeof g !== 'object' || g === null) return [];
  const { type, coordinates } = g as { type?: unknown; coordinates?: unknown };
  const polygons = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' && Array.isArray(coordinates) ? coordinates : [];
  const out: Ring[] = [];
  for (const polygon of polygons) {
    const outer = Array.isArray(polygon) ? polygon[0] : null;
    if (!Array.isArray(outer)) continue;
    const ring = outer.filter((c): c is [number, number] => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90 && Math.abs(c[0]) <= 180)
      .map((c) => [c[0], c[1]] as [number, number]);
    if (ring.length >= 4) out.push(ring);
  }
  return out;
}

/** The ring with the vertices that lie on the line of their neighbours dropped (Douglas-Peucker, within TOLERANCE_M). */
export function simplifyRing(ring: Ring): Ring {
  const per = degreesPerMetre(ring[0][1]);
  // In metres around the first vertex, so the tolerance is the same east and north
  const m = ring.map(([lon, lat]) => [(lon - ring[0][0]) / per.east, (lat - ring[0][1]) / per.north]);
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  // A closed ring starts and ends on one vertex: split it at the vertex farthest from it
  let far = 0;
  for (let i = 1; i < ring.length - 1; i++) if (Math.hypot(m[i][0], m[i][1]) > Math.hypot(m[far][0], m[far][1])) far = i;
  keep[far] = true;
  const stack: [number, number][] = [[0, far], [far, ring.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    const [ax, ay] = m[a];
    const [bx, by] = m[b];
    const length = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i++) {
      const d = length === 0 ? Math.hypot(m[i][0] - ax, m[i][1] - ay) : Math.abs((bx - ax) * (ay - m[i][1]) - (ax - m[i][0]) * (by - ay)) / length;
      if (d > worst) (worst = d), (at = i);
    }
    if (worst > TOLERANCE_M) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

const wktRing = (ring: Ring) => `((${ring.map(([lon, lat]) => `${Number(lon.toFixed(7))} ${Number(lat.toFixed(7))}`).join(',')}))`;
const wktOf = (all: Ring[]) => `MULTIPOLYGON(${all.map(wktRing).join(',')})`;

/** CEO's answer for one plot as one WKT: the plot's outline, then its samples; null when none of them is a polygon. */
export function shapeOf(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { plotGeom, sampleGeoms } = answer as { plotGeom?: unknown; sampleGeoms?: unknown };
  const all = [...rings(plotGeom), ...(Array.isArray(sampleGeoms) ? sampleGeoms.flatMap(rings) : [])].map(simplifyRing).filter((r) => r.length >= 4);
  return all.length > 0 ? wktOf(all) : null;
}

/** A plot's shape read from CEO: its WKT, null when CEO has none for it (an unknown plot, points only). Throws when CEO does not answer. */
export async function fetchPlotShape(internalId: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(CEO_SHAPES_URL + encodeURIComponent(internalId), { signal, redirect: 'error', headers: { accept: 'application/json' } });
  // CEO answers 403 for a plot it does not have
  if (res.status === 403 || res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_ANSWER_BYTES) return null;
  try {
    return shapeOf(JSON.parse(text));
  } catch {
    return null;
  }
}

const field = (v: string) => `"${v.replace(/"/g, '""')}"`;

/**
 * The plot file with the shapes in a last column (plots without one: `fallback` around their centre); null when it
 * has a polygon column already or no plots. `keyCount`: its key columns (the plot id is the first, CEO's).
 */
export function withShapes(data: Buffer, keyCount: number, shapes: Readonly<Record<string, string>>, fallback: PlotOutline): Buffer | null {
  const file = parsePlotFile(data, keyCount);
  if (file.rows.length === 0 || hasPolygonColumn(file.rows[0].fields)) return null;
  const sep = file.separator;
  const lines: string[] = [];
  if (file.header) lines.push(data.toString('utf8', file.header.start, file.header.end) + sep + SHAPE_COLUMN);
  for (const row of file.rows) {
    let shape: string | undefined = shapes[row.fields[0]?.trim() ?? ''];
    if (!shape) {
      const lat = Number(row.fields[keyCount]);
      const lon = Number(row.fields[keyCount + 1]);
      const ring = Number.isFinite(lat) && Number.isFinite(lon) ? outlineRing(lat, lon, fallback) : null;
      // A plot that cannot be drawn keeps the file without shapes: Collect Earth would misdraw it otherwise
      if (!ring) return null;
      shape = wktOf([ring]);
    }
    lines.push(data.toString('utf8', row.start, row.end) + sep + field(shape));
  }
  return Buffer.concat([file.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(lines.join(file.lineEnding) + file.lineEnding, 'utf8')]);
}
