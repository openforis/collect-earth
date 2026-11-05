import { describe, expect, it } from "vitest";
import type { AnalysisData, AnalysisModelData } from "./api";
import {
  applyQuestion,
  decodeView,
  drillColumns,
  drillSql,
  encodeView,
  filterValues,
  measuresOf,
  questionOf,
  swapAxes,
  templatesOf,
  valuesSql,
  whereSql,
  withRangeFilter,
  withValuesFilter,
  type Question,
} from "./analysisQuestion";
import { cubeOf } from "./analysisView";
import { translator } from "./i18n";

const col = (name: string, over: Partial<AnalysisModelData["tables"][number]["columns"][number]> = {}) => ({
  name,
  key: `collect_text_${name}`,
  labels: {},
  type: "text" as const,
  list: null,
  calculated: false,
  multiple: false,
  fromPlotFile: false,
  ...over,
});

const model: AnalysisModelData = {
  languages: ["en"],
  tables: [
    {
      name: "plot",
      labels: {},
      keyColumn: null,
      columns: [
        col("id", { labels: { en: "Plot id" } }),
        col("province", { fromPlotFile: true, labels: { en: "Province" } }),
        col("elevation", { fromPlotFile: true, type: "integer", labels: { en: "Elevation" } }),
        col("land_use_category", { type: "code", list: "land_uses", labels: { en: "Land use 2025" } }),
        col("land_use_2015", { type: "code", list: "land_uses", labels: { en: "Land use 2015" } }),
        col("tree_cover", { type: "real", labels: { en: "Tree cover" } }),
      ],
    },
    {
      name: "land_cover",
      labels: { en: "Land cover" },
      keyColumn: "element",
      columns: [col("element", { type: "code", list: "elements", labels: { en: "Element" } }), col("percentage", { type: "integer", labels: { en: "Percentage" } })],
    },
  ],
  lists: {
    land_uses: [
      { code: "F", labels: { en: "Forest" }, parent: null, level: 0 },
      { code: "C", labels: { en: "Cropland" }, parent: null, level: 0 },
    ],
    elements: [{ code: "trees", labels: { en: "Trees" }, parent: null, level: 0 }],
  },
};
const data = (over: Partial<AnalysisData> = {}): AnalysisData => ({ model, scope: "project", areas: { source: "region_areas.csv", plots: 2, unmatched: 0 }, tables: [], ...over });
const t = translator("en");
const cube = cubeOf(data(), "plot", "en", t);
const measures = measuresOf(cube, t);

describe("the measures", () => {
  it("count the plots and their shares, add up the area, and give each numeric answer's average, total, least and most", () => {
    expect(measures.map((m) => [m.id, m.label, m.expression, m.aggregate])).toEqual([
      ["plots", "Number of plots", "integer(1)", "sum"],
      ["plotsPct", "Plots (% of the total)", "integer(1)", "pct sum grand total"],
      ["plotsPctParent", "Plots (% of the group above)", "integer(1)", "pct sum parent"],
      ["area", "Total area", '"Area"', "sum"],
      ["areaPct", "Area (% of the total)", '"Area"', "pct sum grand total"],
      ["areaPctParent", "Area (% of the group above)", '"Area"', "pct sum parent"],
      ["avg:elevation", "Average of Elevation", '"Elevation"', "avg"],
      ["sum:elevation", "Total of Elevation", '"Elevation"', "sum"],
      ["min:elevation", "Smallest Elevation", '"Elevation"', "low"],
      ["max:elevation", "Largest Elevation", '"Elevation"', "high"],
      ["avg:tree_cover", "Average of Tree cover", '"Tree cover"', "avg"],
      ["sum:tree_cover", "Total of Tree cover", '"Tree cover"', "sum"],
      ["min:tree_cover", "Smallest Tree cover", '"Tree cover"', "low"],
      ["max:tree_cover", "Largest Tree cover", '"Tree cover"', "high"],
    ]);
  });

  it("count rows and distinct plots in a nested table", () => {
    const nested = measuresOf(cubeOf(data(), "land_cover", "en", t), t);
    expect(nested.slice(0, 2).map((m) => [m.id, m.expression, m.aggregate])).toEqual([
      ["rows", "integer(1)", "sum"],
      ["plots", '"Plot"', "distinct count"],
    ]);
  });
});

describe("the question bar and Perspective's configuration", () => {
  const q: Question = { rows: ["Land use 2025"], columns: ["Province"], measures: ["plots", "areaPct"], extra: [], filters: [["Collector", "in", ["ana"]]], chart: "Y Bar", order: "desc" };

  it("write the question into the configuration, keeping what the person set elsewhere", () => {
    const config = applyQuestion({ title: "Plots", expressions: { mine: '"Tree cover" * 2' }, aggregates: { mine: "avg" }, columns_config: { mine: { fixed: 0 } } }, { ...q, extra: ["mine"] }, measures);
    expect(config).toEqual({
      title: "Plots",
      plugin: "Y Bar",
      group_by: ["Land use 2025"],
      split_by: ["Province"],
      columns: ["Number of plots", "Area (% of the total)", "mine"],
      expressions: { mine: '"Tree cover" * 2', "Number of plots": "integer(1)", "Area (% of the total)": '"Area"' },
      aggregates: { mine: "avg", "Number of plots": "sum", "Area (% of the total)": "pct sum grand total" },
      columns_config: { mine: { fixed: 0 } },
      filter: [["Collector", "in", ["ana"]]],
      sort: [["Number of plots", "desc"]],
    });
  });

  it("read the question back from the configuration, whatever changed it", () => {
    expect(questionOf(applyQuestion({}, q, measures), measures)).toEqual(q);
    // a column of the person's own, named like a measure but not the measure's expression, is theirs
    expect(questionOf({ columns: ["Number of plots", "Tree cover", null], expressions: { "Number of plots": '"x"' }, sort: [["Number of plots", "asc"]] }, measures)).toMatchObject({
      measures: [],
      extra: ["Number of plots", "Tree cover"],
      order: "asc",
      chart: "Datagrid",
    });
  });

  it("drop a measure no longer chosen, with its expression", () => {
    const before = applyQuestion({}, q, measures);
    const after = applyQuestion(before, { ...q, measures: ["plots"], order: "name" }, measures);
    expect(after.columns).toEqual(["Number of plots"]);
    expect(Object.keys(after.expressions ?? {})).toEqual(["Number of plots"]);
    expect(after.sort).toEqual([]);
  });

  it("swap the rows and the columns", () => {
    expect(swapAxes(q)).toMatchObject({ rows: ["Province"], columns: ["Land use 2025"] });
  });
});

describe("filters", () => {
  it("by values, one filter per field, none for an empty list", () => {
    let f = withValuesFilter([["Province", "==", "Sofala"], ["Elevation", ">=", 10]], "Province", ["Tete", "Niassa"]);
    expect(f).toEqual([["Elevation", ">=", 10], ["Province", "in", ["Tete", "Niassa"]]]);
    expect(filterValues(f, "Province")).toEqual(["Tete", "Niassa"]);
    f = withValuesFilter(f, "Province", []);
    expect(f).toEqual([["Elevation", ">=", 10]]);
    expect(filterValues(f, "Province")).toBeNull();
  });

  it("by a range, either end optional", () => {
    expect(withRangeFilter([["Elevation", ">=", 10]], "Elevation", null, 500)).toEqual([["Elevation", "<=", 500]]);
    expect(withRangeFilter([], "Saved on", "2026-10-01", "")).toEqual([["Saved on", ">=", "2026-10-01"]]);
  });
});

describe("the drill-through", () => {
  it("turns Perspective's filters of a cell into SQL, by the kind of each column", () => {
    const { sql, partial } = whereSql(cube, [
      ["Land use 2025", "==", "Forest"],
      ["Province", "in", ["Tete", "O'Neil"]],
      ["Elevation", ">=", 100],
      ["Submitted", "==", true],
      ["Saved on", ">=", Date.UTC(2026, 9, 1)],
      ["Collector", "==", null],
      ["my formula", ">", 3],
    ]);
    expect(sql).toBe(
      `"Land use 2025" = 'Forest' AND "Province" IN ('Tete', 'O''Neil') AND "Elevation" >= 100 AND "Submitted" = TRUE AND "Saved on" >= CAST(epoch_ms(${Date.UTC(2026, 9, 1)}) AS DATE) AND "Collector" IS NULL`,
    );
    expect(partial).toBe(true);
    expect(whereSql(cube, []).sql).toBe("TRUE");
  });

  it("lists the plot, who collected it, the view's fields and what its measures read", () => {
    const q: Question = { rows: ["Land use 2025"], columns: ["Province"], measures: ["plots", "area", "avg:tree_cover"], extra: [], filters: [], chart: "Datagrid", order: "name" };
    const columns = drillColumns(cube, q, measures);
    expect(columns).toEqual(["Plot", "Collector", "Saved on", "Land use 2025", "Province", "Area", "Tree cover"]);
    const sql = drillSql(cube, [["Province", "==", "Tete"]], columns, 200);
    expect(sql.startsWith(`SELECT "Plot", "Collector", "Saved on", "Land use 2025", "Province", "Area", "Tree cover" FROM (${cube.sql}) AS cube WHERE "Province" = 'Tete' ORDER BY`)).toBe(true);
    expect(sql.endsWith("LIMIT 200")).toBe(true);
    expect(drillSql(cube, [], columns, null).includes("LIMIT")).toBe(false);
  });

  it("lists a field's values with the other filters applied", () => {
    const sql = valuesSql(cube, "Province", [["Province", "in", ["Tete"]], ["Land use 2025", "==", "Forest"]], 1000);
    expect(sql).toContain(`WHERE "Land use 2025" = 'Forest' AND "Province" IS NOT NULL GROUP BY 1 ORDER BY n DESC, 1 LIMIT 1000`);
  });
});

describe("the ready-made views", () => {
  it("are worked out from the survey: land use, by region, the change between two questions on one list, an average, the work", () => {
    const tpls = templatesOf(data(), cube, measures, t);
    expect(tpls.map((x) => [x.id, x.label])).toEqual([
      ["default", "Plots and area by Land use 2025"],
      ["byRegion", "Land use 2025 by Province"],
      ["change:land_use_category:land_use_2015", "Change: Land use 2025 → Land use 2015"],
      ["avg:tree_cover", "Average Tree cover by Land use 2025"],
      ["byCollector", "Plots by collector and month"],
      ["perWeek", "Plots saved per week"],
    ]);
    expect(tpls[2].question).toMatchObject({ rows: ["Land use 2025"], columns: ["Land use 2015"], measures: ["area"], filters: [["Assessment", "==", "First assessment"]] });
    expect(tpls[4].question).toMatchObject({ rows: ["Collector"], columns: ["Month saved"], filters: [] });
  });

  it("for a collector: no work by collector, their own weeks", () => {
    const own = data({ scope: "own", areas: null });
    const c = cubeOf(own, "plot", "en", t);
    const ids = templatesOf(own, c, measuresOf(c, t), t).map((x) => x.id);
    expect(ids).not.toContain("byCollector");
    expect(ids).toContain("perWeek");
  });
});

it("a view goes into a link and comes back", () => {
  const view = { table: "plot", language: "es", config: { group_by: ["Uso de la tierra – ñ"], filter: [["Región", "in", ["Norte"]]] as [string, string, unknown][] } };
  const text = encodeView(view);
  expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(decodeView(text)).toEqual(view);
  expect(decodeView("not a view")).toBeNull();
  expect(decodeView("")).toBeNull();
});
