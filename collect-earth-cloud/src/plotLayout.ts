// The plot layout of a project file: the settings of Collect Earth's Settings > Plot section, kept in
// project_definition.properties (SettingsModel.plot() and PlotGeometry in the desktop). The coordinator
// changes them on the dashboard; Collect Earth reads them back during its sync (CloudPlotLayout).

export const PLOT_LAYOUT_KEYS = [
  'sample_shape',
  'number_of_sampling_points_in_plot',
  'distance_between_sample_points',
  'distance_to_plot_boundaries',
  'inner_point_side',
  'large_central_plot_side',
  'distance_between_plots',
  'buffer_shape',
  'distance_to_buffers',
] as const;

export type PlotLayoutKey = (typeof PLOT_LAYOUT_KEYS)[number];
/** The keys the properties have, with their values as written. */
export type PlotLayout = Partial<Record<PlotLayoutKey, string>>;

/** EarthConstants.SAMPLE_SHAPE */
export const SAMPLE_SHAPES = [
  'SQUARE', 'SQUARE_WITH_LARGE_CENTRAL_PLOT', 'CIRCLE', 'KML_POLYGON', 'WKT_POLYGON', 'GEOJSON_POLYGON', 'HEXAGON',
  'NFMA', 'NFMA_250', 'SQUARE_CIRCLE', 'NFI_THREE_CIRCLES', 'NFI_FOUR_CIRCLES',
];
/** EarthConstants.BUFFER_SHAPE */
export const BUFFER_SHAPES = ['NONE', 'SQUARE', 'CIRCLE', 'HEXAGON'];
/** The choices of the Settings page: none, the central point, 2×2 to 10×10. */
export const POINT_COUNTS = ['0', '1', ...Array.from({ length: 9 }, (_, i) => String((i + 2) ** 2))];
/** PlotGeometry's MIN_ and MAX_ of each whole-number setting. */
export const RANGES: Partial<Record<PlotLayoutKey, [number, number]>> = {
  distance_between_sample_points: [2, 1000],
  distance_to_plot_boundaries: [0, 500],
  inner_point_side: [2, 100],
  large_central_plot_side: [2, 200],
  distance_between_plots: [2, 1000],
  distance_to_buffers: [1, 10000],
};

const isKey = (key: string): key is PlotLayoutKey => (PLOT_LAYOUT_KEYS as readonly string[]).includes(key);

/** The layout keys a project file's properties have. */
export function plotLayoutOf(properties: ReadonlyMap<string, string>): PlotLayout {
  const layout: PlotLayout = {};
  for (const key of PLOT_LAYOUT_KEYS) {
    const value = properties.get(key);
    if (value !== undefined) layout[key] = value.trim();
  }
  return layout;
}

/** PlotGeometry.parseIntWithinRange */
function intWithin(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = /^\s*-?\d+\s*$/.test(value ?? '') ? Number(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

/** PlotGeometry.minimumReferenceDistance: the smallest distance at which the reference area holds the plot's outline. */
export function minimumReferenceDistance(layout: PlotLayout): number {
  const shape = (layout.sample_shape ?? '').toUpperCase() || 'SQUARE';
  const round = shape === 'CIRCLE' || shape === 'HEXAGON';
  const points = intWithin(layout.number_of_sampling_points_in_plot, 0, 0, 100);
  const distance = intWithin(layout.distance_between_sample_points, 10, 2, 1000);
  const margin = intWithin(layout.distance_to_plot_boundaries, 0, 0, 500);
  const side = points <= 1 ? 2 * margin : 2 * margin + (Math.sqrt(points) - 1) * distance;
  const h = round ? distance + 5 : side / 2;
  const cos30 = Math.cos(Math.PI / 6);
  const buffer = (layout.buffer_shape ?? '').toUpperCase();
  const minimum = buffer === 'CIRCLE' ? (round ? h : h * Math.SQRT2) : buffer === 'HEXAGON' ? (round ? h / cos30 : (h * (cos30 + 0.5)) / cos30) : h;
  return Math.max(1, Math.ceil(minimum) + 1);
}

/** Whether the reference area is drawn and its distance checked (SettingsModel.REFERENCE_AREA). */
export function hasReferenceArea(layout: PlotLayout): boolean {
  const shape = (layout.sample_shape ?? '').toUpperCase() || 'SQUARE';
  const buffer = (layout.buffer_shape ?? '').toUpperCase();
  return ['SQUARE', 'SQUARE_WITH_LARGE_CENTRAL_PLOT', 'CIRCLE', 'HEXAGON'].includes(shape) && ['SQUARE', 'CIRCLE', 'HEXAGON'].includes(buffer);
}

/**
 * The changes asked for, or why they are refused: an object of layout keys to strings, each a choice of
 * its setting or a whole number within its range (blank allowed, as Collect Earth leaves a hidden one), and
 * a reference area that still holds the plot once applied over `current`.
 */
export function checkPlotLayout(body: unknown, current: PlotLayout): { changes: PlotLayout } | { reason: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { reason: 'expected an object of plot layout settings' };
  const changes: PlotLayout = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!isKey(key)) return { reason: `${key} is not a plot layout setting` };
    if (typeof raw !== 'string') return { reason: `${key} must be text` };
    const value = raw.trim();
    const range = RANGES[key];
    if (key === 'sample_shape' && !SAMPLE_SHAPES.includes(value)) return { reason: `sample_shape must be one of ${SAMPLE_SHAPES.join(', ')}` };
    if (key === 'buffer_shape' && !BUFFER_SHAPES.includes(value)) return { reason: `buffer_shape must be one of ${BUFFER_SHAPES.join(', ')}` };
    if (key === 'number_of_sampling_points_in_plot' && !POINT_COUNTS.includes(value)) {
      return { reason: `number_of_sampling_points_in_plot must be one of ${POINT_COUNTS.join(', ')}` };
    }
    if (range && value !== '' && !(/^\d+$/.test(value) && Number(value) >= range[0] && Number(value) <= range[1])) {
      return { reason: `${key} must be a whole number between ${range[0]} and ${range[1]}` };
    }
    changes[key] = value;
  }
  const merged = { ...current, ...changes };
  if (hasReferenceArea(merged)) {
    // A file edited by hand may hold several distances: Collect Earth's settings check the first
    const distance = Number((merged.distance_to_buffers ?? '100').split(',')[0].trim() || '100');
    const minimum = minimumReferenceDistance(merged);
    if (!(distance >= minimum)) return { reason: `distance_to_buffers must be at least ${minimum} so that the reference area holds the plot` };
  }
  return { changes };
}

/** A value as a .properties line holds it: backslashes doubled, a leading space kept, anything but printable ASCII as \uXXXX (so no line break gets in). */
const escapeValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/^ /, '\\ ').replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * project_definition.properties (its bytes) with `changes` written (the plot layout, the imagery windows): a
 * key's line keeps its key and separator and gets the new value; a key it lacks is added at the end. Every
 * other byte stays.
 */
export function rewriteProperties(data: Buffer, changes: Readonly<Record<string, string | undefined>>): Buffer {
  // latin1: one character per byte, so the bytes not rewritten come back as they were whatever their encoding
  const text = data.toString('latin1');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/(?<=\n)/);
  const written = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ending = /\r?\n$/.exec(line)?.[0] ?? '';
    const body = line.slice(0, line.length - ending.length);
    const m = /^([ \t\f]*)((?:[^\\=: \t\f]|\\.)+)([ \t\f]*[=:]?[ \t\f]*)/.exec(body);
    const key = m && !m[2].startsWith('#') && !m[2].startsWith('!') ? m[2] : null;
    if (key === null || !Object.hasOwn(changes, key) || changes[key] === undefined) {
      out.push(line);
      continue;
    }
    // A value continued on the next lines (an odd number of trailing backslashes) is replaced whole
    let last = line;
    while (/(^|[^\\])(\\\\)*\\$/.test(last.replace(/\r?\n$/, '')) && i + 1 < lines.length) last = lines[++i];
    const lastEnding = /\r?\n$/.exec(last)?.[0] ?? '';
    out.push(`${m![1]}${key}${m![3] || '='}${escapeValue(changes[key]!)}${lastEnding}`);
    written.add(key);
  }
  let result = out.join('');
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || written.has(key)) continue;
    if (result !== '' && !result.endsWith('\n')) result += newline;
    result += `${key}=${escapeValue(value)}${newline}`;
  }
  return Buffer.from(result, 'latin1');
}
