import type { Values } from "./settings";

/**
 * What the preview of the plot settings draws, in metres from the centre of the plot, from the values alone: the
 * outline, the sample points, the central plot and the reference area, laid out as the KML generators lay them out.
 * The figures (areas, minimum distance) are not computed here: they come from the server with each validation.
 */

export type Outline = { kind: "square"; half: number } | { kind: "circle"; r: number } | { kind: "hexagon"; r: number };

export interface Dot { x: number; y: number; side: number }

export interface PlotDrawing {
  outline: Outline;
  /** The sample points, as squares of `side` centred on (x, y) */
  points: Dot[];
  /** How many points the generator places at random, which are not drawn (round plots) */
  randomPoints: number;
  /** The large central plot of SQUARE_WITH_LARGE_CENTRAL_PLOT */
  centralPlot: { half: number } | null;
  /** The other plots of an NFI cluster, as circles at (x, y) with their central dot */
  clusterPlots: { x: number; y: number; r: number }[];
  reference: Outline | null;
  /** Half the width the drawing needs, with a little room around */
  extent: number;
}

/** The margin CircleKmlGenerator draws beyond the radius of a round plot */
export const CIRCLE_PLOT_MARGIN = 5;

const int = (values: Values, key: string, fallback: number, min: number, max: number) => {
  const n = parseInt((values[key] ?? "").trim(), 10);
  return Math.max(min, Math.min(max, Number.isNaN(n) ? fallback : n));
};

const SQUARE_SHAPES = new Set(["SQUARE", "SQUARE_WITH_LARGE_CENTRAL_PLOT"]);
const ROUND_SHAPES = new Set(["CIRCLE", "HEXAGON"]);
const NFI_SHAPES = new Set(["NFI_THREE_CIRCLES", "NFI_FOUR_CIRCLES"]);

/** A grid of √n × √n squares of `side`, `distance` apart, centred on the origin (SquareKmlGenerator). */
export function gridPoints(n: number, distance: number, side: number): Dot[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0, side }];
  const rows = Math.round(Math.sqrt(n));
  const start = -((rows - 1) * distance) / 2;
  const points: Dot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < rows; col++) points.push({ x: start + col * distance, y: start + row * distance, side });
  }
  return points;
}

/** The drawing for these values, or null for a shape that is read from the file (polygons, NFMA). */
export function plotDrawing(values: Values): PlotDrawing | null {
  const shape = (values.sample_shape ?? "SQUARE").trim().toUpperCase() || "SQUARE";
  const bufferShape = (values.buffer_shape ?? "").trim().toUpperCase();
  const points = int(values, "number_of_sampling_points_in_plot", 0, 0, 100);
  const distance = int(values, "distance_between_sample_points", 10, 2, 1000);
  const margin = int(values, "distance_to_plot_boundaries", 0, 0, 500);
  const side = int(values, "inner_point_side", 2, 2, 100);
  const referenceDistance = int(values, "distance_to_buffers", 100, 1, 10000);
  const reference = (): Outline | null => {
    if (bufferShape === "CIRCLE") return { kind: "circle", r: referenceDistance };
    if (bufferShape === "HEXAGON") return { kind: "hexagon", r: referenceDistance };
    if (bufferShape === "SQUARE") return { kind: "square", half: referenceDistance };
    return null;
  };
  const withExtent = (drawing: Omit<PlotDrawing, "extent">, plotExtent: number): PlotDrawing => {
    const ref = drawing.reference;
    const refExtent = ref ? (ref.kind === "square" ? ref.half : ref.r) : 0;
    return { ...drawing, extent: Math.max(plotExtent, refExtent) * 1.1 };
  };

  if (SQUARE_SHAPES.has(shape)) {
    const half = points <= 1 ? margin : margin + ((Math.sqrt(points) - 1) * distance) / 2;
    const centralSide = int(values, "large_central_plot_side", 20, 2, 200);
    return withExtent({
      outline: { kind: "square", half },
      points: gridPoints(points, distance, side),
      randomPoints: 0,
      centralPlot: shape === "SQUARE_WITH_LARGE_CENTRAL_PLOT" ? { half: centralSide / 2 } : null,
      clusterPlots: [],
      reference: reference(),
    }, half);
  }
  if (ROUND_SHAPES.has(shape)) {
    const r = distance + CIRCLE_PLOT_MARGIN;
    return withExtent({
      outline: shape === "CIRCLE" ? { kind: "circle", r } : { kind: "hexagon", r },
      // The central point; the others are placed at random by CircleKmlGenerator
      points: points >= 1 ? [{ x: 0, y: 0, side }] : [],
      randomPoints: Math.max(0, points - 1),
      centralPlot: null,
      clusterPlots: [],
      reference: reference(),
    }, r);
  }
  if (NFI_SHAPES.has(shape)) {
    // NfiCirclesKmlGenerator: the plots of the cluster at the centre, east and north, and north-east for four
    const between = int(values, "distance_between_plots", 100, 2, 1000);
    const offset = 2 * distance + between;
    const plots = [{ x: 0, y: 0 }, { x: offset, y: 0 }, { x: 0, y: offset }];
    if (shape === "NFI_FOUR_CIRCLES") plots.push({ x: offset, y: offset });
    return withExtent({
      outline: { kind: "circle", r: distance },
      points: plots.map((p) => ({ ...p, side })),
      randomPoints: 0,
      centralPlot: null,
      clusterPlots: plots.slice(1).map((p) => ({ ...p, r: distance })),
      reference: null,
    }, offset + distance);
  }
  return null;
}

/** The corners of a regular hexagon of circumradius r centred on (cx, cy), a vertex to the east, for an SVG points attribute. */
export function hexagonPoints(cx: number, cy: number, r: number): string {
  const corners: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    corners.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return corners.join(" ");
}

/** A round length for the scale bar: 1, 2 or 5 times a power of ten, at most a third of the extent. */
export function scaleBarLength(extent: number): number {
  const target = (extent * 2) / 3;
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  for (const step of [5, 2, 1]) {
    if (step * power <= target) return step * power;
  }
  return power;
}
