import { describe, expect, it } from "vitest";
import { questionLabel, summaryTable } from "./analysisSummaryView";
import type { AnalysisSummary } from "./api";

const words = { yes: "Yes", no: "No", none: "No answer" };
const base: AnalysisSummary = {
  languages: ["en", "es"],
  questions: [
    { name: "land_use", labels: { en: "Land use", es: "Uso del suelo" }, type: "code", list: "lu" },
    { name: "changed", labels: { "": "Changed" }, type: "boolean", list: null },
  ],
  lists: {
    lu: [
      { code: "F", labels: { en: "Forest", es: "Bosque" }, parent: null, level: 0 },
      { code: "C", labels: { en: "Cropland" }, parent: null, level: 0 },
      { code: "W", labels: { en: "Wetland" }, parent: null, level: 0 },
    ],
  },
  row: null,
  column: null,
  cells: [],
  plots: 0,
  hasAreas: false,
};

describe("a reviewer's summary", () => {
  it("names the questions in the reader's language, else the survey's first", () => {
    expect(questionLabel(base, "land_use", "es")).toBe("Uso del suelo");
    expect(questionLabel(base, "land_use", "fr")).toBe("Land use");
    expect(questionLabel(base, "changed", "fr")).toBe("Changed");
  });

  it("is nothing until a question is chosen", () => {
    expect(summaryTable(base, "en", words)).toBeNull();
  });

  it("lists the answers that have plots in the list's order, not answered last, with their areas", () => {
    const table = summaryTable(
      { ...base, row: "land_use", hasAreas: true, plots: 6, cells: [
        { row: "", column: null, plots: 1, area: 10 },
        { row: "C", column: null, plots: 2, area: 20 },
        { row: "F", column: null, plots: 3, area: 30.5 },
      ] },
      "es",
      words,
    )!;
    expect(table.rows.map((r) => [r.label, r.plots, r.area])).toEqual([["Bosque", 3, 30.5], ["Cropland", 2, 20], ["No answer", 1, 10]]);
    expect(table).toMatchObject({ columns: [], plots: 6, area: 60.5 });
  });

  it("crosses two questions", () => {
    const table = summaryTable(
      { ...base, row: "land_use", column: "changed", plots: 5, cells: [
        { row: "F", column: "false", plots: 2, area: null },
        { row: "F", column: "true", plots: 1, area: null },
        { row: "C", column: "true", plots: 2, area: null },
      ] },
      "en",
      words,
    )!;
    expect(table.columns.map((c) => c.label)).toEqual(["Yes", "No"]);
    expect(table.rows.map((r) => [r.label, r.plots, r.cells])).toEqual([["Forest", 3, [1, 2]], ["Cropland", 2, [2, 0]]]);
    expect(table.area).toBeNull();
  });
});
