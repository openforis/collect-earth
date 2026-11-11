// The plot layout of a project (how Collect Earth draws each plot: its shape, sample points, distances and the reference
// area around it), as the desktop's settings page has it (collect-earth-app service/settings SettingsModel and
// PlotGeometry): read from and written to the project file's project_definition.properties, which Collect Earth applies
// when it opens the project. The dashboard's Project file tab edits it (routes/plotLayout.ts).
import { cepProperties, readCep, withProperties } from './cep.js';

export const SAMPLE_SHAPES = [
  'SQUARE', 'SQUARE_WITH_LARGE_CENTRAL_PLOT', 'CIRCLE', 'HEXAGON', 'NFI_THREE_CIRCLES', 'NFI_FOUR_CIRCLES', 'SQUARE_CIRCLE',
  'NFMA', 'NFMA_250', 'KML_POLYGON', 'WKT_POLYGON', 'GEOJSON_POLYGON',
] as const;
export const BUFFER_SHAPES = ['NONE', 'SQUARE', 'CIRCLE', 'HEXAGON'] as const;
/** None, the central one, or a square grid of 2 × 2 to 10 × 10 (SettingsModel) */
export const POINT_COUNTS = [0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100] as const;

/** The whole numbers of the layout, by property: their range and default (PlotGeometry) */
export const LAYOUT_NUMBERS = {
  distance_between_sample_points: { min: 2, max: 1000, fallback: 10 },
  distance_to_plot_boundaries: { min: 0, max: 500, fallback: 0 },
  inner_point_side: { min: 2, max: 100, fallback: 2 },
  large_central_plot_side: { min: 2, max: 200, fallback: 20 },
  distance_between_plots: { min: 2, max: 1000, fallback: 100 },
  distance_to_buffers: { min: 1, max: 10000, fallback: 100 },
} as const;
type NumberKey = keyof typeof LAYOUT_NUMBERS;

export const LAYOUT_KEYS = ['sample_shape', 'number_of_sampling_points_in_plot', ...Object.keys(LAYOUT_NUMBERS), 'buffer_shape'] as const;
export type LayoutValues = Record<(typeof LAYOUT_KEYS)[number], string>;

const clamp = (text: string | undefined, { min, max, fallback }: { min: number; max: number; fallback: number }) => {
  const n = Number.parseInt((text ?? '').trim(), 10);
  return Math.max(min, Math.min(max, Number.isNaN(n) ? fallback : n));
};

/**
 * The layout as Collect Earth reads it from the properties: an unknown or blank shape is SQUARE; a missing number its
 * default, clamped to its range; a reference area shape left blank is NONE without a distance, else SQUARE (projects
 * older than the setting); the first of several distances to the reference area (a file edited by hand).
 */
export function layoutOf(properties: ReadonlyMap<string, string>): LayoutValues {
  const shape = (properties.get('sample_shape') ?? '').trim().toUpperCase();
  const buffer = (properties.get('buffer_shape') ?? '').trim().toUpperCase();
  const points = Number.parseInt((properties.get('number_of_sampling_points_in_plot') ?? '').trim(), 10);
  const numbers = Object.fromEntries(
    (Object.keys(LAYOUT_NUMBERS) as NumberKey[]).map((k) => [k, String(clamp(k === 'distance_to_buffers' ? properties.get(k)?.split(',')[0] : properties.get(k), LAYOUT_NUMBERS[k]))]),
  ) as Record<NumberKey, string>;
  return {
    sample_shape: (SAMPLE_SHAPES as readonly string[]).includes(shape) ? shape : 'SQUARE',
    number_of_sampling_points_in_plot: String(Number.isNaN(points) ? 25 : Math.max(0, Math.min(100, points))),
    ...numbers,
    buffer_shape: (BUFFER_SHAPES as readonly string[]).includes(buffer)
      ? buffer
      : buffer === '' && (properties.get('distance_to_buffers') ?? '').trim() === '' ? 'NONE' : 'SQUARE',
  };
}

/** The layout of a project file (its properties), or null when it cannot be read. */
export function layoutOfCep(cep: Buffer): LayoutValues | null {
  try {
    return layoutOf(cepProperties(readCep(cep)));
  } catch {
    return null;
  }
}

/** The layout a coordinator sends, checked: every key, each within its options or range; else what is wrong. */
export function parseLayout(body: unknown): LayoutValues | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'The layout must be an object.';
  const b = body as Record<string, unknown>;
  const text = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : typeof b[k] === 'number' ? String(b[k]) : '');
  const shape = text('sample_shape').toUpperCase();
  if (!(SAMPLE_SHAPES as readonly string[]).includes(shape)) return `sample_shape: one of ${SAMPLE_SHAPES.join(', ')}.`;
  const buffer = text('buffer_shape').toUpperCase();
  if (!(BUFFER_SHAPES as readonly string[]).includes(buffer)) return `buffer_shape: one of ${BUFFER_SHAPES.join(', ')}.`;
  const points = text('number_of_sampling_points_in_plot');
  if (!(POINT_COUNTS as readonly number[]).map(String).includes(points)) return `number_of_sampling_points_in_plot: one of ${POINT_COUNTS.join(', ')}.`;
  const numbers: Partial<Record<NumberKey, string>> = {};
  for (const key of Object.keys(LAYOUT_NUMBERS) as NumberKey[]) {
    const { min, max } = LAYOUT_NUMBERS[key];
    const value = text(key);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) return `${key}: a whole number of metres from ${min} to ${max}.`;
    numbers[key] = String(Number(value));
  }
  return { sample_shape: shape, number_of_sampling_points_in_plot: points, ...(numbers as Record<NumberKey, string>), buffer_shape: buffer };
}

/**
 * A properties file's text with these values set: each key's line replaced where it is (a later line of the same key,
 * which Java would read instead, dropped), the keys it lacks added at the end; every other line as it was. The values
 * are plain words and numbers, written as they are.
 */
export function setProperties(text: string, values: Readonly<Record<string, string>>): string {
  const ending = /\r\n/.test(text) ? '\r\n' : /\r/.test(text) && !/\n/.test(text) ? '\r' : '\n';
  const lines = text === '' ? [] : text.split(/\r\n|\r|\n/);
  const trailing = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  const done = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/^[ \t\f]+/, '');
    // A logical line goes on while a line ends with an odd number of backslashes
    let last = i;
    while (/(^|[^\\])(\\\\)*\\$/.test(lines[last]) && last + 1 < lines.length && !(trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!'))) last++;
    const key = trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!') ? null : /^((?:[^\\=: \t\f]|\\.)*)/.exec(trimmed)![1];
    if (key !== null && Object.prototype.hasOwnProperty.call(values, key)) {
      if (!done.has(key)) out.push(`${key}=${values[key]}`);
      done.add(key);
    } else {
      for (let j = i; j <= last; j++) out.push(lines[j]);
    }
    i = last;
  }
  for (const [key, value] of Object.entries(values)) if (!done.has(key)) out.push(`${key}=${value}`);
  return out.join(ending) + (out.length > 0 ? ending : '');
}

const SQUARE_PLOT = new Set(['SQUARE', 'SQUARE_WITH_LARGE_CENTRAL_PLOT']);
const ROUND_PLOT = new Set(['CIRCLE', 'HEXAGON']);
const NFI_CLUSTER = new Set(['NFI_THREE_CIRCLES', 'NFI_FOUR_CIRCLES']);
type LayoutKey = (typeof LAYOUT_KEYS)[number];

/** Whether a setting is shown for this layout (SettingsModel's visibleWhen), and so whether it is written. */
export function isShown(key: LayoutKey, layout: LayoutValues): boolean {
  const shape = layout.sample_shape;
  const points = Number(layout.number_of_sampling_points_in_plot);
  const square = SQUARE_PLOT.has(shape);
  const round = ROUND_PLOT.has(shape);
  const nfi = NFI_CLUSTER.has(shape);
  switch (key) {
    case 'sample_shape':
      return true;
    case 'number_of_sampling_points_in_plot':
    case 'buffer_shape':
      return square || round;
    case 'distance_between_sample_points':
      return round || (square && points >= 2) || nfi;
    case 'distance_to_plot_boundaries':
      return square;
    case 'inner_point_side':
      return ((square || round) && points >= 1) || nfi;
    case 'large_central_plot_side':
      return shape === 'SQUARE_WITH_LARGE_CENTRAL_PLOT';
    case 'distance_between_plots':
      return nfi;
    case 'distance_to_buffers':
      return (square || round) && layout.buffer_shape !== 'NONE';
    default:
      return false;
  }
}

/**
 * Written blank when not shown, as the desktop's settings page saves them (blankWhenHidden): Collect Earth sizes a
 * square of one point by the distance between points whenever it has one, and draws a central plot in any square plot
 * that has a side for it.
 */
const BLANK_WHEN_HIDDEN = new Set<LayoutKey>(['distance_between_sample_points', 'large_central_plot_side']);

/**
 * What saving this layout writes into the properties, as the desktop's settings page saves its plot section: the
 * settings shown whose value changed (as Collect Earth reads them: a missing one is its default), the hidden ones of
 * BLANK_WHEN_HIDDEN made blank, the other hidden ones left as they are. Empty: nothing to write.
 */
export function layoutChanges(properties: ReadonlyMap<string, string>, layout: LayoutValues): Record<string, string> {
  const before = layoutOf(properties);
  const out: Record<string, string> = {};
  for (const key of LAYOUT_KEYS) {
    if (isShown(key, layout)) {
      if (layout[key] === before[key]) continue;
      // Several distances to the reference area (a file edited by hand): the first is the one set, the others kept
      out[key] = key === 'distance_to_buffers' ? [layout[key], ...(properties.get(key)?.split(',').slice(1) ?? [])].join(',') : layout[key];
    } else if (BLANK_WHEN_HIDDEN.has(key) && (properties.get(key) ?? '').trim() !== '') {
      out[key] = '';
    }
  }
  return out;
}

/** The project file with these properties set (layoutChanges), stamped `date`. */
export function withLayout(cep: Buffer, changes: Readonly<Record<string, string>>, date: Date): Buffer {
  return withProperties(cep, (text) => setProperties(text, changes), date);
}
