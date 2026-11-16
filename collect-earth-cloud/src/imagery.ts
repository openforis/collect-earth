// The imagery windows of a project file: the settings of Collect Earth's Settings > Imagery section that decide
// which windows open beside each plot and how (SettingsModel.imagery() and BrowserService in the desktop), kept in
// project_definition.properties. The coordinator changes them on the dashboard; Collect Earth reads them back
// during its sync (CloudProjectSettings). The Planet key is left out: it is each person's own Planet account.

export const IMAGERY_KEYS = [
  'open_gee_app',
  'geeapp_date_from',
  'geeapp_date_to',
  'open_earth_map',
  'open_esri_wayback',
  'open_planet_maps',
  'planet_maps_use_tfo',
  'planet_tfo_date_from',
  'planet_tfo_date_to',
  'extra_map_url',
  'explorer_config',
] as const;

export type ImageryKey = (typeof IMAGERY_KEYS)[number];
/** The keys the properties have, with their values as written. */
export type Imagery = Partial<Record<ImageryKey, string>>;

const SWITCHES: readonly string[] = ['open_gee_app', 'open_earth_map', 'open_esri_wayback', 'open_planet_maps', 'planet_maps_use_tfo'];
const DATES: readonly string[] = ['geeapp_date_from', 'geeapp_date_to'];
const MONTHS: readonly string[] = ['planet_tfo_date_from', 'planet_tfo_date_to'];
/** SettingsValidator.FIRST_GEE_DATE */
const FIRST_DATE = '2000-01-01';
/** The longest Explorer configuration, compact: it travels in the address of every plot's window. */
const EXPLORER_CONFIG_MAX = 2000;
const CONTROL = /[\u0000-\u001f\u007f]/;

const isKey = (key: string): key is ImageryKey => (IMAGERY_KEYS as readonly string[]).includes(key);

/** The imagery keys a project file's properties have. */
export function imageryOf(properties: ReadonlyMap<string, string>): Imagery {
  const imagery: Imagery = {};
  for (const key of IMAGERY_KEYS) {
    const value = properties.get(key);
    if (value !== undefined) imagery[key] = value.trim();
  }
  return imagery;
}

/** A real yyyy-mm-dd date. */
function isDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

/**
 * The changes asked for, or why they are refused, with the rules of Collect Earth's settings (SettingsValidator): a
 * switch is true or false, a date of the Earth Engine app yyyy-mm-dd between 2000-01-01 and today (the start not
 * after the end), a Planet mosaic as PlanetMonths stores it, the extra map a web address, the Explorer's configuration
 * a JSON object (kept compact). Blank is allowed but for
 * the switches.
 */
export function checkImagery(body: unknown, current: Imagery, today: Date = new Date()): { changes: Imagery } | { reason: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { reason: 'expected an object of imagery settings' };
  const last = today.toISOString().slice(0, 10);
  const changes: Imagery = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!isKey(key)) return { reason: `${key} is not an imagery setting` };
    if (typeof raw !== 'string') return { reason: `${key} must be text` };
    const value = raw.trim();
    if (SWITCHES.includes(key) && value !== 'true' && value !== 'false') return { reason: `${key} must be true or false` };
    if (DATES.includes(key) && value !== '' && !(isDate(value) && value >= FIRST_DATE && value <= last)) {
      return { reason: `${key} must be a date as yyyy-mm-dd between ${FIRST_DATE} and today` };
    }
    if (MONTHS.includes(key) && value !== '' && !/^\d{4}-\d{2}(_\d{4}-\d{2})?$/.test(value)) {
      return { reason: `${key} must be a Planet mosaic such as 2021-03 or 2019-12_2020-05` };
    }
    if (key === 'extra_map_url' && value !== '' && !isWebAddress(value)) return { reason: 'extra_map_url must be a web address (http or https)' };
    if (key === 'explorer_config' && value !== '') {
      const compact = explorerConfig(value);
      if (typeof compact !== 'string') return compact;
      changes[key] = compact;
      continue;
    }
    changes[key] = value;
  }
  const merged = { ...current, ...changes };
  const [from, to] = [merged.geeapp_date_from ?? '', merged.geeapp_date_to ?? ''];
  if (isDate(from) && isDate(to) && from > to) return { reason: 'geeapp_date_from must not be after geeapp_date_to' };
  return { changes };
}

/**
 * The Explorer's configuration in its compact form, or why it is refused. Shape only: the server does not know the
 * catalogue, and the Explorer skips what it does not understand. Spacing between tokens is dropped, so only control
 * characters inside the document's texts are refused.
 */
function explorerConfig(value: string): string | { reason: string } {
  let control = false;
  let doc: unknown;
  try {
    doc = JSON.parse(value, (k, v: unknown) => {
      if (CONTROL.test(k) || (typeof v === 'string' && CONTROL.test(v))) control = true;
      return v;
    });
  } catch {
    return { reason: 'explorer_config must be a JSON document' };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { reason: 'explorer_config must be a JSON object' };
  const d = doc as Record<string, unknown>;
  if ('v' in d && d.v !== 1) return { reason: 'explorer_config v must be 1' };
  for (const half of ['layers', 'charts']) {
    if (half in d && !Array.isArray(d[half])) return { reason: `explorer_config ${half} must be a list` };
  }
  if (control) return { reason: 'explorer_config must not hold control characters' };
  const compact = JSON.stringify(doc);
  if (compact.length > EXPLORER_CONFIG_MAX) return { reason: `explorer_config is at most ${EXPLORER_CONFIG_MAX} characters` };
  return compact;
}

function isWebAddress(value: string): boolean {
  if (CONTROL.test(value)) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
