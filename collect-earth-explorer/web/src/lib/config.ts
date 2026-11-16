import catalogueJson from "../../../functions/catalogue.json";

type Spec = { type: string; min?: number; max?: number; values?: unknown[]; default?: unknown };
type Kind = "layers" | "charts";
type Entry = { type: string; params: Record<string, unknown> };
export type LayerEntry = Entry;
export type ChartEntry = Entry;

const catalogue = catalogueJson as unknown as Record<Kind, Record<string, { params: Record<string, Spec> }>> & {
  standard: Record<Kind, object[]>;
};

const isDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);

// Mirrors functions/lib/catalogue.js paramOf: the server is the authority, this only decides what to draw.
function check(spec: Spec, value: unknown, maxYear: number): boolean {
  const isYear = (y: unknown) => Number.isInteger(y) && (y as number) >= spec.min! && (y as number) <= maxYear;
  switch (spec.type) {
    case "choice": return spec.values!.includes(value);
    case "int": return Number.isInteger(value) && (value as number) >= spec.min! && (value as number) <= spec.max!;
    case "date": return isDate(value);
    case "year": return isYear(value);
    case "yearRange": return Array.isArray(value) && value.length === 2 && value.every(isYear) && value[0] <= value[1];
    case "bool": return value === true || value === false;
    case "text": return typeof value === "string" && value.length <= spec.max!;
    default: return false;
  }
}

const singular = { layers: "Layer", charts: "Chart" };

/** One entry with every default filled in, or a notice saying why it is skipped. */
function resolveEntry(kind: Kind, raw: unknown, maxYear: number): Entry | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return `${singular[kind]} skipped: not an object.`;
  const { type, ...given } = raw as Record<string, unknown>;
  if (typeof type !== "string" || !Object.hasOwn(catalogue[kind], type)) return `${singular[kind]} "${type}" skipped: unknown type.`;
  const specs = catalogue[kind][type].params;
  const params: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(given)) {
    if (!Object.hasOwn(specs, name)) return `${singular[kind]} "${type}" skipped: unknown parameter ${name}.`;
    if (!check(specs[name], value, maxYear)) return `${singular[kind]} "${type}" skipped: ${name} is not valid.`;
    params[name] = value;
  }
  // Same rule as the API: a composite window needs both dates, start before end.
  if (type === "sentinel2" && ("start" in params || "end" in params) && !((params.start as string) < (params.end as string)))
    return `${singular[kind]} "${type}" skipped: start and end must both be given, start before end.`;
  for (const [name, spec] of Object.entries(specs)) if (!(name in params) && spec.default !== undefined) params[name] = spec.default;
  return { type, params };
}

/** The layer entry's parameters among `names` that differ from the catalogue default (what a request needs to send). */
export function nonDefault(entry: LayerEntry, names: string[]): Record<string, unknown> {
  const specs = catalogue.layers[entry.type].params;
  return Object.fromEntries(names.filter((n) => entry.params[n] !== undefined && entry.params[n] !== specs[n].default).map((n) => [n, entry.params[n]]));
}

function resolveHalf(kind: Kind, list: unknown, maxYear: number, notices: string[]): Entry[] {
  const standard = () => catalogue.standard[kind].map((e) => resolveEntry(kind, e, maxYear) as Entry);
  if (list === undefined) return standard();
  if (!Array.isArray(list)) {
    notices.push(`The configuration's ${kind} are not a list; the standard ones are shown.`);
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
      notices.push("The survey's configuration could not be read; the standard one is shown.");
    } else if ((parsed as Record<string, unknown>).v !== undefined && (parsed as Record<string, unknown>).v !== 1) {
      notices.push(`Configuration version ${JSON.stringify((parsed as Record<string, unknown>).v)} is not supported; the standard one is shown.`);
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
