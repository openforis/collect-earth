import type { AnalysisModelData } from "./api";
import { ipccCategory, isLandUseList } from "./analysisSuggest";
import type { Cube, CubeColumn, ViewConfig } from "./analysisView";

// The colours of the analysis page's charts: the same category has the same colour in every chart. The land
// categories of the IPCC have colours of their own, as on land use maps (forest dark green, cropland amber, grassland
// light green, wetland blue, settlement red, other land grey), their subdivisions shades of them; any other code the
// colour of its place in its list (not its place in the chart, which changes with the filters); other values the
// colour their text picks; yes, no and no answer always the same three. Perspective takes them by position (a palette
// for the series of a measure, in the order the view has them): the page reads that order from the view and gives
// the palette in it (chartStyle).

export const NO_ANSWER_COLOUR = "#bdbdbd";
const YES_COLOUR = "#2e7d32";
const NO_COLOUR = "#ef6c00";
/** The IPCC land categories (analysisSuggest.ts tells them by their codes or words). */
export const IPCC_COLOURS: Record<string, string> = { F: "#1b5e20", C: "#f9a825", G: "#9ccc65", W: "#1e88e5", S: "#d32f2f", O: "#9e9e9e" };
/** Twelve colours told apart easily (and none the IPCC's greens), for the codes of other lists. */
const PALETTE = ["#3366cc", "#dc3912", "#ff9900", "#990099", "#0099c6", "#dd4477", "#66aa00", "#b82e2e", "#316395", "#22aa99", "#aaaa11", "#6633cc"];

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** A colour lighter (amount > 0, towards white) or darker (< 0, towards black). */
export function shade(colour: string, amount: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!m) return colour;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  const to = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  return `#${hex(r + (to - r) * a)}${hex(g + (to - g) * a)}${hex(b + (to - b) * a)}`;
}

/** A stable colour for a text: the same text, the same colour. */
function colourOfText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/**
 * The colour of one value of a field of the cube: by the code it stands for (its label is looked up in the field's
 * values), whatever chart it is in.
 */
export function valueColour(column: CubeColumn | undefined, value: unknown, model: Pick<AnalysisModelData, "lists">): string {
  if (value === null || value === undefined || value === "") return NO_ANSWER_COLOUR;
  const text = String(value);
  const values = column?.values;
  if (values && values[""] === text) return NO_ANSWER_COLOUR;
  if (values && values.true !== undefined && column?.list === undefined) {
    if (text === values.true) return YES_COLOUR;
    if (text === values.false) return NO_COLOUR;
  }
  const items = column?.list ? model.lists[column.list] : undefined;
  if (!items) return colourOfText(text);
  // a label stands for the first code that has it; a code column's values are the codes
  const code = values ? (Object.entries(values).find(([c, l]) => c !== "" && l === text)?.[0] ?? text) : text;
  const byCode = new Map(items.map((i) => [i.code, i]));
  const item = byCode.get(code);
  if (!item) return colourOfText(text);
  // up to the top of a hierarchical list: a subdivision is a shade of its category
  let top = item;
  for (let guard = 0; top.parent !== null && byCode.has(top.parent) && guard < 10; guard++) top = byCode.get(top.parent)!;
  const tops = items.filter((i) => i.level === 0);
  const ipcc = isLandUseList(model, column?.list) ? ipccCategory(top.code, Object.values(top.labels)[0] ?? "") : null;
  const base = ipcc ? IPCC_COLOURS[ipcc] : PALETTE[Math.max(0, tops.indexOf(top)) % PALETTE.length];
  if (item === top) return base;
  const siblings = items.filter((i) => i.parent === item.parent);
  const n = siblings.length;
  const at = siblings.indexOf(item);
  // from a little darker to a good deal lighter, in the list's order
  return shade(base, n <= 1 ? 0.25 : -0.25 + (0.75 * at) / (n - 1));
}

/** The part of a view's configuration that gives its colours and legend. */
export interface StylePatch {
  columns_config: Record<string, Record<string, unknown>>;
  plugin_config?: Record<string, unknown>;
}

/**
 * Whether going from a view's column configuration to another takes something out of it: Perspective adds a restored
 * configuration to the one it has (a colour no longer wanted stays), so the page clears it first then.
 */
export function takesOut(before: unknown, after: Record<string, Record<string, unknown>>): boolean {
  if (!before || typeof before !== "object") return false;
  return Object.entries(before as Record<string, unknown>).some(
    ([k, v]) => !(k in after) || (!!v && typeof v === "object" && Object.keys(v as Record<string, unknown>).some((key) => !(key in after[k]))),
  );
}

/** A palette as Perspective's charts read it from a column's configuration. */
export const paletteCss = (colours: readonly string[]) => `linear-gradient(to right, ${colours.join(", ")})`;

const SERIES = new Set(["X Bar", "Y Bar", "Y Line", "Y Area"]);
export const TREES = new Set(["Treemap", "Sunburst"]);
/** Wide enough for "Settlement (code)" or "Other land": Perspective's own legend (80 px) cut the labels. */
export const LEGEND_WIDTH_PX = 190;
/** What chartStyle writes in a column's configuration, so it can take it out again for a table. */
const OURS = ["palette", "color"] as const;

/** A column's configuration without the colours written here (a table has no use for them). */
export function withoutChartColours(columnsConfig: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!columnsConfig || typeof columnsConfig !== "object") return out;
  for (const [k, v] of Object.entries(columnsConfig as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const rest = { ...(v as Record<string, unknown>) };
    for (const key of OURS) delete rest[key];
    if (Object.keys(rest).length) out[k] = rest;
  }
  return out;
}

/**
 * The colours of a view's chart, as the part of its configuration to restore (null when it has them already):
 * - bars, lines and areas split by one field: each measure's palette, the series' colours in the order the view has
 *   them (`series`, from the view's column paths);
 * - a treemap or sunburst coloured by its first row field: that field's palette, in the order of the values the chart
 *   reads (`colourValues`, from the view's Arrow dictionary);
 * - every chart: a legend wide enough for its labels, none for bars coloured by their own rows.
 */
export function chartStyle(
  config: ViewConfig,
  cube: Cube,
  model: Pick<AnalysisModelData, "lists">,
  series: readonly unknown[] | null,
  colourValues: readonly unknown[] | null,
): StylePatch | null {
  const plugin = config.plugin ?? "Datagrid";
  const columnsConfig = withoutChartColours(config.columns_config);
  const out: StylePatch = { columns_config: columnsConfig };
  if (plugin !== "Datagrid") {
    const pc = config.plugin_config && typeof config.plugin_config === "object" ? (config.plugin_config as Record<string, unknown>) : {};
    // bars coloured by their own rows need no legend: the axis names them (and a floating one hid the longest bar)
    const rows = config.group_by ?? [];
    const split = config.split_by ?? [];
    const byRows = rows.length === 1 && split.length === 1 && rows[0] === split[0];
    out.plugin_config = { ...pc, legend_width_px: LEGEND_WIDTH_PX, legend_mode: byRows ? "none" : pc.legend_mode === "none" ? "auto" : (pc.legend_mode ?? "auto") };
  }
  const byName = new Map(cube.columns.map((c) => [c.name, c]));
  const measures = (config.columns ?? []).filter((c): c is string => typeof c === "string");
  const set = (column: string, patch: Record<string, unknown>) => (columnsConfig[column] = { ...(columnsConfig[column] ?? {}), ...patch });
  if (SERIES.has(plugin) && (config.split_by ?? []).length === 1 && series && series.length) {
    const split = byName.get(config.split_by![0]);
    const palette = paletteCss(series.map((v) => valueColour(split, v, model)));
    for (const m of measures) set(m, { palette });
  } else if (TREES.has(plugin) && (config.group_by ?? []).length && colourValues && colourValues.length) {
    const field = config.group_by![0];
    if (measures.includes(field)) set(field, { palette: paletteCss(colourValues.map((v) => valueColour(byName.get(field), v, model))) });
  }
  const same = JSON.stringify(out.columns_config) === JSON.stringify(config.columns_config ?? {}) && (out.plugin_config === undefined || JSON.stringify(out.plugin_config) === JSON.stringify(config.plugin_config ?? {}));
  return same ? null : out;
}

/**
 * The series of a view in its order: the distinct values of its split field in the view's column paths. Perspective
 * gives them level by level (the split values of every column, then their measures); one path per column is read too.
 */
export function seriesOfPaths(paths: readonly (readonly unknown[])[], splits = 1): unknown[] {
  const byLevel = paths.length === splits + 1 && paths.every((p) => p.length === paths[0].length) && !paths.some((p) => p[0] === "__ROW_PATH__");
  const firsts = byLevel ? paths[0] : paths.filter((p) => p.length >= 2 && p[0] !== "__ROW_PATH__").map((p) => p[0]);
  if (splits < 1) return [];
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of firsts) {
    const key = JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}
