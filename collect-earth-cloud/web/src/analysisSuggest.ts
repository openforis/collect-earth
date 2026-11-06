import type { AnalysisColumnModel, AnalysisData, AnalysisModelData, ProposedView } from "./api";
import type { Translate } from "./i18n";
import type { Filter, Measure, Question } from "./analysisQuestion";
import { isYearList, type Cube, type CubeColumn } from "./analysisView";

// The views the analysis page suggests: ready-made ones worked out from the survey by rules (what a Collect Earth
// analyst asks first: the land use, its subdivisions, its change, the year of the change, disturbances, the
// interpreters' confidence, the work over time), and the AI assistant's proposals (the server's
// src/ai/analysisViews.ts) turned into questions of the bar. Pure, and tested.

export interface Template {
  id: string;
  label: string;
  question: Question;
  /** A change matrix: which field is the land use before and which after, for the view's title to say which axis is which. */
  change?: { from: string; to: string };
  /** The AI assistant's one line on why the view is useful. */
  why?: string;
}

/** Collect Earth's own attributes of every plot: the collection's columns already give them. */
const CE_OWN = new Set(["id", "round", "operator", "actively_saved", "actively_saved_on", "plot_file"]);
const REGION = /region|province|district|stratum|strata|zone|county|state|department|admin|municip|ecozone|ecoregion/i;
/** A yes/no question on how sure the interpreter is. */
const CONFIDENCE = /confiden|certain|\bsure\b|segur|confian|fiab/i;
/** A question on what disturbed the land or drove its change. */
const DRIVERS = /disturb|driver|degrad|perturb|cause|fire|incend|feu/i;
/** At most so many options for a question to be counted as bars of its own. */
const FEW_OPTIONS = 12;
/** The IPCC land categories, by the codes Collect Earth's surveys give them and by words of their labels. */
const IPCC: { code: string; words: RegExp }[] = [
  { code: "F", words: /forest|bosque|for[eê]t|floresta/i },
  { code: "C", words: /crop|cultiv|agric/i },
  { code: "G", words: /grass|pasti|prair|pastag|herb/i },
  { code: "W", words: /wetland|humed|humide|[uú]mid|water/i },
  { code: "S", words: /settle|asenta|[ée]tabl|urban|built/i },
  { code: "O", words: /other|otra|autre|outra/i },
];

/** A question someone answered (not a key, not Collect Earth's own, not from the plot file, not worked out). */
function answered(c: AnalysisColumnModel): boolean {
  return !c.fromPlotFile && !c.calculated && !c.keyAttr && !CE_OWN.has(c.name) && !c.multiple;
}

/** The IPCC category of a level-0 item of a list (by its code, else the words of its label), or null. */
export function ipccCategory(code: string, label: string): string | null {
  const byCode = IPCC.find((x) => x.code === code.toUpperCase());
  if (byCode) return byCode.code;
  return IPCC.find((x) => x.words.test(label))?.code ?? null;
}

/** A list of land categories: four of the six IPCC ones at least among its top level. */
export function isLandUseList(model: Pick<AnalysisModelData, "lists">, list: string | null | undefined): boolean {
  const top = (list ? model.lists[list] : undefined)?.filter((i) => i.level === 0) ?? [];
  const found = new Set(top.map((i) => ipccCategory(i.code, Object.values(i.labels)[0] ?? "")).filter((x) => x));
  return found.size >= 4;
}

/**
 * The survey's main question: what its plots are about, its land use. The question called land_use_category in
 * Collect Earth's own surveys, else the first code question answered on a list of land categories, else the first
 * code question answered: neither a key (the assessment phase is one), nor the plot file's, nor a code refining another.
 */
export function mainQuestion(model: AnalysisModelData): AnalysisColumnModel | undefined {
  const plot = model.tables.find((x) => x.name === "plot");
  if (!plot) return undefined;
  const isCode = (c: AnalysisColumnModel) => c.type === "code" && !!c.list && !!model.lists[c.list]?.length && !c.multiple && !c.parent && c.list !== "assessment_phases";
  const named = plot.columns.find((c) => c.name === "land_use_category" && isCode(c) && !c.fromPlotFile);
  if (named) return named;
  const codes = plot.columns.filter((c) => isCode(c) && answered(c));
  return codes.find((c) => isLandUseList(model, c.list)) ?? codes[0];
}

/** The parts of a survey the ready-made views are made of, by the model's column names. */
export interface SurveyRoles {
  main?: AnalysisColumnModel;
  /** The code refining the main one (its subdivision). */
  child?: AnalysisColumnModel;
  /** The land use before, on the main question's list: the "from" of a change. */
  from?: AnalysisColumnModel;
  /** A question of years (the year of the change). */
  year?: AnalysisColumnModel;
  /** Other questions with a few options each (the disturbance…). */
  few: AnalysisColumnModel[];
  /** Yes/no questions worth crossing with the main one (the confidence; whether it changed). */
  yesNo: AnalysisColumnModel[];
}

export function surveyRoles(model: AnalysisModelData): SurveyRoles {
  const plot = model.tables.find((x) => x.name === "plot");
  const main = mainQuestion(model);
  if (!plot || !main) return { main, few: [], yesNo: [] };
  const cols = plot.columns.filter(answered);
  const child = plot.columns.find((c) => c.type === "code" && c.parent === main.name);
  const from = cols.find((c) => c.type === "code" && c.list === main.list && c !== main && c !== child && !c.parent);
  const year = cols.find((c) => (c.type === "code" && isYearList(model, c.list)) || (c.type === "integer" && /year|año|année/i.test(`${c.name} ${Object.values(c.labels).join(" ")}`)));
  const labelOf = (c: AnalysisColumnModel) => (Object.values(c.labels)[0] ?? c.name).trim().toLowerCase();
  const seen = new Set<string>();
  const few: AnalysisColumnModel[] = [];
  // what disturbed or drove the land first (a survey asks many small questions; these are the ones analysed)
  const ranked = [...cols.filter((c) => DRIVERS.test(`${c.name} ${Object.values(c.labels).join(" ")}`)), ...cols];
  for (const c of new Set(ranked)) {
    if (few.length >= 3) break;
    if (c.type !== "code" || !c.list || c.list === main.list || c === year || c.parent) continue;
    const options = (model.lists[c.list] ?? []).filter((i) => i.level === 0).length;
    if (options < 2 || options > FEW_OPTIONS || seen.has(labelOf(c))) continue;
    seen.add(labelOf(c));
    few.push(c);
  }
  const booleans = cols.filter((c) => c.type === "boolean");
  const yesNo = [booleans.find((c) => CONFIDENCE.test(`${c.name} ${Object.values(c.labels).join(" ")}`)), from?.relevantIf ? booleans.find((c) => c.name === from.relevantIf) : undefined].filter(
    (c, i, all): c is AnalysisColumnModel => !!c && all.indexOf(c) === i,
  );
  return { main, child, from, year, few, yesNo };
}

/**
 * Views ready to open, worked out from the survey: the main question counted (horizontal bars, largest first), by its
 * subdivision (stacked bars), the change matrix from the land use before to the main one (a heat map, among the plots
 * that changed when the survey asks), the year of the change (bars over the years), the other questions of a few
 * options, the yes/no questions by the main one; the region, an average; and the work by collector and over time.
 */
export function templatesOf(data: Pick<AnalysisData, "model" | "scope" | "areas">, cube: Cube, measures: readonly Measure[], t: Translate): Template[] {
  const nested = cube.table !== "plot";
  const has = new Set(measures.map((m) => m.id));
  const byId = new Map(cube.columns.map((c) => [c.id, c]));
  const name = (id: string | undefined) => (id === undefined ? undefined : byId.get(id)?.name);
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
  /** The filter keeping the plots where a yes/no question is yes (a question asked only then). */
  const whenYes = (gate: string | null | undefined, prefix = ""): Filter[] => {
    const c = gate ? byId.get(`${prefix}${gate}`) : undefined;
    return c?.values?.true ? [[c.name, "==", c.values.true]] : [];
  };
  const out: Template[] = [];
  const roles = surveyRoles(data.model);

  if (nested) {
    const tm = data.model.tables.find((x) => x.name === cube.table)!;
    const key = name(tm.keyColumn ?? "") ?? cube.columns.find((c) => c.group === "entity" && c.kind === "text")?.name;
    out.push({ id: "default", label: t("analysis.tpl.rowsBy", { field: key ?? "" }), question: q([key], [], ["rows", "plots"], "X Bar", firsts, "desc") });
    const lu = name(roles.main ? `plot.${roles.main.name}` : undefined);
    if (key && lu) out.push({ id: "byLandUse", label: t("analysis.tpl.byTwo", { a: key, b: lu }), question: q([key], [lu], ["rows"], "Y Bar") });
    for (const c of cube.columns.filter((x) => x.group === "entity" && x.kind === "number").slice(0, 2)) {
      out.push({ id: `avg:${c.id}`, label: t("analysis.tpl.avgBy", { measure: c.name, field: key ?? "" }), question: q([key], [], [`avg:${c.id}`]) });
    }
    return out;
  }

  const main = name(roles.main?.name);
  const size = has.has("area") ? "area" : "plots";
  if (main) {
    // One measure: horizontal bars draw every measure on one axis (Perspective's X Bar has no second one), so a share
    // beside a count ran off the chart; the table (one click) shows the share too
    out.push({
      id: "default",
      label: t(has.has("area") ? "analysis.tpl.areaBy" : "analysis.tpl.defaultPlots", { field: main }),
      question: q([main], [], [size], "X Bar", firsts, "desc"),
    });
  } else {
    out.push({ id: "default", label: t("analysis.tpl.allPlots"), question: q([], [], ["plots"], "Datagrid") });
  }
  const child = name(roles.child?.name);
  if (main && child) out.push({ id: `child:${roles.child!.name}`, label: t("analysis.tpl.byTwo", { a: main, b: child }), question: q([main], [child], [size], "Y Bar") });
  const from = name(roles.from?.name);
  if (main && from) {
    out.push({
      id: `change:${roles.from!.name}:${roles.main!.name}`,
      label: t("analysis.tpl.change", { a: from, b: main }),
      // the land use after along the bottom (the heat map's X axis is its rows), before up the side (its columns)
      question: q([main], [from], [size], "Heatmap", [...firsts, ...whenYes(roles.from!.relevantIf)]),
      change: { from, to: main },
    });
  }
  const year = name(roles.year?.name);
  if (year) out.push({ id: `year:${roles.year!.name}`, label: t("analysis.tpl.plotsBy", { field: year }), question: q([year], [], [size], "Y Bar", [...firsts, ...whenYes(roles.year!.relevantIf)]) });
  for (const c of roles.few) {
    const field = name(c.name);
    if (field) out.push({ id: `count:${c.name}`, label: t("analysis.tpl.plotsBy", { field }), question: q([field], [], [size], "X Bar", [...firsts, ...whenYes(c.relevantIf)], "desc") });
  }
  for (const c of roles.yesNo) {
    const field = name(c.name);
    if (field && main) out.push({ id: `yesno:${c.name}`, label: t("analysis.tpl.byTwo", { a: field, b: main }), question: q([main], [field], [size], "Y Bar") });
  }
  const region = cube.columns.find((c) => c.group === "plotFile" && c.kind === "text" && REGION.test(c.id));
  if (region && main) out.push({ id: "byRegion", label: t("analysis.tpl.byTwo", { a: main, b: region.name }), question: q([main], [region.name], [size]) });
  const numeric = cube.columns.find((c) => c.group === "survey" && c.kind === "number" && !c.time);
  if (numeric && main) out.push({ id: `avg:${numeric.id}`, label: t("analysis.tpl.avgBy", { measure: numeric.name, field: main }), question: q([main], [], [`avg:${numeric.id}`], "X Bar") });
  if (data.scope === "project") {
    out.push({ id: "byCollector", label: t("analysis.tpl.byCollector"), question: q([name("_operator")], [name("_saved_month")], ["plots"], "Datagrid", []) });
    out.push({ id: "perWeek", label: t("analysis.tpl.perWeek"), question: q([name("_saved_week")], [assessment], ["plots"], "Y Line", []) });
  } else {
    out.push({ id: "perWeek", label: t("analysis.tpl.myWeeks"), question: q([name("_saved_week")], [], ["plots"], "Y Line", []) });
  }
  return out;
}

/**
 * The title of a view: a change matrix says which field is the land use before and which after, and where each is
 * (a heat map draws its rows along the bottom and its columns up the side); other views, their name.
 */
export function viewTitle(template: Template, q: Question, t: Translate): string {
  const c = template.change;
  if (!c) return template.label;
  const [rows, columns] = [q.rows[0], q.columns[0]];
  const swapped = rows === c.from && columns === c.to;
  if (!swapped && !(rows === c.to && columns === c.from)) return template.label;
  const heat = q.chart === "Heatmap";
  // the "from" is in the columns unless the axes were swapped
  const fromSide = t(heat ? (swapped ? "analysis.side.bottom" : "analysis.side.side") : swapped ? "analysis.side.rows" : "analysis.side.columns");
  const toSide = t(heat ? (swapped ? "analysis.side.side" : "analysis.side.bottom") : swapped ? "analysis.side.columns" : "analysis.side.rows");
  return t("analysis.tpl.changeTitle", { from: c.from, fromSide, to: c.to, toSide });
}

// --- the AI assistant's proposals ---------------------------------------------------------------------------------

const CHART_OF: Record<ProposedView["chart"], string> = {
  table: "Datagrid",
  bars: "Y Bar",
  hbars: "X Bar",
  stacked: "Y Bar",
  lines: "Y Line",
  areas: "Y Area",
  heatmap: "Heatmap",
  treemap: "Treemap",
  sunburst: "Sunburst",
};

/**
 * A view the AI assistant proposed, as a question of the bar over this cube: its ids are the cube's (the server checked
 * them against the survey; they are checked again here, against the cube shown), its filters' codes turned into the
 * labels the cube's columns show. Null when it names a field the cube has not.
 */
export function viewOfProposal(p: ProposedView, cube: Cube, measures: readonly Measure[], t: Translate): Question | null {
  const byId = new Map(cube.columns.map((c) => [c.id, c]));
  const field = (id: string) => byId.get(id);
  const rows = p.rows.map(field);
  const columns = p.columns.map(field);
  if (!rows.length || rows.some((c) => !c) || columns.some((c) => !c)) return null;
  const known = new Set(measures.map((m) => m.id));
  const ms = p.measures.filter((m) => known.has(m));
  const none = t("analysis.noAnswer");
  const filters: Filter[] = [];
  for (const f of p.filters ?? []) {
    const c = field(f.column);
    if (!c) continue;
    const label = (code: string) => c.values?.[code] ?? code;
    if ((f.op === "is" || f.op === "isNot") && f.codes?.length) filters.push([c.name, f.op === "is" ? "in" : "not in", f.codes.map(label)]);
    else if ((f.op === "yes" || f.op === "no") && c.values?.true) filters.push([c.name, "==", c.values[f.op === "yes" ? "true" : "false"]]);
    else if (f.op === "answered") filters.push([c.name, "!=", none]);
    else if (f.op === "notAnswered") filters.push([c.name, "==", none]);
    else if ((f.op === "atLeast" || f.op === "atMost") && f.value !== undefined && (c.kind === "number" || c.kind === "date")) filters.push([c.name, f.op === "atLeast" ? ">=" : "<=", f.value]);
  }
  let chart = CHART_OF[p.chart] ?? "Datagrid";
  if ((chart === "Y Line" || chart === "Y Area") && !rows[0]!.time) chart = "Y Bar";
  return {
    rows: rows.map((c) => (c as CubeColumn).name),
    columns: columns.map((c) => (c as CubeColumn).name),
    measures: ms.length ? ms : [measures[0].id],
    extra: [],
    filters,
    chart,
    order: p.order === "largest" ? "desc" : p.order === "smallest" ? "asc" : "name",
  };
}
