import { describe, expect, it } from "vitest";
import { areasOf, designAreas, strataSettings, typedArea } from "./areasView";

describe("strata and areas", () => {
  it("read an area as people type it", () => {
    expect(typedArea("68 872,5")).toBe(68872.5);
    expect(typedArea("68,872.5")).toBe(68872.5);
    expect(typedArea("1000")).toBe(1000);
    expect(typedArea("")).toBeNull();
    expect(typedArea("abc")).toBeNaN();
    expect(typedArea("-5")).toBeNaN();
  });

  it("save the strata with an area, the typed ones over the saved ones", () => {
    const strata = [
      { values: ["A"], area: 1000, plots: 2, assessed: 2, haPerPlot: 500 },
      { values: ["B"], area: null, plots: 2, assessed: 1, haPerPlot: null },
      { values: ["C"], area: 5, plots: 1, assessed: 0, haPerPlot: null },
    ];
    const areas = areasOf(strata, { B: "300", C: "" });
    expect(areas).toEqual([1000, 300, null]);
    expect(strataSettings(["forest"], strata, areas)).toEqual({ mode: "strata", columns: ["forest"], strata: [{ values: ["A"], area: 1000 }, { values: ["B"], area: 300 }] });
  });

  it("take a design's areas: its strata, else the area's total, in hectares", () => {
    expect(designAreas({ strata: [{ value: "Reserve", areaKm2: 12.3456, plots: 10 }] }, { areaKm2: 50 })).toEqual({ mode: "strata", columns: ["stratum"], strata: [{ values: ["Reserve"], area: 1234.56 }] });
    expect(designAreas({ strata: null }, { areaKm2: 50 })).toEqual({ mode: "total", area: 5000 });
  });
});
