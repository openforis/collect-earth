import { describe, expect, it } from "vitest";
import type { PlotPeriod } from "./api";
import { periodRows, repeatName } from "./repeatSurveyView";

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
