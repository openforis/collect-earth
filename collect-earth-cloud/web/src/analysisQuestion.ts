import type { AnalysisData } from "./api";
import type { MessageKey, Translate } from "./i18n";
import { quoteIdent, quoteString, type Cube, type CubeColumn, type ViewConfig } from "./analysisView";

// The analysis page's question bar (what Saiku's query toolbar was): "show <measures> by <rows> and <columns>, as
// <a table or chart>, where <filters>". It reads and writes Perspective's configuration, so the bar and Perspective's
// own panel stay one view: what is changed in one shows in the other. Pure, and tested; also the ready-made views
// worked out from the survey, the drill-through to the plots of a cell, and the view in a link.

/** A figure to show: a Perspective expression (named by its label) and how it is added up. */
export interface Measure {
  id: string;
  label: string;
  expression: string;
  aggregate: string;
  group: "plots" | "area" | "answers";
}

/** Perspective's expression for a column: its name in double quotes. */
const ref = (name: string) => `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The measures of a cube: the number of plots (or rows, for a nested table) and its shares, the area and its shares
 * when the project file has areas, and for each numeric question its average, total, smallest and largest value.
 */
export function measuresOf(cube: Cube, t: Translate): Measure[] {
  const out: Measure[] = [];
  const nested = cube.table !== "plot";
  const plot = cube.columns.find((c) => c.id === "_plot");
  const count = (id: string, key: MessageKey, aggregate: string) => out.push({ id, label: t(key), expression: "integer(1)", aggregate, group: "plots" });
  if (nested) {
    count("rows", "analysis.m.rows", "sum");
    if (plot) out.push({ id: "plots", label: t("analysis.m.plots"), expression: ref(plot.name), aggregate: "distinct count", group: "plots" });
    count("rowsPct", "analysis.m.rowsPct", "pct sum grand total");
    count("rowsPctParent", "analysis.m.rowsPctParent", "pct sum parent");
  } else {
    count("plots", "analysis.m.plots", "sum");
    count("plotsPct", "analysis.m.plotsPct", "pct sum grand total");
    count("plotsPctParent", "analysis.m.plotsPctParent", "pct sum parent");
  }
  const area = cube.columns.find((c) => c.id === "expansion_factor");
  if (area) {
    out.push({ id: "area", label: t("analysis.m.area"), expression: ref(area.name), aggregate: "sum", group: "area" });
    out.push({ id: "areaPct", label: t("analysis.m.areaPct"), expression: ref(area.name), aggregate: "pct sum grand total", group: "area" });
    out.push({ id: "areaPctParent", label: t("analysis.m.areaPctParent"), expression: ref(area.name), aggregate: "pct sum parent", group: "area" });
  }
  for (const c of cube.columns) {
    if (c.kind !== "number" || c.group === "area") continue;
    for (const [fn, key, aggregate] of [
      ["avg", "analysis.m.avg", "avg"],
      ["sum", "analysis.m.sum", "sum"],
      ["min", "analysis.m.min", "low"],
      ["max", "analysis.m.max", "high"],
    ] as const) {
      out.push({ id: `${fn}:${c.id}`, label: t(key, { label: c.name }), expression: ref(c.name), aggregate, group: "answers" });
    }
  }
  return out;
}

/** The ways to show a view: Perspective's plugins, by the names its configuration uses. */
export const CHARTS = [
  { id: "Datagrid", key: "analysis.chart.table" },
  { id: "Y Bar", key: "analysis.chart.bars" },
  { id: "X Bar", key: "analysis.chart.hbars" },
  { id: "Y Line", key: "analysis.chart.lines" },
  { id: "Y Area", key: "analysis.chart.area" },
  { id: "Treemap", key: "analysis.chart.treemap" },
  { id: "Sunburst", key: "analysis.chart.sunburst" },
  { id: "Heatmap", key: "analysis.chart.heatmap" },
] as const satisfies readonly { id: string; key: MessageKey }[];

export type Filter = [string, string, unknown];

export interface Question {
  /** The fields in the rows (Perspective's group_by), by their names. */
  rows: string[];
  /** The fields in the columns (split_by). */
  columns: string[];
  /** The measures shown, by their ids. */
  measures: string[];
  /** The columns shown that are no measure of the bar (chosen in Perspective's panel): kept as they are. */
  extra: string[];
  filters: Filter[];
  chart: string;
  /** The rows in the order of the first measure, largest first ("desc") or smallest first ("asc"), else by name. */
  order: "name" | "desc" | "asc";
}

/** The question a Perspective configuration asks (the bar shows it). */
export function questionOf(config: ViewConfig, measures: readonly Measure[]): Question {
  const byLabel = new Map(measures.map((m) => [m.label, m]));
  const ms: string[] = [];
  const extra: string[] = [];
  for (const c of config.columns ?? []) {
    if (c === null) continue;
    const m = byLabel.get(c);
    // a measure of the bar only when its expression is the bar's (a person may have named a column of theirs alike)
    if (m && config.expressions?.[c] === m.expression) ms.push(m.id);
    else extra.push(c);
  }
  const first = (config.columns ?? []).find((c): c is string => c !== null);
  const sort = (config.sort ?? []).find(([c]) => c === first);
  return {
    rows: [...(config.group_by ?? [])],
    columns: [...(config.split_by ?? [])],
    measures: ms,
    extra,
    filters: [...(config.filter ?? [])],
    chart: config.plugin ?? "Datagrid",
    order: sort ? (sort[1].startsWith("asc") ? "asc" : "desc") : "name",
  };
}

/**
 * A configuration asking the question: the configuration given with the bar's parts replaced (the rows, columns,
 * measures, filters, chart and order) and the rest kept (the person's own expressions, column widths, colours…).
 */
export function applyQuestion(config: ViewConfig, q: Question, measures: readonly Measure[]): ViewConfig {
  const byId = new Map(measures.map((m) => [m.id, m]));
  const chosen = q.measures.map((id) => byId.get(id)).filter((m): m is Measure => !!m);
  const ours = new Set(measures.map((m) => m.label));
  const expressions = Object.fromEntries(Object.entries(config.expressions ?? {}).filter(([k]) => !ours.has(k)));
  const aggregates = Object.fromEntries(Object.entries(config.aggregates ?? {}).filter(([k]) => !ours.has(k)));
  for (const m of chosen) {
    expressions[m.label] = m.expression;
    aggregates[m.label] = m.aggregate;
  }
  const columns = [...chosen.map((m) => m.label), ...q.extra];
  return {
    ...config,
    plugin: q.chart,
    group_by: [...q.rows],
    split_by: [...q.columns],
    columns,
    aggregates,
    expressions,
    filter: [...q.filters],
    sort: q.order === "name" || columns.length === 0 ? [] : [[columns[0], q.order]],
  };
}

/** The rows and columns swapped (Saiku's "swap axes"). */
export const swapAxes = (q: Question): Question => ({ ...q, rows: q.columns, columns: q.rows });

/** The filter on a field by a list of its values; none when the list is empty (everything). */
export function withValuesFilter(filters: readonly Filter[], column: string, values: readonly unknown[]): Filter[] {
  const others = filters.filter(([c, op]) => !(c === column && (op === "in" || op === "==")));
  return values.length ? [...others, [column, "in", [...values]]] : others;
}

/** The filter on a number or date field by a range: from and to, each optional. */
export function withRangeFilter(filters: readonly Filter[], column: string, from: unknown, to: unknown): Filter[] {
  const others = filters.filter(([c, op]) => !(c === column && (op === ">=" || op === "<=")));
  const out = [...others];
  if (from !== null && from !== undefined && from !== "") out.push([column, ">=", from]);
  if (to !== null && to !== undefined && to !== "") out.push([column, "<=", to]);
  return out;
}

/** The values a filter keeps of a field (for the bar's chips and the list of values): null when not by values. */
export function filterValues(filters: readonly Filter[], column: string): unknown[] | null {
  const f = filters.find(([c, op]) => c === column && (op === "in" || op === "=="));
  if (!f) return null;
  return f[1] === "in" ? (Array.isArray(f[2]) ? f[2] : [f[2]]) : [f[2]];
}

// --- drill-through: the plots behind a cell -------------------------------------------------------------------------

/** A value for SQL, of the column's kind (a date can come as a day's milliseconds from Perspective). */
function literal(column: CubeColumn, v: unknown): string {
  if (column.kind === "date") {
    if (typeof v === "number") return `CAST(epoch_ms(${Math.round(v)}) AS DATE)`;
    return `CAST(${quoteString(String(v))} AS DATE)`;
  }
  if (column.kind === "number") return Number.isFinite(Number(v)) ? String(Number(v)) : "NULL";
  if (column.kind === "boolean") return v === true || v === "true" ? "TRUE" : "FALSE";
  return quoteString(String(v));
}

/**
 * The SQL condition of Perspective's filters over a cube (the drill-through asks DuckDB for the plots of a cell with
 * the filters Perspective gives for it). Filters on what the cube does not have (the person's own expressions) are
 * left out, and `partial` says so.
 */
export function whereSql(cube: Cube, filters: readonly Filter[]): { sql: string; partial: boolean } {
  const byName = new Map(cube.columns.map((c) => [c.name, c]));
  const parts: string[] = [];
  let partial = false;
  for (const [name, op, v] of filters) {
    const c = byName.get(name);
    if (!c) {
      partial = true;
      continue;
    }
    const col = quoteIdent(c.name);
    const list = (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined);
    switch (op) {
      case "==":
        parts.push(v === null || v === undefined ? `${col} IS NULL` : `${col} = ${literal(c, v)}`);
        break;
      case "!=":
        parts.push(v === null || v === undefined ? `${col} IS NOT NULL` : `${col} IS DISTINCT FROM ${literal(c, v)}`);
        break;
      case "in":
        parts.push(list.length ? `${col} IN (${list.map((x) => literal(c, x)).join(", ")})` : "FALSE");
        break;
      case "not in":
        if (list.length) parts.push(`(${col} IS NULL OR ${col} NOT IN (${list.map((x) => literal(c, x)).join(", ")}))`);
        break;
      case ">":
      case "<":
      case ">=":
      case "<=":
        parts.push(`${col} ${op} ${literal(c, v)}`);
        break;
      case "is null":
        parts.push(`${col} IS NULL`);
        break;
      case "is not null":
        parts.push(`${col} IS NOT NULL`);
        break;
      case "contains":
        parts.push(`contains(CAST(${col} AS VARCHAR), ${quoteString(String(v))})`);
        break;
      case "begins with":
        parts.push(`starts_with(CAST(${col} AS VARCHAR), ${quoteString(String(v))})`);
        break;
      case "ends with":
        parts.push(`ends_with(CAST(${col} AS VARCHAR), ${quoteString(String(v))})`);
        break;
      default:
        partial = true;
    }
  }
  return { sql: parts.length ? parts.join(" AND ") : "TRUE", partial };
}

/** The columns a drill-through lists: the plot and who collected it, the view's fields, then what its measures read. */
export function drillColumns(cube: Cube, q: Question, measures: readonly Measure[]): string[] {
  const names = new Set(cube.columns.map((c) => c.name));
  const byId = new Map(cube.columns.map((c) => [c.id, c.name]));
  const out: string[] = [];
  const add = (n: string | undefined) => {
    if (n && names.has(n) && !out.includes(n)) out.push(n);
  };
  add(byId.get("_plot"));
  add(byId.get("_operator"));
  add(byId.get("_saved_on"));
  for (const n of [...q.rows, ...q.columns]) add(n);
  const byMeasure = new Map(measures.map((m) => [m.id, m]));
  for (const id of q.measures) {
    const m = byMeasure.get(id);
    const name = m?.expression.match(/^"((?:[^"\\]|\\.)*)"$/)?.[1]?.replace(/\\(.)/g, "$1");
    add(name);
  }
  return out;
}

/** The SQL of a drill-through: the rows of the cube in the cell, at most `limit` (null: all of them, for a download). */
export function drillSql(cube: Cube, filters: readonly Filter[], columns: readonly string[], limit: number | null): string {
  const where = whereSql(cube, filters).sql;
  const plot = cube.columns.find((c) => c.id === "_plot")?.name;
  const order = plot ? ` ORDER BY TRY_CAST(${quoteIdent(plot)} AS BIGINT) NULLS LAST, ${quoteIdent(plot)}` : "";
  return `SELECT ${columns.map(quoteIdent).join(", ")} FROM (${cube.sql}) AS cube WHERE ${where}${order}${limit === null ? "" : ` LIMIT ${limit}`}`;
}

export function drillCountSql(cube: Cube, filters: readonly Filter[]): string {
  return `SELECT count(*) AS n FROM (${cube.sql}) AS cube WHERE ${whereSql(cube, filters).sql}`;
}

/** The distinct values of a field with how many rows have each, for a filter's list (most frequent first). */
export function valuesSql(cube: Cube, column: string, filters: readonly Filter[], limit: number): string {
  // the other filters apply, as in Saiku's member list: the values left to choose from
  const others = filters.filter(([c]) => c !== column);
  return `SELECT ${quoteIdent(column)} AS value, count(*) AS n FROM (${cube.sql}) AS cube WHERE ${whereSql(cube, others).sql} AND ${quoteIdent(column)} IS NOT NULL GROUP BY 1 ORDER BY n DESC, 1 LIMIT ${limit}`;
}

// --- ready-made views ---------------------------------------------------------------------------------------------

export interface Template {
  id: string;
  label: string;
  question: Question;
}

const REGION = /region|province|district|stratum|strata|zone|county|state|department|admin|municip|ecozone|ecoregion/i;

/**
 * Views ready to open, worked out from the survey, as the first things a Collect Earth analyst asks: the plots and
 * the area by land use; by region (a field of the plot file); the land use change between two questions on the same
 * list (a change matrix); an average by land use; and, for coordinators, the work by collector and over time.
 */
export function templatesOf(data: Pick<AnalysisData, "model" | "scope" | "areas">, cube: Cube, measures: readonly Measure[], t: Translate): Template[] {
  const nested = cube.table !== "plot";
  const has = new Set(measures.map((m) => m.id));
  const name = (id: string) => cube.columns.find((c) => c.id === id)?.name;
  const assessment = name("_assessment");
  const firsts: Filter[] = assessment && data.scope === "project" ? [[assessment, "==", t("analysis.assessment.main")]] : [];
  const q = (rows: (string | undefined)[], columns: (string | undefined)[], ms: string[], chart = "Datagrid", filters = firsts, order: Question["order"] = "name"): Question => ({
    rows: rows.filter((x): x is string => !!x),
    columns: columns.filter((x): x is string => !!x),
    measures: ms.filter((m) => has.has(m)),
    extra: [],
    filters,
    chart,
    order,
  });
  const out: Template[] = [];
  const plotTable = data.model.tables.find((x) => x.name === "plot")!;

  if (nested) {
    const tm = data.model.tables.find((x) => x.name === cube.table)!;
    const key = name(tm.keyColumn ?? "") ?? cube.columns.find((c) => c.group === "entity" && c.kind === "text")?.name;
    out.push({ id: "default", label: t("analysis.tpl.rowsBy", { field: key ?? "" }), question: q([key], [], ["rows", "plots"]) });
    const lu = landUse(plotTable.columns, "plot.");
    if (key && lu && name(lu)) out.push({ id: "byLandUse", label: t("analysis.tpl.byTwo", { a: key, b: name(lu)! }), question: q([key], [name(lu)], ["rows"]) });
    for (const c of cube.columns.filter((x) => x.group === "entity" && x.kind === "number").slice(0, 2)) {
      out.push({ id: `avg:${c.id}`, label: t("analysis.tpl.avgBy", { measure: c.name, field: key ?? "" }), question: q([key], [], [`avg:${c.id}`]) });
    }
    return out;
  }

  const luId = landUse(plotTable.columns, "");
  const lu = luId ? name(luId) : undefined;
  const size = has.has("area") ? ["area", "areaPct"] : ["plots", "plotsPct"];
  out.push({ id: "default", label: t(has.has("area") ? "analysis.tpl.default" : "analysis.tpl.defaultPlots", { field: lu ?? "" }), question: q([lu], [], has.has("area") ? ["plots", "area", "areaPct"] : ["plots", "plotsPct"], "Datagrid", firsts, "desc") });
  const region = cube.columns.find((c) => c.group === "plotFile" && c.kind === "text" && REGION.test(c.id));
  if (region && lu) out.push({ id: "byRegion", label: t("analysis.tpl.byTwo", { a: lu, b: region.name }), question: q([lu], [region.name], [size[0]]) });
  // A change matrix for each pair of questions answered from the same list (land use now and before…), at most three
  const byList = new Map<string, string[]>();
  for (const c of plotTable.columns) {
    if (c.type !== "code" || !c.list || c.multiple || c.fromPlotFile || !name(c.name)) continue;
    byList.set(c.list, [...(byList.get(c.list) ?? []), c.name]);
  }
  let pairs = 0;
  for (const ids of byList.values()) {
    for (let i = 1; i < ids.length && pairs < 3; i++, pairs++) {
      const a = name(ids[0])!;
      const b = name(ids[i])!;
      out.push({ id: `change:${ids[0]}:${ids[i]}`, label: t("analysis.tpl.change", { a, b }), question: q([a], [b], [size[0]]) });
    }
  }
  const numeric = cube.columns.find((c) => c.group === "survey" && c.kind === "number");
  if (numeric && lu) out.push({ id: `avg:${numeric.id}`, label: t("analysis.tpl.avgBy", { measure: numeric.name, field: lu }), question: q([lu], [], [`avg:${numeric.id}`]) });
  if (data.scope === "project") {
    out.push({ id: "byCollector", label: t("analysis.tpl.byCollector"), question: q([name("_operator")], [name("_saved_month")], ["plots"], "Datagrid", []) });
    out.push({ id: "perWeek", label: t("analysis.tpl.perWeek"), question: q([name("_saved_week")], [assessment], ["plots"], "Y Bar", []) });
  } else {
    out.push({ id: "perWeek", label: t("analysis.tpl.myWeeks"), question: q([name("_saved_week")], [], ["plots"], "Y Bar", []) });
  }
  return out;
}

/** The survey's land use question: land_use_category, else its first code question not from the plot file. */
function landUse(columns: AnalysisData["model"]["tables"][number]["columns"], prefix: string): string | undefined {
  const c = columns.find((x) => x.name === "land_use_category") ?? columns.find((x) => x.type === "code" && !!x.list && !x.fromPlotFile && !x.multiple);
  return c ? `${prefix}${c.name}` : undefined;
}

// --- a view in a link -----------------------------------------------------------------------------------------------

export interface LinkedView {
  table: string;
  language: string;
  config: ViewConfig;
}

/** A view as the part of a link after "#view=" (base64url of its JSON). */
export function encodeView(view: LinkedView): string {
  const bytes = new TextEncoder().encode(JSON.stringify(view));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The view of a link, or null when it is not one. */
export function decodeView(text: string | null | undefined): LinkedView | null {
  if (!text) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as LinkedView;
    if (!v || typeof v.table !== "string" || typeof v.language !== "string" || !v.config || typeof v.config !== "object") return null;
    return v;
  } catch {
    return null;
  }
}
