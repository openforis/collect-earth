import { describe, expect, it } from "vitest";
import type { AnalysisColumnModel, AnalysisData, AnalysisModelData } from "./api";
import { chartStyle, IPCC_COLOURS, LEGEND_WIDTH_PX, NO_ANSWER_COLOUR, paletteCss, seriesOfPaths, shade, takesOut, valueColour, withoutChartColours } from "./analysisColors";
import { applyQuestion, measuresOf, type Question } from "./analysisQuestion";
import { cubeOf } from "./analysisView";
import { translator } from "./i18n";

const col = (name: string, over: Partial<AnalysisColumnModel> = {}): AnalysisColumnModel => ({
  name,
  key: `collect_text_${name}`,
  labels: {},
  type: "text",
  list: null,
  calculated: false,
  multiple: false,
  fromPlotFile: false,
  ...over,
});
const item = (code: string, label: string, parent: string | null = null) => ({ code, labels: { en: label }, parent, level: parent ? 1 : 0 });
const model: AnalysisModelData = {
  languages: ["en"],
  tables: [
    {
      name: "plot",
      labels: {},
      keyColumn: null,
      columns: [
        col("lu", { type: "code", list: "land_uses", labels: { en: "Land use" } }),
        col("sub", { type: "code", list: "land_uses", parent: "lu", labels: { en: "Subdivision" } }),
        col("disturbance", { type: "code", list: "disturbances", labels: { en: "Disturbance" } }),
        col("confident", { type: "boolean", labels: { en: "Confident?" } }),
        col("province", { fromPlotFile: true, labels: { en: "Province" } }),
      ],
    },
  ],
  lists: {
    land_uses: [item("F", "Forest"), item("F1", "Natural forest", "F"), item("F2", "Plantation", "F"), item("C", "Cropland"), item("G", "Grassland"), item("S", "Settlement"), item("W", "Wetland"), item("O", "Other land")],
    disturbances: [item("fire", "Fire"), item("logging", "Logging"), item("mining", "Mining")],
  },
};
const data: AnalysisData = { model, scope: "project", areas: null, tables: [] };
const t = translator("en");
const cube = cubeOf(data, "plot", "en", t);
const measures = measuresOf(cube, t);
const column = (name: string) => cube.columns.find((c) => c.name === name);

describe("the colour of a value", () => {
  it("gives the IPCC land categories their map colours, by their labels or their codes, and a subdivision a shade of its category", () => {
    expect(valueColour(column("Land use"), "Forest", model)).toBe(IPCC_COLOURS.F);
    expect(valueColour(column("Land use"), "Cropland", model)).toBe(IPCC_COLOURS.C);
    expect(valueColour(column("Land use"), "Wetland", model)).toBe(IPCC_COLOURS.W);
    expect(valueColour(column("Land use (code)"), "S", model)).toBe(IPCC_COLOURS.S);
    const natural = valueColour(column("Subdivision"), "Natural forest", model);
    const plantation = valueColour(column("Subdivision"), "Plantation", model);
    expect([natural, plantation]).toEqual([shade(IPCC_COLOURS.F, -0.25), shade(IPCC_COLOURS.F, 0.5)]);
  });

  it("keeps a code's colour whatever else the chart shows: it is the code's place in its list", () => {
    const fire = valueColour(column("Disturbance"), "Fire", model);
    const mining = valueColour(column("Disturbance"), "Mining", model);
    expect(fire).not.toBe(mining);
    expect(valueColour(column("Disturbance"), "Mining", model)).toBe(mining);
    // a text without a list: the colour its text picks, always the same
    expect(valueColour(column("Province"), "Sofala", model)).toBe(valueColour(column("Province"), "Sofala", model));
  });

  it("says no answer in grey, yes and no in two colours of their own", () => {
    expect(valueColour(column("Land use"), "No answer", model)).toBe(NO_ANSWER_COLOUR);
    expect(valueColour(column("Confident?"), null, model)).toBe(NO_ANSWER_COLOUR);
    expect(valueColour(column("Confident?"), "Yes", model)).not.toBe(valueColour(column("Confident?"), "No", model));
  });
});

describe("the colours of a chart", () => {
  const q: Question = { rows: ["Land use"], columns: [], measures: ["plots", "plotsPct"], extra: [], filters: [], chart: "X Bar", order: "desc" };

  it("give each series of bars its category's colour, in the order the view has them", () => {
    const config = applyQuestion({}, q, measures, cube);
    // Perspective gives the column paths level by level: the split values, then the measures
    const paths = [
      ["Cropland", "Cropland", "Forest", "Forest"],
      ["Number of plots", "Plots (% of the total)", "Number of plots", "Plots (% of the total)"],
    ];
    expect(seriesOfPaths(paths, 1)).toEqual(["Cropland", "Forest"]);
    expect(seriesOfPaths([["__ROW_PATH__"], ["Wetland", "Number of plots"], ["Forest", "Number of plots"]], 1)).toEqual(["Wetland", "Forest"]);
    expect(seriesOfPaths([["Number of plots"]], 0)).toEqual([]);
    const style = chartStyle(config, cube, model, seriesOfPaths(paths, 1), null)!;
    const palette = paletteCss([IPCC_COLOURS.C, IPCC_COLOURS.F]);
    expect(style.columns_config).toEqual({ "Number of plots": { palette }, "Plots (% of the total)": { palette } });
    // the bars are their own rows: the axis names them, no legend
    expect(style.plugin_config).toEqual({ legend_width_px: LEGEND_WIDTH_PX, legend_mode: "none" });
    const stacked = applyQuestion({}, { ...q, columns: ["Disturbance"] }, measures, cube);
    expect(chartStyle({ ...stacked, plugin_config: { legend_mode: "none" } }, cube, model, ["Fire"], null)!.plugin_config).toEqual({ legend_width_px: LEGEND_WIDTH_PX, legend_mode: "auto" });
    // once set, nothing more to do (the page restores only what differs)
    expect(chartStyle({ ...config, ...style }, cube, model, seriesOfPaths(paths, 1), null)).toBeNull();
  });

  it("know when a colour must be taken out (Perspective adds a restored configuration to its own)", () => {
    expect(takesOut({ a: { palette: "x" } }, {})).toBe(true);
    expect(takesOut({ a: { palette: "x", fixed: 1 } }, { a: { fixed: 1 } })).toBe(true);
    expect(takesOut({ a: { fixed: 1 } }, { a: { fixed: 1, palette: "y" } })).toBe(false);
    expect(takesOut(undefined, {})).toBe(false);
  });

  it("colour a treemap's blocks by its first row field, in the order of the values the chart reads", () => {
    const config = applyQuestion({}, { ...q, measures: ["plots"], chart: "Treemap" }, measures, cube);
    const style = chartStyle(config, cube, model, [], ["Wetland", "Forest"])!;
    expect(style.columns_config).toEqual({ "Land use": { palette: paletteCss([IPCC_COLOURS.W, IPCC_COLOURS.F]) } });
  });

  it("take the colours out of a table, keeping the person's own settings", () => {
    const config = { plugin: "Datagrid", columns: ["Number of plots"], columns_config: { "Number of plots": { palette: "x", fixed: 2 }, Other: { color: "#fff" } } };
    expect(chartStyle(config, cube, model, null, null)).toEqual({ columns_config: { "Number of plots": { fixed: 2 } } });
    expect(withoutChartColours(undefined)).toEqual({});
  });
});
