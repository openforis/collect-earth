import type { AnalysisData, AnalysisModelData, AnalysisTableModel } from "./api";
import type { MessageKey, Translate } from "./i18n";
import { applyQuestion, measuresOf, templatesOf } from "./analysisQuestion";

// The analysis page (docs/plans/2026-11-05-node-and-arena.md, stage 6a: what replaces Saiku). The server sends the
// survey's model and the rows of its tables (src/analysis.ts there); the browser loads them into DuckDB and pivots
// them with Perspective (src/analysisEngine.ts). What is here is pure, and tested: the "cube" of each table (its
// columns named by their labels in the dashboard's language, every code with its label and the levels above it, as
// Saiku's joins to the code tables gave), the default view, and the saved views, which keep working when the
// language changes (their column names are translated).

/** A column of a cube: its stable id (what a saved view is kept with) and the name the person sees. */
export interface CubeColumn {
  id: string;
  name: string;
  /** The SQL that gives it, over the table aliased "t" (an entity's plot: "p") and the code tables "c<n>". */
  sql: string;
  /** For a column of labels: each value's label by its code, to translate a filter's values with the column's name. */
  values?: Record<string, string>;
  /** What its values are: how they are filtered (a list of values, or a range) and added up. */
  kind: ColumnKind;
  /** Where it comes from, to list the fields in groups as Saiku's dimension tree. */
  group: ColumnGroup;
}

export type ColumnKind = "text" | "number" | "boolean" | "date";
/** collection: what Collect Earth Cloud knows of the record; plotFile: from the plot file; survey: the plot's answers; entity: the nested table's own; area: the areas. */
export type ColumnGroup = "collection" | "plotFile" | "survey" | "entity" | "area";

const KIND_OF_TYPE: Record<string, ColumnKind> = { code: "text", boolean: "boolean", integer: "number", real: "number", text: "text", date: "date", time: "text" };

export interface Cube {
  /** The table's name in the model ("plot", or the multiple entity's). */
  table: string;
  columns: CubeColumn[];
  /** The query that gives the cube, for DuckDB. */
  sql: string;
}

/** A label in a language: the survey's own in that language, else its default language's, else any, else the name. */
export function labelIn(labels: Record<string, string> | undefined, language: string, model: Pick<AnalysisModelData, "languages">, fallback: string): string {
  if (!labels) return fallback;
  const pick = labels[language] || labels[model.languages[0] ?? ""] || labels[""] || Object.values(labels).find((l) => l);
  return pick?.trim() || fallback;
}

/** A name for SQL: in double quotes, any double quote doubled. */
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** A string for SQL: in single quotes, any single quote doubled. */
export const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The deepest level of each list (0 for a flat list). */
export function listDepths(model: AnalysisModelData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [list, items] of Object.entries(model.lists)) out[list] = items.reduce((m, i) => Math.max(m, i.level), 0);
  return out;
}

/**
 * The code tables, as one CSV for DuckDB: for every item of every list, its label in the language and the label of
 * the item at each level above it (or its own, at its own level). A code's label is then one join, whatever the depth.
 */
export function codesCsv(model: AnalysisModelData, language: string): { csv: string; columns: [string, string][] } {
  const depth = Math.max(0, ...Object.values(listDepths(model)));
  const columns: [string, string][] = [["list", "VARCHAR"], ["code", "VARCHAR"], ["label", "VARCHAR"]];
  for (let k = 0; k < depth; k++) columns.push([`level_${k}`, "VARCHAR"]);
  const lines = [columns.map(([n]) => n).join(",")];
  for (const [list, items] of Object.entries(model.lists)) {
    const byCode = new Map(items.map((i) => [i.code, i]));
    for (const item of items) {
      const label = labelIn(item.labels, language, model, item.code);
      const levels: string[] = Array.from({ length: depth }, () => "");
      // Up the hierarchy (a loop in a broken list stops at the depth)
      let at: typeof item | undefined = item;
      for (let guard = 0; at && guard <= depth; guard++) {
        if (at.level < depth) levels[at.level] = labelIn(at.labels, language, model, at.code);
        at = at.parent !== null ? byCode.get(at.parent) : undefined;
      }
      lines.push([list, item.code, label, ...levels].map(csvField).join(","));
    }
  }
  return { csv: lines.join("\n") + "\n", columns };
}

export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The fixed columns: what Collect Earth Cloud knows of each record, beside its answers. */
const FIXED: { id: string; key: MessageKey; sql: (alias: string, t: Translate) => string; kind: ColumnKind; rounds?: boolean; values?: (t: Translate) => Record<string, string> }[] = [
  { id: "_plot", key: "analysis.col.plot", sql: (a) => `${a}._plot`, kind: "text" },
  { id: "_operator", key: "analysis.col.operator", sql: (a) => `${a}._operator`, kind: "text" },
  { id: "_round", key: "analysis.col.round", sql: (a) => `${a}._round`, kind: "text", rounds: true },
  {
    id: "_assessment",
    key: "analysis.col.assessment",
    sql: (a, t) =>
      `CASE ${a}._assessment WHEN 'main' THEN ${quoteString(t("analysis.assessment.main"))} WHEN 'check' THEN ${quoteString(t("analysis.assessment.check"))} WHEN 'other' THEN ${quoteString(t("analysis.assessment.other"))} END`,
    kind: "text",
    rounds: true,
    values: (t) => ({ main: t("analysis.assessment.main"), check: t("analysis.assessment.check"), other: t("analysis.assessment.other") }),
  },
  { id: "_submitted", key: "analysis.col.submitted", sql: (a) => `${a}._submitted`, kind: "boolean" },
  { id: "_saved_on", key: "analysis.col.savedOn", sql: (a) => `${a}._saved_on`, kind: "date" },
  // The month and the week, to follow the work over time (Saiku split the save date into year, month and day)
  { id: "_saved_month", key: "analysis.col.savedMonth", sql: (a) => `strftime(${a}._saved_on, '%Y-%m')`, kind: "text" },
  { id: "_saved_week", key: "analysis.col.savedWeek", sql: (a) => `strftime(${a}._saved_on, '%G-W%V')`, kind: "text" },
];

/**
 * The cube of a table: for the plot, its columns; for a multiple entity, its columns and then the plot's (each row is
 * an entity, with the answers of the plot it is in, as Saiku's cube of a nested entity).
 */
export function cubeOf(data: Pick<AnalysisData, "model" | "scope" | "areas">, tableName: string, language: string, t: Translate): Cube {
  const { model } = data;
  const plot = model.tables.find((x) => x.name === "plot");
  const table = model.tables.find((x) => x.name === tableName) ?? plot;
  if (!plot || !table) throw new Error(`No table ${tableName}`);
  const depths = listDepths(model);
  const columns: CubeColumn[] = [];
  const joins: string[] = [];
  const used = new Set<string>();
  const unique = (name: string, alt: string) => {
    let out = name;
    if (used.has(out)) out = `${name} (${alt})`;
    for (let n = 2; used.has(out); n++) out = `${name} (${alt} ${n})`;
    used.add(out);
    return out;
  };
  const add = (id: string, name: string, alt: string, sql: string, kind: ColumnKind, group: ColumnGroup, values?: Record<string, string>) =>
    columns.push({ id, name: unique(name, alt), sql, kind, group, ...(values ? { values } : {}) });
  const labelsOfList = (list: string) => Object.fromEntries(model.lists[list].map((i) => [i.code, labelIn(i.labels, language, model, i.code)]));

  const answers = (tm: AnalysisTableModel, alias: string, idPrefix: string, ownGroup: ColumnGroup) => {
    for (const c of tm.columns) {
      const group: ColumnGroup = c.fromPlotFile ? "plotFile" : ownGroup;
      const label = labelIn(c.labels, language, model, c.name);
      const id = `${idPrefix}${c.name}`;
      const col = `${alias}.${quoteIdent(c.name)}`;
      if (c.type === "code" && c.list && model.lists[c.list]?.length && !c.multiple) {
        const j = `c${joins.length}`;
        joins.push(`LEFT JOIN _codes ${j} ON ${j}.list = ${quoteString(c.list)} AND ${j}.code = ${col}`);
        const values = labelsOfList(c.list);
        add(id, label, c.name, `COALESCE(${j}.label, ${col})`, "text", group, values);
        add(`${id}#code`, t("analysis.code", { label }), c.name, col, "text", group);
        for (let k = 0; k < (depths[c.list] ?? 0); k++) add(`${id}#${k}`, t("analysis.level", { label, level: k + 1 }), c.name, `${j}.level_${k}`, "text", group, values);
      } else {
        add(id, label, c.name, col, c.multiple ? "text" : (KIND_OF_TYPE[c.type] ?? "text"), group);
      }
    }
  };

  const nested = table.name !== "plot";
  if (nested) answers(table, "t", "", "entity");
  const plotAlias = nested ? "p" : "t";
  for (const f of FIXED) {
    if (f.rounds && data.scope === "own") continue;
    add(f.id, t(f.key), f.id, f.sql(plotAlias, t), f.kind, "collection", f.values?.(t));
  }
  answers(plot, plotAlias, nested ? "plot." : "", "survey");
  if (data.areas && !nested) {
    add("expansion_factor", t("analysis.col.area"), "expansion_factor", `${plotAlias}.expansion_factor`, "number", "area");
    add("plot_weight", t("analysis.col.weight"), "plot_weight", `${plotAlias}.plot_weight`, "number", "area");
  }
  const from = nested ? `${quoteIdent(table.name)} t JOIN plot p ON p._record = t._record` : "plot t";
  const sql = `SELECT ${columns.map((c) => `${c.sql} AS ${quoteIdent(c.name)}`).join(", ")} FROM ${from} ${joins.join(" ")}`;
  return { table: table.name, columns, sql };
}

/** The tables the person can choose: the plots, then each multiple entity, by their labels. */
export function tableChoices(model: AnalysisModelData, language: string, t: Translate): { name: string; label: string }[] {
  return model.tables.map((x) => ({ name: x.name, label: x.name === "plot" ? t("analysis.table.plot") : labelIn(x.labels, language, model, x.name) }));
}

/** A Perspective view's configuration (what viewer.save() gives and viewer.restore() takes): only what is used here. */
export interface ViewConfig {
  plugin?: string;
  group_by?: string[];
  split_by?: string[];
  columns?: (string | null)[];
  aggregates?: Record<string, unknown>;
  filter?: [string, string, unknown][];
  sort?: [string, string][];
  expressions?: Record<string, string>;
  [other: string]: unknown;
}

/**
 * The view the page opens with, as a Saiku user would start: the first ready-made view (the plots and the area by
 * land use, largest first; for coordinators the first assessments only, as the quality checks are other people's
 * answers for the same plots). Perspective's panel starts closed: the question bar above it is the way in.
 */
export function defaultView(data: Pick<AnalysisData, "model" | "scope" | "areas">, cube: Cube, t: Translate): ViewConfig {
  const measures = measuresOf(cube, t);
  const [first] = templatesOf(data, cube, measures, t);
  return applyQuestion({ plugin: "Datagrid", settings: false, group_by: [], split_by: [], columns: [], aggregates: {}, filter: [], sort: [], expressions: {} }, first.question, measures);
}

/**
 * A view fitted to the cube it is opened on: what names a column the cube does not have is left out (a coordinator's
 * view shared with collectors filters on the assessment, which a collector's table has not; a column renamed in a new
 * version of the survey), as are the person's own expressions reading such a column. Perspective refuses a view
 * naming an unknown column.
 */
export function fitToCube(config: ViewConfig, cube: Cube): ViewConfig {
  const known = new Set(cube.columns.map((c) => c.name));
  const expressions = Object.fromEntries(
    Object.entries(config.expressions ?? {}).filter(([, e]) => [...e.matchAll(/"((?:[^"\\]|\\.)*)"/g)].every((m) => known.has(m[1].replace(/\\(.)/g, "$1")))),
  );
  const ok = (n: string | null) => n === null || known.has(n) || n in expressions;
  return {
    ...config,
    expressions,
    group_by: (config.group_by ?? []).filter(ok),
    split_by: (config.split_by ?? []).filter(ok),
    columns: (config.columns ?? []).filter(ok),
    filter: (config.filter ?? []).filter(([c]) => ok(c)),
    sort: (config.sort ?? []).filter(([c]) => ok(c)),
    ...(config.aggregates ? { aggregates: Object.fromEntries(Object.entries(config.aggregates).filter(([k]) => ok(k))) } : {}),
  };
}

/** A view the person saved: its name, the table, and the configuration in the language it was saved in. */
export interface SavedView {
  name: string;
  table: string;
  language: string;
  config: ViewConfig;
}

/**
 * A view's configuration with its column names in another language (or with other labels): each name the `from`
 * cube has is replaced by the `to` cube's name for the same column; names neither has (the person's own
 * expressions) are kept.
 */
export function translateView(config: ViewConfig, from: Cube, to: Cube): ViewConfig {
  const toById = new Map(to.columns.map((c) => [c.id, c.name]));
  const map = new Map<string, string>();
  for (const c of from.columns) {
    const name = toById.get(c.id);
    if (name !== undefined) map.set(c.name, name);
  }
  const name = (n: string) => map.get(n) ?? n;
  // A filter's values on a column of labels: the same item's label in the other language
  const valueMaps = new Map<string, Map<string, string>>();
  for (const c of from.columns) {
    const target = to.columns.find((x) => x.id === c.id);
    if (!c.values || !target?.values) continue;
    const m = new Map<string, string>();
    for (const [code, label] of Object.entries(c.values)) if (target.values[code] !== undefined) m.set(label, target.values[code]);
    valueMaps.set(c.name, m);
  }
  const value = (column: string, v: unknown): unknown => {
    const m = valueMaps.get(column);
    if (!m) return v;
    if (typeof v === "string") return m.get(v) ?? v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? (m.get(x) ?? x) : x));
    return v;
  };
  const out: ViewConfig = { ...config };
  if (config.group_by) out.group_by = config.group_by.map(name);
  if (config.split_by) out.split_by = config.split_by.map(name);
  if (config.columns) out.columns = config.columns.map((c) => (c === null ? null : name(c)));
  if (config.aggregates) out.aggregates = Object.fromEntries(Object.entries(config.aggregates).map(([k, v]) => [name(k), v]));
  if (config.filter) out.filter = config.filter.map(([c, op, v]) => [name(c), op, value(c, v)]);
  if (config.sort) out.sort = config.sort.map(([c, dir]) => [name(c), dir]);
  if (config.expressions) {
    // An expression reads the columns by their names in double quotes
    out.expressions = Object.fromEntries(Object.entries(config.expressions).map(([k, e]) => [k, e.replace(/"((?:[^"\\]|\\.)*)"/g, (m, n: string) => (map.has(n) ? `"${map.get(n)}"` : m))]));
  }
  for (const key of ["columns_config", "plugin_config"] as const) {
    const v = config[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      // columns_config is by column; plugin_config's columns too (the datagrid's widths and colours)
      if (key === "columns_config") out[key] = Object.fromEntries(Object.entries(inner).map(([k, x]) => [name(k), x]));
      else if (inner.columns && typeof inner.columns === "object") out[key] = { ...inner, columns: Object.fromEntries(Object.entries(inner.columns as Record<string, unknown>).map(([k, x]) => [name(k), x])) };
    }
  }
  return out;
}

/** The saved views of a project, kept in this browser (read from storage text: anything unreadable is dropped). */
export function parseSavedViews(text: string | null): SavedView[] {
  if (!text) return [];
  try {
    const list = JSON.parse(text) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (v): v is SavedView =>
        !!v && typeof v === "object" && typeof v.name === "string" && v.name.trim() !== "" && typeof v.table === "string" && typeof v.language === "string" && !!v.config && typeof v.config === "object",
    );
  } catch {
    return [];
  }
}

/** The views with this one saved (a view of the same name and table replaced), in name order. */
export function withSavedView(views: readonly SavedView[], view: SavedView): SavedView[] {
  return [...views.filter((v) => !(v.name === view.name && v.table === view.table)), view].sort((a, b) => a.name.localeCompare(b.name));
}

/** How the columns are typed in DuckDB, for read_csv (the server says each one's type: nothing is guessed). */
export function readCsvSql(name: string, file: string, columns: readonly [string, string][]): string {
  const types = columns.map(([n, ty]) => `${quoteString(n)}: ${quoteString(ty)}`).join(", ");
  return `CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM read_csv(${quoteString(file)}, header = true, auto_detect = false, delim = ',', quote = '"', escape = '"', columns = {${types}})`;
}
