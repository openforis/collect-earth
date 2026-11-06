import { describe, expect, it } from "vitest";
import type { AnalysisColumnModel, AnalysisData, AnalysisModelData, ProposedView } from "./api";
import { applyQuestion, measuresOf } from "./analysisQuestion";
import { mainQuestion, surveyRoles, templatesOf, viewOfProposal, viewTitle } from "./analysisSuggest";
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
  keyAttr: false,
  parent: null,
  relevantIf: null,
  ...over,
});
const item = (code: string, label: string, parent: string | null = null) => ({ code, labels: { en: label }, parent, level: parent ? 1 : 0 });

/** A land use survey as Collect Earth's templates make them (the one the page was tried with). */
const model: AnalysisModelData = {
  languages: ["en"],
  tables: [
    {
      name: "plot",
      labels: {},
      keyColumn: null,
      columns: [
        col("id", { keyAttr: true, labels: { en: "Plot - ID" } }),
        col("round", { type: "code", list: "assessment_phases", keyAttr: true, labels: { en: "Plot - Assessment phase" } }),
        col("operator", { labels: { en: "Plot - Operator" } }),
        col("actively_saved", { type: "boolean", labels: { en: "Plot - Actively saved by user" } }),
        col("elevation", { type: "integer", fromPlotFile: true, labels: { en: "DEM - Elevation" } }),
        col("calculated_slope", { type: "code", list: "slopes", calculated: true, labels: { en: "DEM - Slope - ranges" } }),
        col("climate", { type: "code", list: "climates", fromPlotFile: true, labels: { en: "IPCC - Climate" } }),
        col("province", { fromPlotFile: true, labels: { en: "Province" } }),
        col("lu_t2", { type: "code", list: "land_uses", labels: { en: "Land use" } }),
        col("sub_t2", { type: "code", list: "land_uses", parent: "lu_t2", labels: { en: "LU subdivision" } }),
        col("change2", { type: "boolean", labels: { en: "Any change?" } }),
        col("confidentt2", { type: "boolean", labels: { en: "Are you confident with the interpretation?" } }),
        col("change2_yr", { type: "code", list: "years", relevantIf: "change2", labels: { en: "Year of change" } }),
        col("from_lu18", { type: "code", list: "land_uses", relevantIf: "change2", labels: { en: "From LU" } }),
        col("from_sub18", { type: "code", list: "land_uses", parent: "from_lu18", relevantIf: "change2", labels: { en: "From LU subdivision" } }),
        col("commercial2", { type: "code", list: "commercial", labels: { en: "Commercial?" } }),
        col("disturbance2", { type: "code", list: "disturbances", relevantIf: "change2", labels: { en: "Any Disturbance?" } }),
        col("disturbance16", { type: "code", list: "disturbances", labels: { en: "Any Disturbance?" } }),
        col("from_lu16", { type: "code", list: "land_uses", labels: { en: "From LU" } }),
      ],
    },
  ],
  lists: {
    assessment_phases: [item("1", "First assessment"), item("2", "Re-Assessment")],
    land_uses: [
      item("F", "Forest"),
      item("Forest_type1", "Forest type 1", "F"),
      item("Forest_type2", "Forest type 2", "F"),
      item("C", "Cropland"),
      item("Annual", "Annual crops", "C"),
      item("G", "Grassland"),
      item("S", "Settlement"),
      item("W", "Wetland"),
      item("O", "Other land"),
    ],
    years: [item("2025", "2025"), item("2024", "2024"), item("2023", "2023")],
    disturbances: [item("fire", "Human induced fire"), item("logging", "Selective logging"), item("none", "None")],
    slopes: [item("FLAT", "0-5")],
    commercial: [item("commercial", "commercial"), item("non_commercial", "non_commercial")],
    climates: [item("1", "WTM")],
  },
};
const data = (over: Partial<AnalysisData> = {}): AnalysisData => ({ model, scope: "project", areas: null, tables: [], ...over });
const t = translator("en");
const cube = cubeOf(data(), "plot", "en", t);
const measures = measuresOf(cube, t);

describe("what the survey is about", () => {
  it("its main question is the first code answered: not a key (the assessment phase), not the plot file's, not worked out", () => {
    expect(mainQuestion(model)?.name).toBe("lu_t2");
    // Collect Earth's own land_use_category comes first, even when worked out from the subdivision
    const withCategory = { ...model, tables: [{ ...model.tables[0], columns: [col("land_use_category", { type: "code", list: "land_uses", calculated: true }), ...model.tables[0].columns] }] };
    expect(mainQuestion(withCategory)?.name).toBe("land_use_category");
  });

  it("finds its subdivision, the land use before, the year of the change, the questions of a few options and the yes/no ones", () => {
    const roles = surveyRoles(model);
    expect(roles.child?.name).toBe("sub_t2");
    expect(roles.from?.name).toBe("from_lu18");
    expect(roles.year?.name).toBe("change2_yr");
    // the disturbance first; one per label: the same question asked again for an earlier change is not another view
    expect(roles.few.map((c) => c.name)).toEqual(["disturbance2", "commercial2"]);
    expect(roles.yesNo.map((c) => c.name)).toEqual(["confidentt2", "change2"]);
  });
});

describe("the ready-made views", () => {
  const tpls = templatesOf(data(), cube, measures, t);

  it("are named in plain words with the questions' labels", () => {
    expect(tpls.map((x) => [x.id, x.label])).toEqual([
      ["default", "Plots by Land use"],
      ["child:sub_t2", "Land use by LU subdivision"],
      ["change:from_lu18:lu_t2", "Change: From LU → Land use"],
      ["year:change2_yr", "Plots by Year of change"],
      ["count:disturbance2", "Plots by Any Disturbance?"],
      ["count:commercial2", "Plots by Commercial?"],
      ["yesno:confidentt2", "Are you confident with the interpretation? by Land use"],
      ["yesno:change2", "Any change? by Land use"],
      ["byRegion", "Land use by Province"],
      ["byCollector", "Plots by collector and month"],
      ["perWeek", "Plots saved per week"],
    ]);
  });

  it("open on the main question: the number of plots, as horizontal bars, largest first, first assessments only", () => {
    expect(tpls[0].question).toEqual({ rows: ["Land use"], columns: [], measures: ["plots"], extra: [], filters: [["Assessment", "==", "First assessment"]], chart: "X Bar", order: "desc" });
    // with the areas of the project file: the area
    const withAreas = data({ areas: { source: "region_areas.csv", plots: 30, unmatched: 0 } });
    const c = cubeOf(withAreas, "plot", "en", t);
    expect(templatesOf(withAreas, c, measuresOf(c, t), t)[0]).toMatchObject({ label: "Area by Land use", question: { measures: ["area"] } });
  });

  it("draw each chart its own way: stacked bars by the subdivision, a heat map of the change among the plots that changed, bars over the years", () => {
    const by = (id: string) => tpls.find((x) => x.id === id)!.question;
    expect(by("child:sub_t2")).toMatchObject({ rows: ["Land use"], columns: ["LU subdivision"], chart: "Y Bar" });
    expect(by("change:from_lu18:lu_t2")).toMatchObject({
      rows: ["Land use"],
      columns: ["From LU"],
      chart: "Heatmap",
      filters: [
        ["Assessment", "==", "First assessment"],
        ["Any change?", "==", "Yes"],
      ],
    });
    expect(by("year:change2_yr")).toMatchObject({ rows: ["Year of change"], chart: "Y Bar", filters: [["Assessment", "==", "First assessment"], ["Any change?", "==", "Yes"]] });
    expect(by("count:disturbance2")).toMatchObject({ chart: "X Bar", order: "desc" });
    expect(by("yesno:confidentt2")).toMatchObject({ rows: ["Land use"], columns: ["Are you confident with the interpretation?"], chart: "Y Bar" });
    // the work over time as lines
    expect(by("perWeek")).toMatchObject({ rows: ["Week saved"], chart: "Y Line" });
  });

  it("title a change matrix with which side is the land use before and which after", () => {
    const change = tpls.find((x) => x.change)!;
    expect(viewTitle(change, change.question, t)).toBe("Change from From LU (up the side) to Land use (along the bottom)");
    expect(viewTitle(change, { ...change.question, chart: "Datagrid" }, t)).toBe("Change from From LU (in the columns) to Land use (in the rows)");
    expect(viewTitle(change, { ...change.question, rows: ["From LU"], columns: ["Land use"], chart: "Datagrid" }, t)).toBe("Change from From LU (in the rows) to Land use (in the columns)");
    // asked something else since: the view's own name
    expect(viewTitle(change, { ...change.question, rows: ["Collector"] }, t)).toBe(change.label);
    expect(viewTitle(tpls[0], tpls[0].question, t)).toBe("Plots by Land use");
  });

  it("for a collector: their own weeks, no work by collector, no assessment filter", () => {
    const own = data({ scope: "own" });
    const c = cubeOf(own, "plot", "en", t);
    const mine = templatesOf(own, c, measuresOf(c, t), t);
    expect(mine.map((x) => x.id)).not.toContain("byCollector");
    expect(mine.find((x) => x.id === "perWeek")?.label).toBe("My plots per week");
    expect(mine[0].question.filters).toEqual([]);
  });

  it("without a code question: all the plots", () => {
    const bare: AnalysisModelData = { ...model, tables: [{ ...model.tables[0], columns: [col("id", { keyAttr: true })] }] };
    const d = data({ model: bare });
    const c = cubeOf(d, "plot", "en", t);
    expect(templatesOf(d, c, measuresOf(c, t), t)[0]).toMatchObject({ id: "default", label: "All plots" });
  });
});

describe("the AI assistant's proposals", () => {
  const proposal = (over: Partial<ProposedView>): ProposedView => ({ title: "x", why: "y", rows: ["lu_t2"], columns: [], measures: ["plots"], chart: "hbars", filters: [], order: "largest", ...over });

  it("become questions of the bar over the cube, their codes the labels the cube shows", () => {
    const q = viewOfProposal(
      proposal({
        columns: ["from_lu18"],
        chart: "heatmap",
        filters: [
          { column: "change2", op: "yes" },
          { column: "lu_t2", op: "isNot", codes: ["O"] },
          { column: "disturbance2", op: "answered" },
          { column: "elevation", op: "atLeast", value: 500 },
        ],
        measures: ["plotsPct", "made_up"],
        order: "smallest",
      }),
      cube,
      measures,
      t,
    );
    expect(q).toEqual({
      rows: ["Land use"],
      columns: ["From LU"],
      measures: ["plotsPct"],
      extra: [],
      filters: [
        ["Any change?", "==", "Yes"],
        ["Land use", "not in", ["Other land"]],
        ["Any Disturbance?", "!=", "No answer"],
        ["DEM - Elevation", ">=", 500],
      ],
      chart: "Heatmap",
      order: "asc",
    });
    // it opens as any view does
    expect(applyQuestion({}, q!, measures, cube)).toMatchObject({ plugin: "Heatmap", group_by: ["Land use"], split_by: ["From LU"] });
  });

  it("are left out when they name a field the cube has not; lines only along time; the count when no measure is known", () => {
    expect(viewOfProposal(proposal({ rows: ["nowhere"] }), cube, measures, t)).toBeNull();
    expect(viewOfProposal(proposal({ columns: ["nowhere"] }), cube, measures, t)).toBeNull();
    expect(viewOfProposal(proposal({ chart: "lines" }), cube, measures, t)?.chart).toBe("Y Bar");
    expect(viewOfProposal(proposal({ rows: ["_saved_week"], chart: "lines" }), cube, measures, t)?.chart).toBe("Y Line");
    expect(viewOfProposal(proposal({ measures: ["nothing"] }), cube, measures, t)?.measures).toEqual(["plots"]);
  });
});
