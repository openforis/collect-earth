// The outline Collect Earth draws around a plot, read from the project file's
// project_definition.properties, so that "Open in Earth Map" shows the plot as Collect Earth
// does (BrowserService.earthMapUrl sends the plot's shape). Only what can be drawn from the
// plot's centre: SQUARE (and SQUARE_CIRCLE, whose outline is the square's), CIRCLE and
// HEXAGON. The others (NFMA, NFI circles, polygons from the plot file) give only the place.

/** What the dashboard draws: a square or regular polygon around the centre, or only the place. */
export type PlotOutline = { kind: 'square'; sideMeters: number } | { kind: 'circle'; radiusMeters: number; vertices: number } | { kind: 'place' };

/** CircleKmlGenerator.MARGIN_CIRCLE: the circle is drawn this much beyond its radius. */
const CIRCLE_MARGIN_M = 5;
/** CircleKmlGenerator.NUMBER_OF_POINTS_TO_DRAW_CIRCLE and HexagonKmlGenerator's vertices. */
const CIRCLE_VERTICES = 130;
const HEXAGON_VERTICES = 6;
/** KmlGeneratorService: the points in a plot when none are set. */
const DEFAULT_POINTS = 25;

const numberOf = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === '') return null;
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * The plot's outline from the project's properties (null: none read). `polygons`: the plot
 * file has a polygon column (Collect Earth then draws those, KmlGeneratorService).
 */
export function plotOutline(properties: ReadonlyMap<string, string> | null, polygons = false): PlotOutline {
  if (!properties || polygons) return { kind: 'place' };
  const shape = (properties.get('sample_shape') ?? '').trim().toUpperCase() || 'SQUARE';
  const distance = numberOf(properties.get('distance_between_sample_points'));
  if (shape === 'SQUARE' || shape === 'SQUARE_CIRCLE') {
    const boundary = numberOf(properties.get('distance_to_plot_boundaries'));
    const points = numberOf(properties.get('number_of_sampling_points_in_plot')) ?? DEFAULT_POINTS;
    if (distance === null || boundary === null || points < 1) return { kind: 'place' };
    // SquareKmlGenerator: getNumOfRows() = (int) Math.sqrt(points) + 1; side = distance × (rows − 2) + 2 × boundary.
    const rows = Math.floor(Math.sqrt(Math.floor(points))) + 1;
    const side = distance * (rows - 2) + 2 * boundary;
    return side > 0 ? { kind: 'square', sideMeters: side } : { kind: 'place' };
  }
  if (shape === 'CIRCLE' || shape === 'HEXAGON') {
    if (distance === null || distance + CIRCLE_MARGIN_M <= 0) return { kind: 'place' };
    return { kind: 'circle', radiusMeters: distance + CIRCLE_MARGIN_M, vertices: shape === 'CIRCLE' ? CIRCLE_VERTICES : HEXAGON_VERTICES };
  }
  return { kind: 'place' };
}

/** Whether a plot file row holds a polygon (KML, WKT or GeoJSON), as KmlGeneratorService tests the second line. */
export function hasPolygonColumn(fields: readonly string[]): boolean {
  return fields.some((f) => {
    const t = f.trim();
    return /^(MULTI)?POLYGON\s*\(/i.test(t) || /<Polygon[\s>]/.test(t) || (t.startsWith('{') && /"type"\s*:\s*"(Multi)?Polygon"/.test(t));
  });
}

/**
 * The plot id as the collector sees it (KmlGenerator.getVisiblePlacemarkId): the key values
 * without those hidden from the record list (`hidden`, per key of the survey). A plot unit
 * that already lacks its hidden parts (the added round) is shown as it is.
 */
export function visibleId(plot: string, hidden: readonly boolean[] | null): string {
  if (!hidden || !hidden.some((h) => h)) return plot;
  const parts = plot.split(',');
  if (parts.length !== hidden.length) return plot;
  return parts.filter((_, i) => !hidden[i]).join(',');
}
