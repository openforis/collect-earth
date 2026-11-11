import { describe, expect, it } from "vitest";
import type { PlotPeriod } from "./api";
import { matrixTable, periodRows, plotsToShow, repeatName } from "./repeatSurveyView";

describe("a repeat survey's earlier answers", () => {
  const periods: PlotPeriod[] = [
    { label: "2020", savedAt: 1, answers: { land: "F", canopy: "60", note: "" } },
    { label: "2025", savedAt: 2, answers: { land: "C", slope: "4" } },
  ];

  it("shows the header's questions first, even unanswered, then the others answered", () => {
    expect(periodRows(periods, ["land", "missing"])).toEqual([
      { key: "land", header: true, values: ["F", "C"] },
      { key: "missing", header: true, values: [null, null] },
      { key: "canopy", header: false, values: ["60", null] },
      { key: "slope", header: false, values: [null, "4"] },
    ]);
    expect(periodRows([], ["land"])).toEqual([{ key: "land", header: true, values: [] }]);
  });

  it("names the new project after the earlier one", () => {
    expect(repeatName("Land use 2020", "2020", "2025")).toBe("Land use 2025");
    expect(repeatName("Land use", "2020", "2025")).toBe("Land use 2025");
  });
});

describe("a repeat survey's change", () => {
  it("lays the transition matrix out in the question's order, with totals", () => {
    const table = matrixTable(
      [{ from: "F", to: "F", plots: 5 }, { from: "F", to: "C", plots: 2 }, { from: "X", to: "C", plots: 1 }],
      [{ code: "C", label: "Cropland" }, { code: "F", label: "Forest" }, { code: "G", label: "Grassland" }],
    );
    // the codes used only, in the question's order, then the unknown ones
    expect(table.codes.map((c) => c.code)).toEqual(["C", "F", "X"]);
    expect(table.cell("F", "C")).toBe(2);
    expect(table.cell("C", "F")).toBe(0);
    expect(table.rowTotal("F")).toBe(7);
    expect(table.colTotal("C")).toBe(3);
    expect(table.total).toBe(8);
  });

  it("lists the plots to look at", () => {
    const rows = [
      { plot: "1", outcome: "changed", mismatch: null },
      { plot: "2", outcome: "unchanged", mismatch: "changedButSame" },
      { plot: "3", outcome: "corrected", mismatch: null },
    ];
    expect(plotsToShow(rows, "changed").map((r) => r.plot)).toEqual(["1"]);
    expect(plotsToShow(rows, "corrected").map((r) => r.plot)).toEqual(["3"]);
    expect(plotsToShow(rows, "mismatch").map((r) => r.plot)).toEqual(["2"]);
  });
});
