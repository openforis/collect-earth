// The plots of a Collect Earth Online project (docs/plans/2026-11-09-ceo-bridge.md, B3): how Collect Earth draws them
// (plotLayout: project_definition.properties), and where they are (readCeoPlots: the list CEO's pages load,
// get-project-plots, which a coordinator saves as they save the project). The list gives each plot's centre and ids,
// not the shapes uploaded to CEO nor the columns of an uploaded plot file: those come with CEO's own downloads.
import type { DesignedPlot } from '../plotDesign.js';
import { CeoImportError, type CeoProject } from './project.js';
import type { Report } from './report.js';

/** Collect Earth's plot settings (project_definition.properties; KmlGeneratorService reads them). */
export interface PlotLayout {
  shape: 'CIRCLE' | 'SQUARE';
  /** number_of_sampling_points_in_plot */
  points: number;
  /** distance_between_sample_points: the circle's radius, or the square's spacing between points */
  distance: number;
  /** distance_to_plot_boundaries: from the outer points to the square's edge (unused by a circle) */
  boundary: number;
  /** inner_point_side: the side of each sample point's square, in metres */
  pointSide: number;
}

/** The plot side Collect Earth uses when CEO's plots are uploaded shapes (CEO gives no size for them). */
export const DEFAULT_SIDE_M = 100;
/** The sample point's side when CEO gives no sample spacing (as Collect Earth's demo project). */
const DEFAULT_POINT_SIDE_M = 2;

const metres = (n: number) => `${Number(n.toFixed(2))} m`;

/**
 * CEO's plot shape, size (a circle's diameter, a square's side) and samples as Collect Earth's settings. Collect
 * Earth draws a square's samples on a grid of n × n points and a circle's at its centre and at random: what CEO
 * laid out otherwise is drawn the nearest way, and said. The samples only guide the eye: each question is answered
 * once for the plot.
 */
export function plotLayout(project: CeoProject, report: Report): PlotLayout {
  const shape = project.plotShape === 'circle' ? 'CIRCLE' : 'SQUARE';
  const samples = Math.max(1, Math.round(project.samplesPerPlot ?? 1));
  const distribution = project.sampleDistribution ?? '';
  let size = project.plotSize !== null && project.plotSize > 0 ? project.plotSize : null;
  const shapes = project.plotDistribution === 'shp' || project.plotDistribution === 'geojson';
  if (size === null || shapes) {
    size ??= DEFAULT_SIDE_M;
    report.add('plots', 'Plot size', 'changed',
      `CEO's plots are shapes uploaded to it (${project.plotDistribution === 'shp' ? 'a shapefile' : project.plotDistribution === 'geojson' ? 'GeoJSON' : 'a file'}), which its plot list does not include: Collect Earth draws each as a ${shape === 'CIRCLE' ? 'circle' : 'square'} of ${metres(size)} around its centre.`);
  }
  const resolution = project.sampleResolution !== null && project.sampleResolution > 0 ? project.sampleResolution : null;
  const pointSide = resolution !== null ? Math.min(DEFAULT_POINT_SIDE_M, resolution / 2) : DEFAULT_POINT_SIDE_M;

  if (shape === 'CIRCLE') {
    // CircleKmlGenerator: the first point at the centre, the others at random within the radius.
    if (samples > 1 && distribution !== 'random') {
      report.add('plots', 'Sample points', 'changed', `CEO laid out ${samples} samples ${samplesWord(distribution)}; in a round plot Collect Earth puts the first at the centre and the others at random.`);
    }
    report.add('plots', 'Plot shape', 'imported', `A circle of ${metres(size)} across, with ${samples} sample point${samples === 1 ? '' : 's'}.`);
    return { shape, points: samples, distance: size / 2, boundary: 0, pointSide };
  }

  // SquareKmlGenerator: n × n points `distance` apart, `boundary` from the outer ones to the edge.
  const n = Math.max(1, Math.round(Math.sqrt(samples)));
  const points = n * n;
  if (points !== samples || (samples > 1 && distribution !== 'gridded')) {
    report.add('plots', 'Sample points', 'changed',
      `CEO laid out ${samples} samples ${samplesWord(distribution)}; Collect Earth draws a square plot's samples on a grid: ${n} × ${n}.`);
  }
  report.add('plots', 'Plot shape', 'imported', `A square of ${metres(size)} a side, with ${points} sample point${points === 1 ? '' : 's'}.`);
  if (n === 1) return { shape, points, distance: 0, boundary: size / 2, pointSide };
  // CEO's grid reaches the plot's edge (36 samples 20 m apart fill a 100 m square): a boundary of 0 is its layout
  if (distribution === 'gridded' && resolution !== null && resolution * (n - 1) <= size) {
    return { shape, points, distance: resolution, boundary: (size - resolution * (n - 1)) / 2, pointSide };
  }
  const spacing = size / n;
  return { shape, points, distance: spacing, boundary: spacing / 2, pointSide: Math.min(pointSide, spacing / 2) };
}

const samplesWord = (distribution: string) =>
  distribution === 'gridded' ? 'on a grid' : distribution === 'random' ? 'at random' : distribution === 'center' ? 'at the centre' : `from a file (${distribution || 'unknown'})`;

/** The properties of the layout, as project_definition.properties lines (numbers without needless decimals). */
export function layoutProperties(l: PlotLayout): string[] {
  const n = (x: number) => String(Number(x.toFixed(3)));
  return [
    `sample_shape=${l.shape}`,
    `number_of_sampling_points_in_plot=${l.points}`,
    `distance_between_sample_points=${n(l.distance)}`,
    `distance_to_plot_boundaries=${n(l.boundary)}`,
    // Collect Earth reads the side as a whole number (KmlGeneratorService.parseInt): at least 1 m
    `inner_point_side=${Math.max(1, Math.round(l.pointSide))}`,
  ];
}

export interface CeoPlots {
  plots: (DesignedPlot & { id: string })[];
  /** which CEO number became the plot id: CEO's plot id as its people saw it, or its internal one */
  ids: 'visible' | 'internal';
  analyzed: number;
  flagged: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const idText = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '');

/** A plot's centre: CEO gives a GeoJSON point, as text or as an object. */
function centreOf(v: unknown): [number, number] | null {
  let point: unknown = v;
  if (typeof v === 'string') {
    try {
      point = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!isObject(point) || !Array.isArray(point.coordinates)) return null;
  const [lon, lat] = point.coordinates;
  if (typeof lon !== 'number' || typeof lat !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

/** Degrees a plot may lie outside the project's boundary box (its centre near the edge, rounding). */
const BOUNDS_MARGIN = 0.05;

/**
 * The plot list saved from CEO (get-project-plots?projectId=…), checked against the project: its plots are
 * kept with CEO's plot id (the one its collectors saw; its internal one when those repeat). Throws CeoImportError
 * for a file that is no plot list, or one whose plots are not in the project's area (another project's).
 */
export function readCeoPlots(json: string, project: CeoProject, report: Report): CeoPlots {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new CeoImportError('The plots file is not JSON: save the page CEO shows at get-project-plots?projectId=… as it is.');
  }
  if (!Array.isArray(raw) || raw.some((p) => !isObject(p) || !('center' in p))) {
    throw new CeoImportError('The plots file is not a Collect Earth Online plot list: save the page CEO shows at get-project-plots?projectId=….');
  }
  const read: { visible: string; internal: string; lon: number; lat: number; analyzed: boolean; flagged: boolean }[] = [];
  let unplaced = 0;
  for (const p of raw as Record<string, unknown>[]) {
    const centre = centreOf(p.center);
    const visible = idText(p.id);
    const internal = idText(p.plotId);
    if (!centre || (visible === '' && internal === '')) {
      unplaced++;
      continue;
    }
    read.push({ visible, internal, lon: centre[0], lat: centre[1], analyzed: p.status === 'analyzed', flagged: p.flagged === true });
  }
  if (read.length === 0) throw new CeoImportError('The plots file has no plot with a place and an id.');
  if (unplaced > 0) report.add('plots', 'Plots without a place', 'skipped', `${unplaced} plot(s) of the list have no centre or no id, and are left out.`);

  if (project.bounds) {
    const [w, s, e, n] = project.bounds;
    const outside = read.filter((p) => p.lon < w - BOUNDS_MARGIN || p.lon > e + BOUNDS_MARGIN || p.lat < s - BOUNDS_MARGIN || p.lat > n + BOUNDS_MARGIN).length;
    if (outside > read.length / 2) {
      throw new CeoImportError(
        `Most plots of the plots file (${outside} of ${read.length}) are outside this project's area: it seems to be another project's. Save get-project-plots with the same projectId as the project.`,
      );
    }
    if (outside > 0) report.add('plots', "Plots outside the project's area", 'info', `${outside} plot(s) lie outside the area of the CEO project; they are kept.`);
  }

  // CEO's plot id as its people saw it (the id of an uploaded plot file), unless missing or repeated
  const unique = (ids: string[]) => ids.every((x) => x !== '') && new Set(ids).size === ids.length;
  let ids: CeoPlots['ids'] = 'visible';
  if (!unique(read.map((p) => p.visible))) {
    if (!unique(read.map((p) => p.internal))) throw new CeoImportError('The plots of the plots file have no ids that tell them apart.');
    ids = 'internal';
    report.add('plots', 'Plot ids', 'changed', "CEO's plot ids repeat or are missing, so each plot takes CEO's internal number as its id.");
  }
  const plots = read.map((p) => ({ id: ids === 'visible' ? p.visible : p.internal, lon: p.lon, lat: p.lat }));
  const analyzed = read.filter((p) => p.analyzed).length;
  const flagged = read.filter((p) => p.flagged).length;

  report.add('plots', 'Plots', 'imported', `${plots.length} plots, each with ${ids === 'visible' ? "the id it had in CEO" : "CEO's internal number as its id"}.`);
  if (project.numPlots !== null && project.numPlots !== read.length + unplaced) {
    report.add('plots', 'Plot count', 'info', `The CEO project says it has ${project.numPlots} plots; the plots file has ${read.length + unplaced}.`);
  }
  if (analyzed > 0 || flagged > 0) {
    report.add('plots', 'Plots done in CEO', 'info',
      `${analyzed} plot(s) were answered in CEO and ${flagged} flagged. Here every plot starts as new: the answers collected in CEO are not brought over.`);
  }
  return { plots, ids, analyzed, flagged };
}
