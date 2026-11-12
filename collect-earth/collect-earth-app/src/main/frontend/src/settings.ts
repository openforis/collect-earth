import { serverText, type Texts } from "./serverTexts";

/**
 * The settings page, as the server describes it (SettingsModel, GET /api/settings): the sections, their fields and
 * the conditions under which a field is shown, which this module evaluates as the server does (Condition.java), so
 * the fields of a plot shape appear as the user picks it. The rules themselves run on the server
 * (POST /api/settings/validate): the page only holds the values and shows what the server says about them.
 */

/** When a field is shown: {key, in}, {key, min}, {key, notBlank}, {all}, {any} or {not}. */
export type Condition =
  | { key: string; in: string[] }
  | { key: string; min: number }
  | { key: string; notBlank: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type FieldType = "text" | "password" | "integer" | "boolean" | "choice" | "file" | "folder" | "date";

/** An option of a choice: its label is a key of the server texts, or a plain text (a month). */
export interface Choice { value: string; label?: string; text?: string }

export interface Field {
  key: string;
  type: FieldType;
  /** A key of the server texts */
  label: string;
  tooltip: string | null;
  default: string;
  restart: boolean;
  required: boolean;
  visible?: Condition;
  /** Other labels while a condition holds, the first that holds wins */
  labels?: { when: Condition; label: string }[];
  min?: number;
  max?: number;
  choices?: Choice[];
  extensions?: string[];
}

export interface Section { id: string; label: string; hint: string | null; fields: Field[] }

/** All values are strings, as earth.properties holds them. */
export type Values = Record<string, string>;

export interface PlotFigures {
  plotAreaHa: number;
  referenceAreaHa: number | null;
  minReferenceDistance: number | null;
  recommendedReferenceDistance: number | null;
}

export interface Validation { errors: Record<string, string>; warnings: Record<string, string>; plot: PlotFigures | null }

export interface SettingsInfo { computerIp: string; backupFolder: string; cloudMode: boolean }

export interface Settings { sections: Section[]; values: Values; info: SettingsInfo }

export interface SampleFileProblem { code: string; message: string; blocking: boolean; details: unknown }

export interface SampleFileCheck {
  exists: boolean;
  plots: number;
  expectedColumns: string[];
  foundColumns: string[];
  rows: string[][];
  points: [number, number][];
  problems: SampleFileProblem[];
}

/** `cloud`: the cloud project it is connected to, null (or missing, from an older server) for a local one */
export interface Project { name: string; folder: string; active: boolean; cloud?: { server: string; serverName: string; projectName: string } | null }

const valueOf = (values: Values, key: string) => values[key] ?? "";

/** Whether the condition holds for the values; none always does. */
export function holds(condition: Condition | undefined, values: Values): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((c) => holds(c, values));
  if ("any" in condition) return condition.any.some((c) => holds(c, values));
  if ("not" in condition) return !holds(condition.not, values);
  const value = valueOf(values, condition.key);
  if ("in" in condition) return condition.in.includes(value);
  if ("min" in condition) {
    const n = /^\s*-?\d+\s*$/.test(value) ? parseInt(value, 10) : NaN;
    return !Number.isNaN(n) && n >= condition.min;
  }
  return value.trim() !== "";
}

export const isVisible = (field: Field, values: Values) => holds(field.visible, values);

/** The key of the label of the field for these values. */
export function fieldLabel(field: Field, values: Values): string {
  return field.labels?.find((l) => holds(l.when, values))?.label ?? field.label;
}

/** The label of a choice, from the server texts or its own text. */
export function choiceLabel(choice: Choice, texts: Texts | null): string {
  return choice.label !== undefined ? serverText(texts, choice.label) : choice.text ?? choice.value;
}

/**
 * The values that differ from the stored ones, of the fields shown for the current values: what Apply sends. A
 * hidden field keeps what it held, which the server does not save (it blanks the few it has to).
 */
export function changes(stored: Values, current: Values, fields: Field[]): Values {
  const changed: Values = {};
  for (const field of fields) {
    if (!isVisible(field, current)) continue;
    const value = current[field.key] ?? "";
    if (value !== (stored[field.key] ?? "")) changed[field.key] = value;
  }
  return changed;
}

/** Whether applying these changes restarts Collect Earth: one of them is a setting only a new server reads. */
export function restartNeeded(fields: Field[], changed: Values): boolean {
  return fields.some((f) => f.restart && f.key in changed);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether the field's label or tooltip contains the query, whatever the case or the accents. */
export function matches(field: Field, texts: Texts | null, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const labels = [field.label, ...(field.labels ?? []).map((l) => l.label)].map((k) => serverText(texts, k));
  const tooltip = field.tooltip ? serverText(texts, field.tooltip) : "";
  return [...labels, tooltip, ...(field.choices ?? []).map((c) => choiceLabel(c, texts))].some((t) => fold(t).includes(q));
}

/** The sections with only the fields shown for the values that match the query; a section with none is left out. */
export function sectionsMatching(sections: Section[], texts: Texts | null, query: string, values: Values): Section[] {
  if (!query.trim()) return sections;
  return sections
    .map((s) => ({ ...s, fields: s.fields.filter((f) => isVisible(f, values) && matches(f, texts, query)) }))
    .filter((s) => s.fields.length > 0);
}

/**
 * The distance to set when the reference area shape was just chosen, as the Swing panel proposed it: the recommended
 * one while the distance is blank (never set) or would not enclose the plot; null to leave it.
 */
export function proposeReferenceDistance(values: Values, plot: PlotFigures | null): number | null {
  if (!plot || plot.recommendedReferenceDistance == null || plot.minReferenceDistance == null) return null;
  const distance = valueOf(values, "distance_to_buffers").trim();
  if (distance === "") return plot.recommendedReferenceDistance;
  const n = parseInt(distance, 10);
  return Number.isNaN(n) || n < plot.minReferenceDistance ? plot.recommendedReferenceDistance : null;
}

/** "2021/03" for "2021-03", "2015/12 - 2016/05" for "2015-12_2016-05" (the Planet mosaics). */
export function monthLabel(value: string): string {
  return value.split("_").map((m) => m.replace("-", "/")).join(" - ");
}

/** The number of changes, as the bar at the bottom says it. */
export function changeCount(changed: Values): number {
  return Object.keys(changed).length;
}

/** The defaults of the visible fields of a section, for Restore defaults; the `locked` fields keep their values. */
export function defaultsOf(section: Section, values: Values, locked: readonly string[] = []): Values {
  const defaults: Values = {};
  for (const field of section.fields) {
    if (isVisible(field, values) && !locked.includes(field.key)) defaults[field.key] = field.default;
  }
  return defaults;
}

/** The key of the plots file (EarthProperty.SAMPLE_FILE) */
export const PLOT_FILE = "csv";

/**
 * Whether the plots file can only be chosen in the list of the files assigned by the cloud server: in a cloud project
 * the plots are the ones its coordinator assigned (SettingsValidator refuses any other file), so the field is read-only.
 * Not once the page switches to another database, which leaves the cloud project.
 */
export function plotFileLocked(info: SettingsInfo | null | undefined, values: Values): boolean {
  return !!info?.cloudMode && values.db_driver === "CLOUD";
}

/** The section of the plot design (SettingsModel.PLOT) */
export const PLOT_SECTION = "plot";

/** The section of the imagery windows (SettingsModel.IMAGERY), and its one setting that stays each person's own */
export const IMAGERY_SECTION = "imagery";
const PLANET_KEY = "planet_maps_key";

/**
 * The fields of a section only shown, not changed, here: in a cloud project the plots file (chosen among the assigned
 * ones), the whole plot design and the imagery windows but the Planet key, which its coordinator sets in the project
 * file (SettingsService refuses a change; SettingsModel.coordinatorsSection).
 */
export function lockedFields(section: Section, info: SettingsInfo | null | undefined, values: Values): string[] {
  if (!plotFileLocked(info, values)) return [];
  if (section.id === PLOT_SECTION) return section.fields.map((f) => f.key);
  if (section.id === IMAGERY_SECTION) return section.fields.filter((f) => f.key !== PLANET_KEY).map((f) => f.key);
  return section.fields.filter((f) => f.key === PLOT_FILE).map((f) => f.key);
}

/** Whether the stored and current values of a field differ: the field is marked as changed. */
export function isChanged(stored: Values, current: Values, key: string): boolean {
  return (current[key] ?? "") !== (stored[key] ?? "");
}

/** A server text with its {0}, {1}... replaced, as MessageFormat would. */
export function formatText(text: string, ...args: (string | number)[]): string {
  return text.replace(/\{(\d+)\}/g, (match, i: string) => (args[Number(i)] === undefined ? match : String(args[Number(i)])));
}
