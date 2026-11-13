import type { AnalysisModel } from "./api";
import { whereSql, type Filter, type Question } from "./analysisQuestion";
import { REGION, surveyRoles } from "./analysisSuggest";
import { quoteIdent, quoteString, type Cube, type CubeColumn } from "./analysisView";

// What the analysis page offers to dig into the data beside the pivot: the fields to filter by in one click, the step
// down from a clicked bar or row to the question that refines it, the land use change flows and the plots on a map.
// Pure, and tested.

/** The cube's column of a survey column (an entity's cube names the plot's columns "plot.<name>"). */
function plotColumn(cube: Cube, name: string | undefined): CubeColumn | undefined {
  if (!name) return undefined;
  const id = cube.table === "plot" ? name : `plot.${name}`;
  return cube.columns.find((c) => c.id === id);
}

/** The fields offered as one-click filters: the main question, the year of its change, the region and the collector. */
export function quickFilterFields(model: AnalysisModel, cube: Cube): string[] {
  const roles = surveyRoles(model);
  const picks = [
    plotColumn(cube, roles.main?.name),
    plotColumn(cube, roles.year?.name),
    cube.columns.find((c) => c.group === "plotFile" && c.kind === "text" && REGION.test(c.id)),
    cube.columns.find((c) => c.id === "_operator"),
  ];
  return [...new Set(picks.filter((c): c is CubeColumn => !!c).map((c) => c.name))];
}

/**
 * The field one step below another: the next level of a code's hierarchy ("Land use (level 1)" → its level 2, the last
 * level → the code's own label), else the question that refines it (a land use → its subdivision). Undefined at the bottom.
 */
export function childField(model: AnalysisModel, cube: Cube, name: string): CubeColumn | undefined {
  const col = cube.columns.find((c) => c.name === name);
  if (!col) return undefined;
  const byId = (id: string) => cube.columns.find((c) => c.id === id);
  const level = /^(.*)#(\d+)$/.exec(col.id);
  if (level) return byId(`${level[1]}#${Number(level[2]) + 1}`) ?? byId(level[1]);
  if (!col.source || col.id.endsWith("#code")) return undefined;
  const prefix = col.id.slice(0, col.id.length - col.source.length);
  const table = model.tables.find((t) => t.name === (prefix === "plot." || cube.table === "plot" ? "plot" : cube.table));
  const child = table?.columns.find((c) => c.parent === col.source);
  return child ? byId(`${prefix}${child.name}`) : undefined;
}

/**
 * The question after a click on a bar or a row: the deepest row field the click names, filtered to the value clicked
 * and replaced by the field one step below it. Null when there is no step down (the page lists the plots instead).
 */
export function drillDown(model: AnalysisModel, cube: Cube, q: Question, clicked: readonly Filter[]): { question: Question; field: string; value: unknown } | null {
  for (let i = q.rows.length - 1; i >= 0; i--) {
    const field = q.rows[i];
    const hit = clicked.find(([c, op, v]) => c === field && op === "==" && v !== null && v !== undefined);
    if (!hit) continue;
    const child = childField(model, cube, field);
    if (!child || q.rows.includes(child.name) || q.columns.includes(child.name)) return null;
    const value = hit[2];
    const filters: Filter[] = [...q.filters.filter(([c]) => c !== field), [field, "==", value]];
    return { question: { ...q, rows: [...q.rows.slice(0, i), child.name, ...q.rows.slice(i + 1)], filters }, field, value };
  }
  return null;
}

// --- land use change flows ------------------------------------------------------------------------------------------

/** The fields a change can be drawn between: the labels of the questions on the main question's list (the land uses). */
export function changeFields(model: AnalysisModel, cube: Cube): CubeColumn[] {
  const list = surveyRoles(model).main?.list;
  if (!list) return [];
  return cube.columns.filter((c) => c.list === list && c.kind === "text" && !c.id.includes("#") && (cube.table === "plot" || c.id.startsWith("plot.")));
}

/** The change drawn first: the land use before (the change matrix's) to the main question, else the first two fields. */
export function defaultChange(model: AnalysisModel, cube: Cube): { from: string; to: string } | null {
  const fields = changeFields(model, cube);
  const roles = surveyRoles(model);
  const from = plotColumn(cube, roles.from?.name) ?? fields.find((c) => c.source !== roles.main?.name);
  const to = plotColumn(cube, roles.main?.name) ?? fields.find((c) => c !== from);
  return from && to && from !== to ? { from: from.name, to: to.name } : null;
}

/**
 * The SQL of the flows: how many plots (or how much area, `measure`) went from each value of `from` to each of `to`,
 * among the plots with both answered (`none` is the cube's "No answer": a question not asked is no change).
 */
export function flowsSql(cube: Cube, from: string, to: string, measure: string | null, filters: readonly Filter[], none: string): string {
  const value = measure ? `sum(${quoteIdent(measure)})` : "count(*)";
  const both = `${quoteIdent(from)} <> ${quoteString(none)} AND ${quoteIdent(to)} <> ${quoteString(none)}`;
  return `SELECT ${quoteIdent(from)} AS source, ${quoteIdent(to)} AS target, ${value} AS value FROM (${cube.sql}) AS cube WHERE ${whereSql(cube, filters).sql} AND ${both} GROUP BY 1, 2 HAVING ${value} > 0 ORDER BY value DESC`;
}

/**
 * The SQL that scores each field as the "before" of `to`: `a<i>`, its plots answered on the level of `to` (its value is
 * one of the values `to` has: a land use against a land use, not a subdivision against a land use), and `c<i>`, those
 * of them where it differs from `to` (a change). One row.
 */
export function changeChoiceSql(cube: Cube, candidates: readonly string[], to: string, none: string, filters: readonly Filter[]): string {
  const t = quoteIdent(to);
  const levels = `(SELECT DISTINCT ${t} FROM (${cube.sql}) AS v WHERE ${t} <> ${quoteString(none)})`;
  const parts = candidates.flatMap((name, i) => {
    const c = quoteIdent(name);
    return [`count(*) FILTER (WHERE ${c} IN ${levels}) AS a${i}`, `count(*) FILTER (WHERE ${c} IN ${levels} AND ${c} <> ${t}) AS c${i}`];
  });
  return `SELECT ${parts.join(", ")} FROM (${cube.sql}) AS cube WHERE ${whereSql(cube, filters).sql}`;
}

/**
 * The "before" to draw first, from changeChoiceSql's row: among the fields answered on the level of `to` for half the
 * plots at least (as many as the best one), the one with the most changes. Null when none has a change.
 */
export function pickChange(candidates: readonly string[], row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const scores = candidates.map((name, i) => ({ name, answered: Number(row[`a${i}`] ?? 0), changes: Number(row[`c${i}`] ?? 0) }));
  const most = Math.max(0, ...scores.map((s) => s.answered));
  const best = scores.filter((s) => s.answered > 0 && s.answered >= most / 2 && s.changes > 0).sort((a, b) => b.changes - a.changes)[0];
  return best?.name ?? null;
}

export interface Flow {
  source: string;
  target: string;
  value: number;
}

export interface SankeyNode {
  side: "left" | "right";
  name: string;
  value: number;
  y: number;
  h: number;
}

export interface SankeyLink extends Flow {
  /** Where the band leaves its source and reaches its target (its top), and its thickness. */
  y0: number;
  y1: number;
  w: number;
}

/**
 * A two-column Sankey: the values before on the left and after on the right, each stacked largest first with `gap`
 * between them, and a band per flow as thick as its value, leaving its source and reaching its target in the order of
 * the other side (so the bands do not cross more than they must).
 */
export function sankeyLayout(flows: readonly Flow[], height: number, gap: number): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const totals = (key: "source" | "target") => {
    const m = new Map<string, number>();
    for (const f of flows) m.set(f[key], (m.get(f[key]) ?? 0) + f.value);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const left = totals("source");
  const right = totals("target");
  const total = flows.reduce((s, f) => s + f.value, 0);
  if (!total) return { nodes: [], links: [] };
  const k = Math.max(0, height - gap * (Math.max(left.length, right.length) - 1)) / total;
  const place = (side: SankeyNode["side"], list: [string, number][]) => {
    let y = 0;
    return list.map(([name, value]) => {
      const node = { side, name, value, y, h: value * k };
      y += node.h + gap;
      return node;
    });
  };
  const nodes = [...place("left", left), ...place("right", right)];
  const at = (side: SankeyNode["side"], name: string) => nodes.find((n) => n.side === side && n.name === name)!;
  const rank = (side: SankeyNode["side"], name: string) => nodes.indexOf(at(side, name));
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  const links: SankeyLink[] = flows.map((f) => ({ ...f, y0: 0, y1: 0, w: f.value * k }));
  for (const l of [...links].sort((a, b) => rank("left", a.source) - rank("left", b.source) || rank("right", a.target) - rank("right", b.target))) {
    l.y0 = at("left", l.source).y + (out.get(l.source) ?? 0);
    out.set(l.source, (out.get(l.source) ?? 0) + l.w);
  }
  for (const l of [...links].sort((a, b) => rank("right", a.target) - rank("right", b.target) || rank("left", a.source) - rank("left", b.source))) {
    l.y1 = at("right", l.target).y + (into.get(l.target) ?? 0);
    into.set(l.target, (into.get(l.target) ?? 0) + l.w);
  }
  return { nodes, links };
}

// --- the plots on a map ---------------------------------------------------------------------------------------------

/** The SQL of the plots behind the view: each plot once, with its value of `colour` (the chart's first row field). */
export function mapPlotsSql(cube: Cube, colour: string | null, filters: readonly Filter[]): string | null {
  const plot = cube.columns.find((c) => c.id === "_plot")?.name;
  if (!plot) return null;
  const value = colour ? `, any_value(${quoteIdent(colour)}) AS value` : ", NULL AS value";
  return `SELECT ${quoteIdent(plot)} AS plot${value} FROM (${cube.sql}) AS cube WHERE ${whereSql(cube, filters).sql} AND ${quoteIdent(plot)} IS NOT NULL GROUP BY 1`;
}
