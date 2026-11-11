import { describe, expect, it } from "vitest";
import type { PlotPeriod } from "./api";
import { areaText, classRows, matrixTable, parseArea, periodRows, plotsToShow, repeatName, thinStrata } from "./repeatSurveyView";

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

describe("the areas of the changes", () => {
  const e = (area: number, share: number, ci: number, uncertainty: number | null) => ({ plots: 1, area, share, se: ci / 1.96, ci, uncertainty });

  it("shows hectares with their interval when the area is known, else a percentage of the whole", () => {
    expect(areaText(e(2500, 0.5, 4900, 196), { areaKnown: true, totalArea: 5000 }, "en")).toEqual({ value: "2,500 ha", ci: "± 4,900 ha", uncertainty: "196 %" });
    expect(areaText(e(12.34, 0.1, 3.21, 26), { areaKnown: true, totalArea: 123.4 }, "en").value).toBe("12.3 ha");
    // a share: the area and its interval over the whole, as percentages
    expect(areaText(e(0.5, 0.5, 0.98, 196), { areaKnown: false, totalArea: 1 }, "en")).toEqual({ value: "50 %", ci: "± 98 %", uncertainty: "196 %" });
    // a net change is signed; none has no uncertainty
    expect(areaText(e(-2500, -0.5, 4900, 196), { areaKnown: true, totalArea: 5000 }, "en", true).value).toBe("-2,500 ha");
    expect(areaText(e(2500, 0.5, 4900, 196), { areaKnown: true, totalArea: 5000 }, "en", true).value).toBe("+2,500 ha");
    expect(areaText(e(0, 0, 0, null), { areaKnown: true, totalArea: 5000 }, "en", true)).toMatchObject({ value: "0 ha", uncertainty: "—" });
    expect(areaText(e(1234, 0.5, 10, 1), { areaKnown: true, totalArea: 2468 }, "es").value).toBe("1234 ha");
  });

  it("lists the answers in the question's order, with their names", () => {
    const a = e(1, 1, 0, 0);
    const rows = classRows({ classes: [{ code: "Z", then: a, now: a, net: a }, { code: "C", then: a, now: a, net: a }, { code: "F", then: a, now: a, net: a }] }, [{ code: "F", label: "Forest" }, { code: "C", label: "Cropland" }]);
    expect(rows.map((r) => [r.code, r.label])).toEqual([["F", "Forest"], ["C", "Cropland"], ["Z", "Z"]]);
  });

  it("tells the strata whose uncertainty is not counted", () => {
    expect(thinStrata({ notEstimable: [{ key: "A", area: 1, plots: 1 }, { key: "B", area: 1, plots: 0 }] })).toEqual([{ key: "A", area: 1, plots: 1 }]);
  });

  it("reads the total area typed: spaces and a decimal comma taken, nothing else", () => {
    expect(parseArea("12 500")).toBe(12500);
    expect(parseArea("1250,5")).toBe(1250.5);
    expect(parseArea(" 300.25 ")).toBe(300.25);
    expect(parseArea("0")).toBeNull();
    expect(parseArea("-5")).toBeNull();
    expect(parseArea("1,250.5")).toBeNull();
    expect(parseArea("abc")).toBeNull();
    expect(parseArea("")).toBeNull();
  });
});
