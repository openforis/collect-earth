// The Project file tab's plot layout card: the settings of Collect Earth's Settings > Plot section
// (SettingsModel.plot() in the desktop), which fields show for a shape, their labels, their rules and
// what to send. The server checks the same rules (src/plotLayout.ts).
import type { MessageKey } from "../i18n";

export type PlotLayoutValues = Record<string, string>;

export const SAMPLE_SHAPES = [
  "SQUARE", "SQUARE_WITH_LARGE_CENTRAL_PLOT", "CIRCLE", "HEXAGON", "NFI_THREE_CIRCLES", "NFI_FOUR_CIRCLES",
  "SQUARE_CIRCLE", "NFMA", "NFMA_250", "KML_POLYGON", "WKT_POLYGON", "GEOJSON_POLYGON",
] as const;
export const BUFFER_SHAPES = ["NONE", "SQUARE", "CIRCLE", "HEXAGON"] as const;
/** None, the central point, then 2×2 to 10×10. */
export const POINT_COUNTS = ["0", "1", ...Array.from({ length: 9 }, (_, i) => String((i + 2) ** 2))];

export interface NumberField {
  key: string;
  min: number;
  max: number;
  fallback: number;
  /** Saved blank while hidden, as Collect Earth does (its generators draw by it whatever the shape). */
  blankWhenHidden?: boolean;
}

export const NUMBER_FIELDS: NumberField[] = [
  { key: "distance_between_sample_points", min: 2, max: 1000, fallback: 10, blankWhenHidden: true },
  { key: "distance_to_plot_boundaries", min: 0, max: 500, fallback: 0 },
  { key: "inner_point_side", min: 2, max: 100, fallback: 2 },
  { key: "large_central_plot_side", min: 2, max: 200, fallback: 20, blankWhenHidden: true },
  { key: "distance_between_plots", min: 2, max: 1000, fallback: 100 },
  { key: "distance_to_buffers", min: 1, max: 10000, fallback: 100 },
];

const SQUARE = ["SQUARE", "SQUARE_WITH_LARGE_CENTRAL_PLOT"];
const ROUND = ["CIRCLE", "HEXAGON"];
const NFI = ["NFI_THREE_CIRCLES", "NFI_FOUR_CIRCLES"];

const whole = (text: string | undefined): number | null => (/^\s*\d+\s*$/.test(text ?? "") ? Number(text) : null);

/** The values as Collect Earth's settings show them: a known shape, a point count of the list, numbers within range. */
export function shownLayout(stored: PlotLayoutValues): PlotLayoutValues {
  const shape = (stored.sample_shape ?? "").trim().toUpperCase();
  const buffer = (stored.buffer_shape ?? "").trim().toUpperCase();
  const points = (stored.number_of_sampling_points_in_plot ?? "").trim();
  const values: PlotLayoutValues = {
    sample_shape: (SAMPLE_SHAPES as readonly string[]).includes(shape) ? shape : "SQUARE",
    number_of_sampling_points_in_plot: POINT_COUNTS.includes(points) ? points : "25",
    // Projects older than the setting have no shape: a square one when they have a distance (PlotGeometry.bufferShapeOf)
    buffer_shape: (BUFFER_SHAPES as readonly string[]).includes(buffer) ? buffer : (stored.distance_to_buffers ?? "").trim() ? "SQUARE" : "NONE",
  };
  for (const f of NUMBER_FIELDS) {
    // A file edited by hand may hold several reference distances: the first is edited
    const n = whole((stored[f.key] ?? "").split(",")[0]);
    values[f.key] = String(n === null ? f.fallback : Math.max(f.min, Math.min(f.max, n)));
  }
  return values;
}

/** Whether a field shows for these values (SettingsModel's visibleWhen). */
export function isShown(key: string, v: PlotLayoutValues): boolean {
  const shape = v.sample_shape;
  const squareOrRound = SQUARE.includes(shape) || ROUND.includes(shape);
  const points = Number(v.number_of_sampling_points_in_plot);
  switch (key) {
    case "number_of_sampling_points_in_plot":
    case "buffer_shape":
      return squareOrRound;
    case "distance_between_sample_points":
      return ROUND.includes(shape) || (SQUARE.includes(shape) && points >= 2) || NFI.includes(shape);
    case "distance_to_plot_boundaries":
      return SQUARE.includes(shape);
    case "inner_point_side":
      return (squareOrRound && points >= 1) || NFI.includes(shape);
    case "large_central_plot_side":
      return shape === "SQUARE_WITH_LARGE_CENTRAL_PLOT";
    case "distance_between_plots":
      return NFI.includes(shape);
    case "distance_to_buffers":
      return squareOrRound && v.buffer_shape !== "NONE";
    default:
      return true;
  }
}

/** The label of a number field: the distance between the points is the radius of a round plot or of a cluster's plots. */
export function numberLabel(key: string, v: PlotLayoutValues): MessageKey {
  if (key === "distance_between_sample_points") {
    if (ROUND.includes(v.sample_shape)) return "file.layout.radius";
    if (NFI.includes(v.sample_shape)) return "file.layout.clusterRadius";
  }
  return `file.layout.${key}` as MessageKey;
}

/** PlotGeometry.minimumReferenceDistance: the smallest distance at which the reference area holds the plot. */
export function minimumReferenceDistance(v: PlotLayoutValues): number {
  const round = ROUND.includes(v.sample_shape);
  const points = Number(v.number_of_sampling_points_in_plot) || 0;
  const distance = Math.max(2, Math.min(1000, whole(v.distance_between_sample_points) ?? 10));
  const margin = Math.max(0, Math.min(500, whole(v.distance_to_plot_boundaries) ?? 0));
  const side = points <= 1 ? 2 * margin : 2 * margin + (Math.sqrt(points) - 1) * distance;
  const h = round ? distance + 5 : side / 2;
  const cos30 = Math.cos(Math.PI / 6);
  const minimum = v.buffer_shape === "CIRCLE" ? (round ? h : h * Math.SQRT2) : v.buffer_shape === "HEXAGON" ? (round ? h / cos30 : (h * (cos30 + 0.5)) / cos30) : h;
  return Math.max(1, Math.ceil(minimum) + 1);
}

export type FieldError = { key: "file.layout.range"; min: number; max: number } | { key: "file.layout.referenceMin"; min: number };

/** The broken rules of the fields shown, by key. */
export function layoutErrors(v: PlotLayoutValues): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {};
  for (const f of NUMBER_FIELDS) {
    if (!isShown(f.key, v)) continue;
    const n = whole(v[f.key]);
    if (n === null || n < f.min || n > f.max) errors[f.key] = { key: "file.layout.range", min: f.min, max: f.max };
  }
  if (isShown("distance_to_buffers", v) && !errors.distance_to_buffers) {
    const min = minimumReferenceDistance(v);
    if (Number(v.distance_to_buffers) < min) errors.distance_to_buffers = { key: "file.layout.referenceMin", min };
  }
  return errors;
}

/**
 * What to send: the fields shown that differ from what the page started with, and a blank for those
 * saved blank while hidden that the project file still has a value for (Collect Earth's settings save
 * alike).
 */
export function layoutChanges(stored: PlotLayoutValues, initial: PlotLayoutValues, v: PlotLayoutValues): PlotLayoutValues {
  const changes: PlotLayoutValues = {};
  for (const key of ["sample_shape", "number_of_sampling_points_in_plot", "buffer_shape", ...NUMBER_FIELDS.map((f) => f.key)]) {
    if (isShown(key, v)) {
      if (v[key].trim() !== initial[key]) changes[key] = v[key].trim();
    } else if (NUMBER_FIELDS.some((f) => f.key === key && f.blankWhenHidden) && (stored[key] ?? "").trim() !== "") {
      changes[key] = "";
    }
  }
  return changes;
}
