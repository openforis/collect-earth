// The configuration document (`config`) as the /configure page edits it, ported from the dashboard's explorerConfig.ts.
// Per-field checks reuse lib/config.ts (check, formulaOk), which resolveConfig applies; resolveConfig stays the authority.
import catalogueJson from "../../../functions/catalogue.json";
import { check, formulaOk, type Spec } from "../lib/config";
import { t } from "../lib/i18n";
import { ct } from "./texts";

export type Kind = "layers" | "charts";
export type Entry = { type: string; params: Record<string, unknown> };
export type Doc = { layers: Entry[]; charts: Entry[] };
/** Why a field is refused; the page shows the message configure.error.<code>. */
export type EntryError =
  | "invalid" | "number" | "year" | "yearOrder" | "date" | "textLength" | "textChars" | "formulaLength" | "formula"
  | "dateRequired" | "formulaRequired" | "dateOrder" | "window" | "yearOrWindow" | "indexOrFormula";

type Raw = { type: string } & Record<string, unknown>;
export const catalogue = catalogueJson as unknown as Record<Kind, Record<string, { title: string; params: Record<string, Spec> }>> & {
  indices: Record<string, string>;
  bands: Record<string, string[]>;
  standard: Record<Kind, Raw[]>;
  presets: Record<string, Record<Kind, Raw[]>>;
};

/** What the dashboard and Collect Earth store at most (the dashboard's EXPLORER_CONFIG_MAX). */
export const EXPLORER_CONFIG_MAX = 2000;
const MAX_WINDOW_DAYS = 1096;
export const ANALYSES = ["anomaly", "median", "trend", "change", "unusual", "season"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isBlank = (v: unknown) => v === undefined || (typeof v === "string" && v.trim() === "");
/** What the dashboard's server refuses inside the document's texts (collect-earth-cloud/src/imagery.ts CONTROL). */
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A Sentinel-2 entry showing a fixed period rather than a year slider: it has the date fields, even blank. */
export const isFixed = (e: Entry) => e.type === "sentinel2" && ("start" in e.params || "end" in e.params);
/** An index chart on a formula of its own rather than a named index: it has the formula field, even blank. */
export const isCustom = (e: Entry) => "formula" in e.params;

/** The stored document as the page shows it, and whether reading it dropped something (saving would remove it). */
export function parseDoc(stored: string): { doc: Doc; unknown: boolean } {
  // With the standard entries' own parameters (two charts start folded), so editing elsewhere keeps them.
  const standard = (kind: Kind) => catalogue.standard[kind].map(({ type, ...params }) => ({ type, params }));
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
    // As resolveConfig: an empty chart list is honoured, a map always needs imagery.
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

const compact = (doc: Doc) => {
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
export function serialiseDoc(doc: Doc): string {
  const text = compact(doc);
  return text === compact(parseDoc("").doc) ? "" : text;
}

/** The starting point `name` ("standard" or a key of the catalogue's `presets`) as the page edits it. */
export const presetDoc = (name: string) => parseDoc(name === "standard" ? "" : JSON.stringify(catalogue.presets[name])).doc;
export const PRESETS = ["standard", ...Object.keys(catalogue.presets)];

function paramError(spec: Spec, value: unknown, thisYear: number, bands: string[]): EntryError | null {
  if (spec.type === "text" || spec.type === "formula") {
    const text = spec.type === "text";
    if (typeof value !== "string" || value.length > spec.max!) return text ? "textLength" : "formulaLength";
    // lib/config.ts takes tabs and line breaks in a formula as spaces; the dashboard's server refuses them in the document.
    if (CONTROL.test(value)) return text ? "textChars" : "formula";
    if (!text) return formulaOk(value, bands) ? null : "formula";
  }
  if (check(spec, value, thisYear)) return null;
  switch (spec.type) {
    case "int": return "number";
    case "year": return "year";
    case "yearRange":
      return Array.isArray(value) && value.length === 2 && value.every((y) => check({ ...spec, type: "year" }, y, thisYear)) ? "yearOrder" : "year";
    case "date": return "date";
    case "text": return "textChars";
    default: return "invalid";
  }
}

/** The entry's refused fields, by parameter name: each by its type, then resolveConfig's rules across fields. */
export function entryErrors(kind: Kind, entry: Entry, thisYear: number): Record<string, EntryError> {
  const specs = catalogue[kind][entry.type].params;
  const p = entry.params;
  const errors: Record<string, EntryError> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const error = isBlank(p[name]) ? null : paramError(spec, p[name], thisYear, catalogue.bands[entry.type] ?? []);
    if (error) errors[name] = error;
  }
  const has = (name: string) => !isBlank(p[name]);
  if (isFixed(entry)) {
    for (const name of ["start", "end"]) if (!has(name)) errors[name] ??= "dateRequired";
    if (!errors.start && !errors.end) {
      const days = (Date.parse(p.end as string) - Date.parse(p.start as string)) / 86400000;
      if (days <= 0) errors.end = "dateOrder";
      else if (days > MAX_WINDOW_DAYS) errors.end = "window";
    }
    for (const name of ["year", "years"]) if (has(name)) errors[name] ??= "yearOrWindow";
  }
  if (has("startYear") && has("endYear") && !errors.startYear && !errors.endYear && (p.startYear as number) > (p.endYear as number)) errors.endYear = "yearOrder";
  if (isCustom(entry) && !has("formula")) errors.formula ??= "formulaRequired";
  if (has("formula") && has("index") && p.index !== specs.index?.default) errors.formula ??= "indexOrFormula";
  return errors;
}

/** Whether the page may hand the document over: every field accepted and short enough to store. */
export const docValid = (doc: Doc, thisYear: number) =>
  serialiseDoc(doc).length <= EXPLORER_CONFIG_MAX &&
  (["layers", "charts"] as Kind[]).every((kind) => doc[kind].every((e) => Object.keys(entryErrors(kind, e, thisYear)).length === 0));

/** The entry's choices that differ from the standard, in a few words each (the row's summary). */
export function summarize(kind: Kind, entry: Entry): string[] {
  const p = entry.params;
  const out: string[] = [];
  for (const [name, spec] of Object.entries(catalogue[kind][entry.type].params)) {
    const v = p[name];
    if (isBlank(v) || v === spec.default) continue;
    if (name === "label") out.push(`“${v as string}”`);
    else if (name === "years" && Array.isArray(v)) out.push(ct("summary.years", { from: String(v[0]), to: String(v[1]) }));
    else if (name === "year") out.push(ct("summary.year", { year: String(v) }));
    else if (name === "startYear") out.push(isBlank(p.endYear) ? ct("summary.fromYear", { year: String(v) }) : ct("summary.years", { from: String(v), to: String(p.endYear) }));
    else if (name === "endYear" && isBlank(p.startYear)) out.push(ct("summary.toYear", { year: String(v) }));
    else if (name === "start") out.push(ct("summary.period", { start: v as string, end: String(p.end ?? "…") }));
    else if (name === "bands") out.push(v === "true-colour" ? ct("summary.trueColour") : String(v).toUpperCase());
    else if (name === "maxCloud") out.push(v === "any" ? ct("summary.noCloudLimit") : ct("summary.cloud", { n: String(v) }));
    else if (name === "index" && !isCustom(entry)) out.push(String(v));
    else if (name === "formula") out.push((p.name as string | undefined)?.trim() || t("config.customIndex"));
    else if (ANALYSES.includes(name)) {
      const analysis = ct(`analysis.${name}` as `analysis.median`);
      out.push(v === true ? analysis : ct("summary.off", { name: analysis }));
    } else if (name === "rainfall" && v === true) out.push(ct("summary.rainfall"));
    else if (name === "collapsed" && v === true) out.push(ct("summary.folded"));
    else if (name === "band") out.push(String(v));
    else if (name === "dataset") out.push(String(v).toUpperCase());
  }
  return out;
}

/**
 * The Explorer at `/` on the plot `geoJson` with the stored configuration `config`, as Collect Earth opens it;
 * `preview=1` keeps it off the person's stored choices (lib/prefs.ts).
 */
export function previewUrl(config: string, geoJson: string, lang?: string): string {
  const q = new URLSearchParams({ geoJson, plot_id: "Preview", preview: "1" });
  if (config) q.set("config", config);
  if (lang) q.set("lang", lang);
  return `/?${q}`;
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
