// The view logic of the plot layout (project/PlotLayout.tsx): which settings a layout shows, as the desktop's settings
// page shows them (SettingsModel), their ranges, and what is wrong or worth saying about a layout. The server checks
// the same (src/plotLayout.ts); the drawing and the areas are shared with the desktop (shared/plotPreview.ts).
import type { PlotLayoutSettings as PlotLayout } from "./api";
import { plotFigures } from "./shared/plotPreview";

export const SAMPLE_SHAPES = [
  "SQUARE", "SQUARE_WITH_LARGE_CENTRAL_PLOT", "CIRCLE", "HEXAGON", "NFI_THREE_CIRCLES", "NFI_FOUR_CIRCLES", "SQUARE_CIRCLE",
  "NFMA", "NFMA_250", "KML_POLYGON", "WKT_POLYGON", "GEOJSON_POLYGON",
] as const;
export const BUFFER_SHAPES = ["NONE", "SQUARE", "CIRCLE", "HEXAGON"] as const;
/** None, the central one, or a square grid of 2 × 2 to 10 × 10 */
export const POINT_COUNTS = [0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100] as const;

export type LayoutKey = keyof PlotLayout;
export type NumberKey = Exclude<LayoutKey, "sample_shape" | "number_of_sampling_points_in_plot" | "buffer_shape">;
/** The whole numbers of the layout, in the order shown, with their range (PlotGeometry) */
export const NUMBER_FIELDS: { key: NumberKey; min: number; max: number }[] = [
  { key: "distance_between_sample_points", min: 2, max: 1000 },
  { key: "distance_to_plot_boundaries", min: 0, max: 500 },
  { key: "inner_point_side", min: 2, max: 100 },
  { key: "large_central_plot_side", min: 2, max: 200 },
  { key: "distance_between_plots", min: 2, max: 1000 },
  { key: "distance_to_buffers", min: 1, max: 10000 },
];

const SQUARE_PLOT = new Set(["SQUARE", "SQUARE_WITH_LARGE_CENTRAL_PLOT"]);
const ROUND_PLOT = new Set(["CIRCLE", "HEXAGON"]);
const NFI_CLUSTER = new Set(["NFI_THREE_CIRCLES", "NFI_FOUR_CIRCLES"]);

/** Whether a setting is shown for this layout, as the desktop's settings page shows it. */
export function isShown(key: LayoutKey, layout: PlotLayout): boolean {
  const shape = layout.sample_shape;
  const points = Number(layout.number_of_sampling_points_in_plot);
  const square = SQUARE_PLOT.has(shape);
  const round = ROUND_PLOT.has(shape);
  const nfi = NFI_CLUSTER.has(shape);
  switch (key) {
    case "sample_shape":
      return true;
    case "number_of_sampling_points_in_plot":
    case "buffer_shape":
      return square || round;
    case "distance_between_sample_points":
      return round || (square && points >= 2) || nfi;
    case "distance_to_plot_boundaries":
      return square;
    case "inner_point_side":
      return ((square || round) && points >= 1) || nfi;
    case "large_central_plot_side":
      return shape === "SQUARE_WITH_LARGE_CENTRAL_PLOT";
    case "distance_between_plots":
      return nfi;
    case "distance_to_buffers":
      return (square || round) && layout.buffer_shape !== "NONE";
    default:
      return false;
  }
}

/** What the distance between points is for this shape: the spacing of a square's points, a radius, a cluster's radius. */
export const distanceMeaning = (shape: string): "square" | "round" | "cluster" => (ROUND_PLOT.has(shape) ? "round" : NFI_CLUSTER.has(shape) ? "cluster" : "square");

/** A whole number within the range, as the field holds it; null when it is not one. */
export function wholeIn(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export interface LayoutCheck {
  /** the number fields shown that hold no number of their range */
  invalid: NumberKey[];
  /** the reference area does not enclose the whole plot: the least distance */
  tooClose: number | null;
  /** the reference area is less than ten times the plot: the distance that makes it so */
  small: number | null;
  /** the plot's and the reference area's areas in hectares (null: not known for this shape, or none) */
  plotHa: number | null;
  referenceHa: number | null;
}

/** What is wrong with a layout (`invalid`, `tooClose`: it cannot be saved) and worth saying about it. */
export function checkLayout(layout: PlotLayout): LayoutCheck {
  const invalid = NUMBER_FIELDS.filter((f) => isShown(f.key, layout) && wholeIn(layout[f.key], f.min, f.max) === null).map((f) => f.key);
  const figures = plotFigures({ ...layout });
  const distance = Number(layout.distance_to_buffers);
  const reference = isShown("distance_to_buffers", layout) && !invalid.includes("distance_to_buffers");
  const tooClose = reference && figures.minimumReferenceDistance !== null && distance < figures.minimumReferenceDistance ? figures.minimumReferenceDistance : null;
  const small = reference && tooClose === null && figures.recommendedReferenceDistance !== null && distance < figures.recommendedReferenceDistance
    ? figures.recommendedReferenceDistance : null;
  return {
    invalid,
    tooClose,
    small,
    plotHa: figures.plotArea === null ? null : figures.plotArea / 10000,
    referenceHa: reference && figures.referenceArea !== null ? figures.referenceArea / 10000 : null,
  };
}

/** Whether two layouts differ in a setting shown (what saving would change). */
export const layoutDiffers = (a: PlotLayout, b: PlotLayout) => (Object.keys(a) as LayoutKey[]).some((k) => isShown(k, a) && a[k] !== b[k]) || a.sample_shape !== b.sample_shape;
