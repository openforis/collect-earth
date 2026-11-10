import { describe, expect, it } from "vitest";
import type { AnalysisData, AnalysisModelData } from "./api";
import { changeChoiceSql, childField, changeFields, defaultChange, drillDown, flowsSql, mapPlotsSql, pickChange, quickFilterFields, sankeyLayout } from "./analysisInsights";
import type { Question } from "./analysisQuestion";
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
const lu = (code: string, en: string, parent: string | null = null) => ({ code, labels: { en }, parent, level: parent ? 1 : 0 });

const model: AnalysisModelData = {
  languages: ["en"],
  tables: [
    {
      name: "plot",
      labels: {},
      keyColumn: null,
      columns: [
        col("id"),
        col("province", { fromPlotFile: true }),
        col("land_use_category", { type: "code", list: "land_uses", labels: { en: "Land use" } }),
        col("land_use_subdivision", { type: "code", list: "land_uses", parent: "land_use_category", labels: { en: "Subdivision" } }),
        col("previous_land_use", { type: "code", list: "land_uses", labels: { en: "Land use before" } }),
        col("year_of_change", { type: "code", list: "years", labels: { en: "Year of change" } }),
        col("tree_percentage", { type: "integer", labels: { en: "Trees (%)" } }),
      ],
    },
  ],
  lists: {
    land_uses: [lu("F", "Forest"), lu("broadleaf", "Broadleaf", "F"), lu("C", "Cropland"), lu("G", "Grassland"), lu("S", "Settlement")],
    years: [lu("2001", "2001"), lu("2002", "2002")],
  },
};
const data: AnalysisData = { model, scope: "project", areas: null, tables: [] };
const cube = cubeOf(data, "plot", "en", translator("en"));
const q = (over: Partial<Question> = {}): Question => ({ rows: ["Land use"], columns: [], measures: ["plots"], extra: [], filters: [], chart: "X Bar", order: "desc", ...over });

describe("quick filters", () => {
  it("offers the main question, the year of its change, the region and the collector", () => {
    expect(quickFilterFields(model, cube)).toEqual(["Land use", "Year of change", "province", "Collector"]);
  });
});

describe("drill down", () => {
  it("goes from a land use to the question refining it, and through a code's levels to its label", () => {
    expect(childField(model, cube, "Land use")?.name).toBe("Subdivision");
    expect(childField(model, cube, "Subdivision (level 1)")?.name).toBe("Subdivision");
    expect(childField(model, cube, "Subdivision")).toBeUndefined();
    expect(childField(model, cube, "Trees (%)")).toBeUndefined();
  });

  it("filters to the bar clicked and shows what is inside it", () => {
    const step = drillDown(model, cube, q({ filters: [["Assessment", "==", "First assessment"]] }), [["Land use", "==", "Forest"]]);
    expect(step).toEqual({
      field: "Land use",
      value: "Forest",
      question: q({ rows: ["Subdivision"], filters: [["Assessment", "==", "First assessment"], ["Land use", "==", "Forest"]] }),
    });
  });

  it("has nothing to go down to at the bottom, for a total or when the field below is already shown", () => {
    expect(drillDown(model, cube, q({ rows: ["Subdivision"] }), [["Subdivision", "==", "Broadleaf"]])).toBeNull();
    expect(drillDown(model, cube, q(), [["Land use", "==", null]])).toBeNull();
    expect(drillDown(model, cube, q({ columns: ["Subdivision"] }), [["Land use", "==", "Forest"]])).toBeNull();
  });
});

describe("land use change flows", () => {
  it("draws from the land use before to the main one, among the questions on the land uses' list", () => {
    expect(changeFields(model, cube).map((c) => c.name)).toEqual(["Land use", "Subdivision", "Land use before"]);
    expect(defaultChange(model, cube)).toEqual({ from: "Land use before", to: "Land use" });
  });

  it("adds up the plots or the area of each pair answered on both sides, with the view's filters", () => {
    const sql = flowsSql(cube, "Land use before", "Land use", null, [["province", "==", "North"]], "No answer");
    expect(sql).toMatch(
      /^SELECT "Land use before" AS source, "Land use" AS target, count\(\*\) AS value FROM \(.*\) AS cube WHERE "province" = 'North' AND "Land use before" <> 'No answer' AND "Land use" <> 'No answer' GROUP BY 1, 2 HAVING count\(\*\) > 0/,
    );
    expect(flowsSql(cube, "a", "b", "Area (ha)", [], "No answer")).toContain('sum("Area (ha)") AS value');
  });

  it("scores each field as the land use before by its answers on the same level and its changes", () => {
    const sql = changeChoiceSql(cube, ["Land use before", "Subdivision"], "Land use", "No answer", []);
    expect(sql).toContain(`count(*) FILTER (WHERE "Land use before" IN (SELECT DISTINCT "Land use" FROM (`);
    expect(sql).toMatch(/AS a0, count\(\*\) FILTER \(WHERE "Land use before" IN .* AND "Land use before" <> "Land use"\) AS c0, .* AS a1, .* AS c1 FROM/);
  });

  it("draws first the field with the most changes among those answered on the level of the land use after", () => {
    const fields = ["Land use 2000", "Land use 2020", "Subdivision before", "Land use now"];
    // the subdivision is never on the land use's level; the copy of the land use never changes
    expect(pickChange(fields, { a0: 90, c0: 30, a1: 100, c1: 12, a2: 0, c2: 0, a3: 100, c3: 0 })).toBe("Land use 2000");
    // a field answered for few plots (asked only after a change) does not win on its changes alone
    expect(pickChange(fields, { a0: 20, c0: 20, a1: 100, c1: 12, a2: 0, c2: 0, a3: 100, c3: 0 })).toBe("Land use 2020");
    expect(pickChange(fields, { a0: 100, c0: 0, a1: 0, c1: 0, a2: 0, c2: 0, a3: 0, c3: 0 })).toBeNull();
    expect(pickChange(fields, undefined)).toBeNull();
  });

  it("stacks each side largest first and gives each band its share of both ends", () => {
    const { nodes, links } = sankeyLayout(
      [
        { source: "Forest", target: "Forest", value: 6 },
        { source: "Forest", target: "Cropland", value: 2 },
        { source: "Grassland", target: "Cropland", value: 2 },
      ],
      110,
      10,
    );
    // 100 px for 10 plots once the one gap is taken
    expect(nodes).toEqual([
      { side: "left", name: "Forest", value: 8, y: 0, h: 80 },
      { side: "left", name: "Grassland", value: 2, y: 90, h: 20 },
      { side: "right", name: "Forest", value: 6, y: 0, h: 60 },
      { side: "right", name: "Cropland", value: 4, y: 70, h: 40 },
    ]);
    const band = (s: string, t: string) => links.find((l) => l.source === s && l.target === t)!;
    expect([band("Forest", "Forest").y0, band("Forest", "Forest").y1]).toEqual([0, 0]);
    expect([band("Forest", "Cropland").y0, band("Forest", "Cropland").y1, band("Forest", "Cropland").w]).toEqual([60, 70, 20]);
    expect([band("Grassland", "Cropland").y0, band("Grassland", "Cropland").y1]).toEqual([90, 90]);
    expect(sankeyLayout([], 100, 10)).toEqual({ nodes: [], links: [] });
  });
});

describe("the plots on a map", () => {
  it("lists each plot once with its value of the chart's field", () => {
    expect(mapPlotsSql(cube, "Land use", [])).toMatch(/^SELECT "Plot" AS plot, any_value\("Land use"\) AS value FROM \(.*\) AS cube WHERE TRUE AND "Plot" IS NOT NULL GROUP BY 1$/);
  });
});
