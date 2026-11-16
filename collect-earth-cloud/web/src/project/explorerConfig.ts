// The Imagery card's Explorer section: the configuration document (`explorer_config`) of the Explorer window, as a
// form edits it, built on the Explorer's catalogue (collect-earth-explorer/functions/catalogue.json). The checks mirror
// the Explorer's own (web/src/lib/config.ts resolveEntry); the Explorer is the authority and skips what it refuses.

export type ParamSpec = { type: string; min?: number; max?: number; values?: string[]; default?: unknown };
export type Catalogue = {
  v: number;
  layers: Record<string, { title: string; params: Record<string, ParamSpec> }>;
  charts: Record<string, { title: string; params: Record<string, ParamSpec> }>;
  indices: Record<string, string>;
  bands: Record<string, string[]>;
  standard: { v: number; layers: { type: string }[]; charts: { type: string }[] };
};
export type Kind = "layers" | "charts";
export type Entry = { type: string; params: Record<string, unknown> };
export type Doc = { layers: Entry[]; charts: Entry[] };
/** Why a field is refused; the form shows the message file.explorer.error.<code>. */
export type EntryError =
  | "invalid" | "number" | "year" | "yearOrder" | "date" | "textLength" | "textChars" | "formulaLength"
  | "bothDates" | "dateOrder" | "window" | "yearOrWindow" | "indexOrFormula";

export const EXPLORER_CONFIG_MAX = 2000;
const MAX_WINDOW_DAYS = 1096;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isBlank = (v: unknown) => v === undefined || v === "";

/** The stored document as the form shows it, and whether reading it dropped something (saving would remove it). */
export function parseDoc(stored: string, catalogue: Catalogue): { doc: Doc; unknown: boolean } {
  const standard = (kind: Kind) => catalogue.standard[kind].map((e) => ({ type: e.type, params: {} }));
  let parsed: unknown;
  try {
    parsed = stored === "" ? {} : JSON.parse(stored);
  } catch {
    parsed = undefined;
  }
  if (!isObject(parsed) || (parsed.v !== undefined && parsed.v !== 1)) return { doc: { layers: standard("layers"), charts: standard("charts") }, unknown: true };
  let unknown = false;
  const half = (kind: Kind): Entry[] => {
    const list = parsed[kind];
    if (list === undefined) return standard(kind);
    if (!Array.isArray(list)) {
      unknown = true;
      return standard(kind);
    }
    // As the Explorer: an empty chart list is honoured, a map always needs imagery
    if (list.length === 0) return kind === "charts" ? [] : standard(kind);
    const entries: Entry[] = [];
    for (const raw of list) {
      const { type, ...given } = isObject(raw) ? raw : {};
      if (typeof type !== "string" || !Object.hasOwn(catalogue[kind], type)) {
        unknown = true;
        continue;
      }
      const specs = catalogue[kind][type].params;
      const params: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(given)) {
        if (Object.hasOwn(specs, name)) params[name] = value;
        else unknown = true;
      }
      entries.push({ type, params });
    }
    return entries.length ? entries : standard(kind);
  };
  const doc = { layers: half("layers"), charts: half("charts") };
  return { doc, unknown };
}

const compact = (doc: Doc, catalogue: Catalogue) => {
  const entry = (kind: Kind, e: Entry) => {
    const out: Record<string, unknown> = { type: e.type };
    for (const [name, spec] of Object.entries(catalogue[kind][e.type].params)) {
      const value = e.params[name];
      if (!isBlank(value) && value !== spec.default) out[name] = value;
    }
    return out;
  };
  return JSON.stringify({ v: 1, layers: doc.layers.map((e) => entry("layers", e)), charts: doc.charts.map((e) => entry("charts", e)) });
};

/** What to store: compact JSON without defaults and blanks, or '' for the standard configuration. */
export function serialiseDoc(doc: Doc, catalogue: Catalogue): string {
  const text = compact(doc, catalogue);
  return text === compact(parseDoc("", catalogue).doc, catalogue) ? "" : text;
}

/** The length of what would be stored, against EXPLORER_CONFIG_MAX. */
export const docSize = (doc: Doc, catalogue: Catalogue) => serialiseDoc(doc, catalogue).length;

const isDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);

function paramError(spec: ParamSpec, value: unknown, thisYear: number): EntryError | null {
  const isYear = (y: unknown) => Number.isInteger(y) && (y as number) >= spec.min! && (y as number) <= thisYear;
  switch (spec.type) {
    case "choice": return spec.values!.includes(value as string) ? null : "invalid";
    case "bool": return value === true || value === false ? null : "invalid";
    case "int": return Number.isInteger(value) && (value as number) >= spec.min! && (value as number) <= spec.max! ? null : "number";
    case "year": return isYear(value) ? null : "year";
    case "yearRange":
      if (!Array.isArray(value) || value.length !== 2 || !value.every(isYear)) return "year";
      return value[0] <= value[1] ? null : "yearOrder";
    case "date": return isDate(value) ? null : "date";
    case "text":
      if (typeof value !== "string" || value.length > spec.max!) return "textLength";
      return /[<>]/.test(value) ? "textChars" : null;
    case "formula": return typeof value === "string" && value.length <= spec.max! ? null : "formulaLength";
    default: return "invalid";
  }
}

/** The entry's refused fields, by parameter name: each by its type, then the Explorer's rules across fields. */
export function entryErrors(kind: Kind, entry: Entry, catalogue: Catalogue, thisYear: number): Record<string, EntryError> {
  const specs = catalogue[kind][entry.type].params;
  const p = entry.params;
  const errors: Record<string, EntryError> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const error = isBlank(p[name]) ? null : paramError(spec, p[name], thisYear);
    if (error) errors[name] = error;
  }
  const has = (name: string) => !isBlank(p[name]);
  if (entry.type === "sentinel2" && (has("start") || has("end"))) {
    if (!has("start")) errors.start ??= "bothDates";
    else if (!has("end")) errors.end ??= "bothDates";
    else if (!errors.start && !errors.end) {
      const days = (Date.parse(p.end as string) - Date.parse(p.start as string)) / 86400000;
      if (days <= 0) errors.end = "dateOrder";
      else if (days > MAX_WINDOW_DAYS) errors.end = "window";
    }
    for (const name of ["year", "years"]) if (has(name)) errors[name] ??= "yearOrWindow";
  }
  if (has("formula") && has("index") && p.index !== specs.index?.default) errors.formula ??= "indexOrFormula";
  return errors;
}

/** The Explorer on a sample plot with this configuration, as Collect Earth opens it. */
export function previewUrl(base: string, doc: Doc, catalogue: Catalogue, samplePlot: { lat: number; lon: number }): string {
  const geoJson = encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [samplePlot.lon, samplePlot.lat] }));
  const config = serialiseDoc(doc, catalogue);
  return `${base}/?geoJson=${geoJson}&plot_id=Preview${config ? `&config=${encodeURIComponent(config)}` : ""}`;
}

/** The list with the entry at `index` moved by `delta` places; unchanged when that leaves the list. */
export function move<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  const next = [...list];
  if (to < 0 || to >= list.length) return next;
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export const remove = <T>(list: T[], index: number): T[] => list.filter((_, i) => i !== index);

export const add = (list: Entry[], type: string): Entry[] => [...list, { type, params: {} }];
