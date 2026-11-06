import { describe, expect, it } from "vitest";
import type { AnalysisData, AnalysisModelData } from "./api";
import { codesCsv, cubeOf, defaultView, fitToCube, labelIn, parseSavedViews, readCsvSql, tableChoices, translateView, withSavedView } from "./analysisView";
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
  languages: ["en", "es"],
  tables: [
    {
      name: "plot",
      labels: {},
      keyColumn: null,
      columns: [
        col("id", { labels: { en: "Plot id" } }),
        col("province", { fromPlotFile: true }),
        col("land_use_category", { type: "code", list: "land_uses", labels: { en: "Land use", es: "Uso de la tierra" } }),
        col("land_use_subdivision", { type: "code", list: "land_uses", labels: { en: "Land use" } }),
        col("tree_percentage", { type: "integer", labels: { en: "Trees (%)", es: "Árboles (%)" } }),
        col("confident", { type: "boolean", labels: { en: "Confident?" } }),
        col("planted", { type: "integer", labels: { en: "Year planted" } }),
      ],
    },
    {
      name: "land_cover",
      labels: { en: "Land cover", es: "Cobertura" },
      keyColumn: "element",
      columns: [col("element", { type: "code", list: "elements", labels: { en: "Element" } }), col("percentage", { type: "integer", labels: { en: "Percentage" } })],
    },
  ],
  lists: {
    land_uses: [
      { code: "F", labels: { en: "Forest", es: "Bosque" }, parent: null, level: 0 },
      { code: "broadleaf", labels: { en: "Broadleaf, \"dense\"" }, parent: "F", level: 1 },
      { code: "C", labels: { en: "Cropland" }, parent: null, level: 0 },
    ],
    elements: [{ code: "trees", labels: { en: "Trees" }, parent: null, level: 0 }],
    empty: [],
  },
};
const data = (over: Partial<AnalysisData> = {}): AnalysisData => ({ model, scope: "project", areas: { source: "region_areas.csv", plots: 3, unmatched: 0 }, tables: [], ...over });
const en = translator("en");
const es = translator("es");

describe("labels", () => {
  it("takes the language's, else the survey's default language's, else the name", () => {
    expect(labelIn({ en: "Forest", es: "Bosque" }, "es", model, "F")).toBe("Bosque");
    expect(labelIn({ en: "Forest" }, "fr", model, "F")).toBe("Forest");
    expect(labelIn({}, "fr", model, "F")).toBe("F");
    expect(labelIn({ "": " Plain " }, "en", model, "x")).toBe("Plain");
  });
});

describe("the code tables", () => {
  it("give each item its label and the labels of the levels above it", () => {
    const { csv, columns } = codesCsv(model, "es");
    expect(columns.map(([n]) => n)).toEqual(["list", "code", "label", "level_0"]);
    const lines = csv.trim().split("\n");
    expect(lines).toContain("land_uses,F,Bosque,Bosque");
    // no Spanish label: the survey's default language; the level above in Spanish
    expect(lines).toContain('land_uses,broadleaf,"Broadleaf, ""dense""",Bosque');
    expect(lines).toContain("elements,trees,Trees,Trees");
  });
});

describe("the cube of a table", () => {
  it("names the plot's columns by their labels, each code with its label, its code and its level above", () => {
    const cube = cubeOf(data(), "plot", "en", en);
    expect(cube.columns.map((c) => c.name)).toEqual([
      "Plot",
      "Collector",
      "Round",
      "Assessment",
      "Submitted",
      "Saved on",
      "Month saved",
      "Week saved",
      "Plot id",
      "province",
      "Land use",
      "Land use (code)",
      "Land use (level 1)",
      // the same label twice: the second one is told apart by its name
      "Land use (land_use_subdivision)",
      "Land use (code) (land_use_subdivision)",
      "Land use (level 1) (land_use_subdivision)",
      "Trees (%)",
      "Confident?",
      "Year planted",
      "Area",
      "Plot weight",
    ]);
    expect(cube.sql).toContain(`LEFT JOIN _codes c0 ON c0.list = 'land_uses' AND c0.code = t."land_use_category"`);
    // an empty answer is "No answer", not null, in the rows, columns and legends
    expect(cube.sql).toContain(`COALESCE(c0.label, t."land_use_category", 'No answer') AS "Land use"`);
    expect(cube.sql).toContain(`COALESCE(t."land_use_category", 'No answer') AS "Land use (code)"`);
    expect(cube.sql).toContain(`COALESCE(c0.level_0, 'No answer') AS "Land use (level 1)"`);
    expect(cube.columns.find((c) => c.name === "Land use")).toMatchObject({ list: "land_uses", source: "land_use_category", values: { F: "Forest", "": "No answer" } });
    expect(cube.sql).toContain(`CASE t._assessment WHEN 'main' THEN 'First assessment'`);
    expect(cube.sql.endsWith("FROM plot t LEFT JOIN _codes c0 ON c0.list = 'land_uses' AND c0.code = t.\"land_use_category\" LEFT JOIN _codes c1 ON c1.list = 'land_uses' AND c1.code = t.\"land_use_subdivision\"")).toBe(true);
  });

  it("says yes and no in words, and which fields follow time", () => {
    const cube = cubeOf(data(), "plot", "es", es);
    const confident = cube.columns.find((c) => c.id === "confident")!;
    expect(confident).toMatchObject({ kind: "text", values: { true: "Sí", false: "No", "": "Sin respuesta" } });
    expect(cube.sql).toContain(`CASE t."confident" WHEN TRUE THEN 'Sí' WHEN FALSE THEN 'No' ELSE 'Sin respuesta' END AS "Confident?"`);
    const time = cube.columns.filter((c) => c.time).map((c) => c.id);
    expect(time).toEqual(["_saved_on", "_saved_month", "_saved_week", "planted"]);
  });

  it("gives a collector no round and no assessment, and leaves the area out without an areas file", () => {
    const names = cubeOf(data({ scope: "own", areas: null }), "plot", "en", en).columns.map((c) => c.name);
    expect(names).not.toContain("Round");
    expect(names).not.toContain("Assessment");
    expect(names).not.toContain("Area");
  });

  it("puts each nested entity beside the answers of its plot", () => {
    const cube = cubeOf(data(), "land_cover", "es", es);
    expect(cube.columns.slice(0, 4).map((c) => c.name)).toEqual(["Element", "Element (código)", "Percentage", "Parcela"]);
    expect(cube.columns.find((c) => c.id === "plot.land_use_category")?.name).toBe("Uso de la tierra");
    expect(cube.columns.some((c) => c.id === "expansion_factor")).toBe(false);
    expect(cube.sql).toContain(`FROM "land_cover" t JOIN plot p ON p._record = t._record`);
  });

  it("lists the tables by their labels", () => {
    expect(tableChoices(model, "es", es)).toEqual([
      { name: "plot", label: "Parcelas" },
      { name: "land_cover", label: "Cobertura" },
    ]);
  });
});

describe("the default view", () => {
  it("adds up the area by land use as horizontal bars, largest first, first assessments only for coordinators", () => {
    const cube = cubeOf(data(), "plot", "en", en);
    expect(defaultView(data(), cube, en)).toMatchObject({
      plugin: "X Bar",
      settings: false,
      group_by: ["Land use"],
      // each bar in its land use's colour (analysisQuestion.ts, colouredByRows)
      split_by: ["Land use"],
      columns: ["Total area"],
      expressions: { "Total area": '"Area"' },
      aggregates: { "Total area": "sum" },
      filter: [["Assessment", "==", "First assessment"]],
      sort: [["Total area", "desc"]],
    });
  });

  it("for a collector: their plots, without a filter; for an entity: rows by its key", () => {
    const own = data({ scope: "own", areas: null });
    expect(defaultView(own, cubeOf(own, "plot", "en", en), en)).toMatchObject({ columns: ["Number of plots"], filter: [] });
    expect(defaultView(data(), cubeOf(data(), "land_cover", "en", en), en)).toMatchObject({ group_by: ["Element"], columns: ["Number of rows", "Number of plots"] });
  });
});

describe("saved views", () => {
  it("are translated to another language, the person's own expressions kept", () => {
    const from = cubeOf(data(), "plot", "en", en);
    const to = cubeOf(data(), "plot", "es", es);
    const config = {
      plugin: "Y Bar",
      group_by: ["Land use"],
      split_by: ["Collector"],
      columns: ["Area", null, "share"],
      aggregates: { Area: "sum" },
      filter: [["Assessment", "==", "First assessment"], ["Land use", "in", ["Forest", "Mine"]], ["Collector", "==", "Forest"]] as [string, string, unknown][],
      sort: [["Trees (%)", "desc"]] as [string, string][],
      expressions: { share: '"Trees (%)" / 100 + "unknown"' },
      columns_config: { Area: { fixed: 0 } },
    };
    expect(translateView(config, from, to)).toEqual({
      plugin: "Y Bar",
      group_by: ["Uso de la tierra"],
      split_by: ["Recolector"],
      columns: ["Área", null, "share"],
      aggregates: { Área: "sum" },
      // the labels of the values too; the person's own values are kept
      filter: [["Evaluación", "==", "Primera evaluación"], ["Uso de la tierra", "in", ["Bosque", "Mine"]], ["Recolector", "==", "Forest"]],
      sort: [["Árboles (%)", "desc"]],
      expressions: { share: '"Árboles (%)" / 100 + "unknown"' },
      columns_config: { Área: { fixed: 0 } },
    });
  });

  it("are read from storage leniently and replaced by name", () => {
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews("not json")).toEqual([]);
    expect(parseSavedViews(JSON.stringify([{ name: "A", table: "plot", language: "en", config: {} }, { name: "", table: "plot" }, 3]))).toHaveLength(1);
    const a = { name: "B", table: "plot", language: "en", config: { plugin: "Datagrid" } };
    const views = withSavedView(withSavedView([], a), { ...a, config: { plugin: "Y Bar" } });
    expect(views).toEqual([{ ...a, config: { plugin: "Y Bar" } }]);
    expect(withSavedView(views, { ...a, name: "A" }).map((v) => v.name)).toEqual(["A", "B"]);
  });
});

it("reads a table's CSV with the types the server states", () => {
  expect(readCsvSql("land_cover", "land_cover.csv", [["_record", "VARCHAR"], ["it's", "BIGINT"]])).toBe(
    `CREATE OR REPLACE TABLE "land_cover" AS SELECT * FROM read_csv('land_cover.csv', header = true, auto_detect = false, delim = ',', quote = '"', escape = '"', columns = {'_record': 'VARCHAR', 'it''s': 'BIGINT'})`,
  );
});

it("fits a view saved when yes/no questions were true and false to the words they are now", () => {
  const cube = cubeOf(data(), "plot", "en", en);
  expect(fitToCube({ filter: [["Confident?", "==", true], ["Confident?", "in", [false, "Yes"]], ["Land use", "==", true]] }, cube).filter).toEqual([
    ["Confident?", "==", "Yes"],
    ["Confident?", "in", ["No", "Yes"]],
    ["Land use", "==", true],
  ]);
});

it("fits a view to the table it opens on: a collector's has no assessment, a coordinator's shared view filters on it", () => {
  const own = cubeOf(data({ scope: "own" }), "plot", "en", en);
  expect(
    fitToCube(
      {
        group_by: ["Land use", "Round"],
        split_by: ["Assessment"],
        columns: ["Number of plots", "gone", null],
        expressions: { "Number of plots": "integer(1)", gone: '"Round" * 2', keep: '"Trees (%)" + 1' },
        aggregates: { "Number of plots": "sum", gone: "sum" },
        filter: [["Assessment", "==", "First assessment"], ["Land use", "==", "Forest"]],
        sort: [["Round", "asc"]],
      },
      own,
    ),
  ).toEqual({
    group_by: ["Land use"],
    split_by: [],
    columns: ["Number of plots", null],
    expressions: { "Number of plots": "integer(1)", keep: '"Trees (%)" + 1' },
    aggregates: { "Number of plots": "sum" },
    filter: [["Land use", "==", "Forest"]],
    sort: [],
  });
});
