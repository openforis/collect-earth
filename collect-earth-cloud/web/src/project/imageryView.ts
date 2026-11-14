// The Project file tab's imagery windows card: the settings of Collect Earth's Settings > Imagery section
// (SettingsModel.imagery() in the desktop) but the Planet key, each person's own: which fields show, their rules
// and what to send. The server checks the same rules (src/imagery.ts).
import type { MessageKey } from "../i18n";

export type ImageryValues = Record<string, string>;

export const SWITCHES = ["open_gee_app", "open_earth_map", "open_esri_wayback", "open_planet_maps", "planet_maps_use_tfo"] as const;
const DATES = ["geeapp_date_from", "geeapp_date_to"];
const MONTHS = ["planet_tfo_date_from", "planet_tfo_date_to"];
const KEYS = [...SWITCHES, ...DATES, ...MONTHS, "extra_map_url"];
const FIRST_DATE = "2000-01-01";

/** The values as Collect Earth's settings show them: switches true or false, the "first / latest" of old files blank. */
export function shownImagery(stored: ImageryValues): ImageryValues {
  const values: ImageryValues = {};
  for (const key of KEYS) values[key] = (stored[key] ?? "").trim();
  for (const key of SWITCHES) values[key] = String(values[key].toLowerCase() === "true");
  // Planet's switch is on unless it says false (LocalPropertiesService.isPlanetMapsOpen): files without it opened Planet by the key
  values.open_planet_maps = String((stored.open_planet_maps ?? "").trim().toLowerCase() !== "false");
  for (const key of MONTHS) if (values[key] === "Oldest" || values[key] === "Latest") values[key] = "";
  return values;
}

/**
 * Whether a field shows (SettingsModel's visibleWhen): the dates with the Earth Engine app, which Planet imagery with
 * Planet on, the months with its monthly mosaics.
 */
export function isShown(key: string, v: ImageryValues): boolean {
  if (DATES.includes(key)) return v.open_gee_app === "true";
  if (key === "planet_maps_use_tfo") return v.open_planet_maps === "true";
  if (MONTHS.includes(key)) return v.open_planet_maps === "true" && v.planet_maps_use_tfo === "true";
  return true;
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * PlanetMonths.available: the Tropical Forest Observatory mosaics, biannual until 2020-08, then monthly up to the month
 * before this one (published around the 10th). Values as stored, with their labels.
 */
export function planetMonths(today: Date): { value: string; label: string }[] {
  const months: { value: string; label: string }[] = [];
  const biannual: [number, number, number, number][] = [
    [2015, 12, 2016, 5], [2016, 6, 2016, 11], [2016, 12, 2017, 5], [2017, 6, 2017, 11], [2017, 12, 2018, 5],
    [2018, 6, 2018, 11], [2018, 12, 2019, 5], [2019, 6, 2019, 11], [2019, 12, 2020, 5], [2020, 6, 2020, 8],
  ];
  for (const [fy, fm, ty, tm] of biannual) months.push({ value: `${fy}-${two(fm)}_${ty}-${two(tm)}`, label: `${fy}/${two(fm)} - ${ty}/${two(tm)}` });
  const back = today.getDate() < 10 ? 2 : 1;
  const last = today.getFullYear() * 12 + today.getMonth() - back; // months since year 0, January = 0
  for (let m = 2020 * 12 + 8; m <= last; m++) {
    const [y, mo] = [Math.floor(m / 12), (m % 12) + 1];
    months.push({ value: `${y}-${two(mo)}`, label: `${y}/${two(mo)}` });
  }
  return months;
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

function isWebAddress(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** The broken rules of the fields shown, by key (SettingsValidator). */
export function imageryErrors(v: ImageryValues, today: Date): Record<string, MessageKey> {
  const errors: Record<string, MessageKey> = {};
  const last = `${today.getFullYear()}-${two(today.getMonth() + 1)}-${two(today.getDate())}`;
  for (const key of DATES) {
    const value = v[key].trim();
    if (isShown(key, v) && value !== "" && !(isDate(value) && value >= FIRST_DATE && value <= last)) errors[key] = "file.imagery.date";
  }
  const [from, to] = [v.geeapp_date_from.trim(), v.geeapp_date_to.trim()];
  if (isShown("geeapp_date_to", v) && !errors.geeapp_date_from && !errors.geeapp_date_to && from && to && from > to) errors.geeapp_date_to = "file.imagery.dateOrder";
  const url = v.extra_map_url.trim();
  if (url !== "" && !isWebAddress(url)) errors.extra_map_url = "file.imagery.url";
  return errors;
}

/** What Collect Earth's settings warn of an extra map address: the same page for every plot, or half a position. */
export function extraMapWarning(url: string): MessageKey | null {
  const [lat, lon] = [url.includes("LATITUDE"), url.includes("LONGITUDE")];
  if (url.trim() === "") return null;
  if (!lat && !lon && !url.includes("PLOT_ID") && !url.includes("GEOJSON")) return "file.imagery.noPlaceholder";
  return lat !== lon ? "file.imagery.latLong" : null;
}

/** What to send: the fields shown that differ from what the page started with. */
export function imageryChanges(initial: ImageryValues, v: ImageryValues): ImageryValues {
  const changes: ImageryValues = {};
  for (const key of KEYS) {
    if (isShown(key, v) && v[key].trim() !== initial[key]) changes[key] = v[key].trim();
  }
  return changes;
}
