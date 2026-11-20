import catalogueJson from "../../../functions/catalogue.json";
import type { PlotBody } from "./api";
import { t, type Key } from "./i18n";

export type Spec = { type: string; min?: number; max?: number; values?: unknown[]; default?: unknown };
type Kind = "layers" | "charts";
type Entry = { type: string; params: Record<string, unknown> };
export type LayerEntry = Entry;
export type ChartEntry = Entry;

const catalogue = catalogueJson as unknown as Record<Kind, Record<string, { params: Record<string, Spec> }>> & {
  standard: Record<Kind, object[]>;
  bands: Record<string, string[]>;
};

const isDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);

// Mirrors functions/lib/catalogue.js paramOf: the server is the authority, this only decides what to draw.
export function check(spec: Spec, value: unknown, maxYear: number): boolean {
  const isYear = (y: unknown) => Number.isInteger(y) && (y as number) >= spec.min! && (y as number) <= maxYear;
  switch (spec.type) {
    case "choice": return spec.values!.includes(value);
    case "int": return Number.isInteger(value) && (value as number) >= spec.min! && (value as number) <= spec.max!;
    case "date": return isDate(value);
    case "year": return isYear(value);
    case "yearRange": return Array.isArray(value) && value.length === 2 && value.every(isYear) && value[0] <= value[1];
    case "bool": return value === true || value === false;
    case "text": return typeof value === "string" && value.length <= spec.max! && !/[<>]/.test(value);
    case "formula": return typeof value === "string" && value.length <= spec.max!;
    default: return false;
  }
}

const FUNCTIONS = ["sqrt", "abs", "min", "max", "pow"];
const TOKEN = /\s+|(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_]\w*)|([-+*/(),])/y;

/** Normalised as the API keys it: without any whitespace. */
export const normaliseFormula = (text: string) => text.replace(/\s+/g, "");

// Mirrors functions/lib/formula.js checkFormula (true instead of returning, false instead of throwing).
export function formulaOk(text: unknown, bands: string[]): boolean {
  if (typeof text !== "string" || text.length > 200 || text.trim() === "") return false;
  let prev = "start", depth = 0, usesBand = false, pos = 0;
  while (pos < text.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) return false;
    const [, number, name, symbol] = m;
    const afterOperand = prev === "operand";
    if (number === undefined && name === undefined && symbol === undefined) {
      // whitespace
    } else if (FUNCTIONS.includes(prev) && symbol !== "(") return false;
    else if (number !== undefined || name !== undefined) {
      if (afterOperand) return false;
      if (name !== undefined && FUNCTIONS.includes(name)) prev = name;
      else {
        if (name !== undefined && !bands.includes(name)) return false;
        if (name !== undefined) usesBand = true;
        prev = "operand";
      }
    } else if (symbol === "(") {
      if (afterOperand) return false;
      depth++;
      prev = "(";
    } else if (symbol === ")") {
      if (!afterOperand || --depth < 0) return false;
      prev = "operand";
    } else if (symbol === ",") {
      if (!afterOperand || depth === 0) return false;
      prev = ",";
    } else {
      if (!afterOperand && symbol !== "-") return false;
      prev = "operator";
    }
    pos = TOKEN.lastIndex;
  }
  return depth === 0 && prev === "operand" && usesBand;
}

/** The notice for a skipped entry of `type`: `reason` (a key, with its `params`). */
const skipped = (kind: Kind, type: unknown, reason: Key, params?: Record<string, string>) =>
  t(kind === "layers" ? "notice.layerTypeSkipped" : "notice.chartTypeSkipped", { type: String(type), reason: t(reason, params) });

/** One entry with every default filled in, or a notice saying why it is skipped. */
function resolveEntry(kind: Kind, raw: unknown, maxYear: number): Entry | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return t(kind === "layers" ? "notice.layerSkipped" : "notice.chartSkipped", { reason: t("reason.notObject") });
  const { type, ...given } = raw as Record<string, unknown>;
  if (typeof type !== "string" || !Object.hasOwn(catalogue[kind], type)) return skipped(kind, type, "reason.unknownType");
  const specs = catalogue[kind][type].params;
  const params: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(given)) {
    if (!Object.hasOwn(specs, name)) return skipped(kind, type, "reason.unknownParam", { name });
    if (!check(specs[name], value, maxYear)) return skipped(kind, type, "reason.invalidParam", { name });
    params[name] = value;
  }
  // Same rule as the API: a composite window needs both dates, start before end.
  if (type === "sentinel2" && ("start" in params || "end" in params) && !((params.start as string) < (params.end as string)))
    return skipped(kind, type, "reason.window");
  // A year slider (year, years) and a fixed window (start, end) exclude each other; the API never sees year or years.
  if (type === "sentinel2" && "start" in params && ("year" in params || "years" in params))
    return skipped(kind, type, "reason.yearOrWindow");
  // Same cap as the API (routes.js MAX_WINDOW_DAYS).
  if (type === "sentinel2" && "start" in params && Date.parse(params.end as string) - Date.parse(params.start as string) > 1096 * 86400000)
    return skipped(kind, type, "reason.windowLength");
  // Same rules as the API's series routes: the formula is checked against the sensor's bands, and excludes another index.
  if ("formula" in params) {
    if (params.index !== undefined && params.index !== specs.index.default) return skipped(kind, type, "reason.indexOrFormula");
    if (!formulaOk(params.formula, catalogue.bands[type])) return skipped(kind, type, "reason.formula");
  }
  for (const [name, spec] of Object.entries(specs)) if (!(name in params) && spec.default !== undefined) params[name] = spec.default;
  return { type, params };
}

/** The layer entry's parameters among `names` that differ from the catalogue default (what a request needs to send). */
export function nonDefault(entry: LayerEntry, names: string[]): Record<string, unknown> {
  const specs = catalogue.layers[entry.type].params;
  return Object.fromEntries(names.filter((n) => entry.params[n] !== undefined && entry.params[n] !== specs[n].default).map((n) => [n, entry.params[n]]));
}

const CHART_PATHS: Record<string, string> = {
  ccdc: "ccdc",
  "landsat-series": "series/landsat",
  "sentinel2-series": "series/sentinel2",
  modis: "series/modis",
  "sentinel1-series": "series/sentinel1",
  precipitation: "series/precipitation",
};

/**
 * The API path and body of a chart entry's request for a plot. The cards and the next-plot warm-up
 * both build theirs here, so the warm-up hits the server key the card will use.
 */
export function chartRequest(entry: ChartEntry, p: PlotBody): { path: string; body: PlotBody & Record<string, unknown> } {
  const { band, index, formula } = entry.params;
  const extra = entry.type === "ccdc" || entry.type === "sentinel1-series" ? { band } : formula !== undefined ? { formula: normaliseFormula(formula as string) } : index !== undefined && index !== "NDVI" ? { index } : {};
  return { path: CHART_PATHS[entry.type], body: { ...p, ...extra } };
}

/** What a Landsat or Sentinel-2 series chart is called after its sensor: the index, or the custom formula's name, else `custom`. */
export const indexLabel = (params: ChartEntry["params"], custom = t("config.customIndex")) =>
  params.formula === undefined ? (params.index as string) : (params.name as string | undefined) || custom;

/** The allowed values of a layer type's choice parameter `name`, from the catalogue. */
export const layerChoices = (type: string, name: string) => catalogue.layers[type].params[name].values as string[];

/** The years an entry's slider offers: its `years`, else its type's first year to the plot's end year. */
export function yearRange(entry: LayerEntry, end: string): [number, number] {
  return (entry.params.years as [number, number] | undefined) ?? [catalogue.layers[entry.type].params.year.min!, new Date(end).getUTCFullYear()];
}

function resolveHalf(kind: Kind, list: unknown, maxYear: number, notices: string[]): Entry[] {
  const standard = () => catalogue.standard[kind].map((e) => resolveEntry(kind, e, maxYear) as Entry);
  if (list === undefined) return standard();
  if (!Array.isArray(list)) {
    notices.push(t(kind === "layers" ? "notice.layersNotList" : "notice.chartsNotList"));
    return standard();
  }
  // An explicit empty chart list is honoured; a map always needs imagery.
  if (list.length === 0) return kind === "charts" ? [] : standard();
  const entries: Entry[] = [];
  for (const raw of list) {
    const r = resolveEntry(kind, raw, maxYear);
    if (typeof r === "string") notices.push(r);
    else entries.push(r);
  }
  return entries.length ? entries : standard();
}

/** The survey's layers and charts from its configuration document, falling back to the standard configuration. */
export function resolveConfig(text: string | undefined, maxYear: number): { layers: LayerEntry[]; charts: ChartEntry[]; notices: string[] } {
  const notices: string[] = [];
  let doc: Record<string, unknown> = {};
  if (text !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      notices.push(t("notice.unreadable"));
    } else if ((parsed as Record<string, unknown>).v !== undefined && (parsed as Record<string, unknown>).v !== 1) {
      notices.push(t("notice.version", { v: JSON.stringify((parsed as Record<string, unknown>).v) }));
    } else {
      doc = parsed as Record<string, unknown>;
    }
  }
  return {
    layers: resolveHalf("layers", doc.layers, maxYear, notices),
    charts: resolveHalf("charts", doc.charts, maxYear, notices),
    notices,
  };
}
