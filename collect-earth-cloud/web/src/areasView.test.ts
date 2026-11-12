import { describe, expect, it } from "vitest";
import { areasOf, designAreas, shownArea, strataSettings, typedArea } from "./areasView";

describe("strata and areas", () => {
  it("read an area as people type it", () => {
    for (const language of ["en", "es", "fr"]) {
      expect(typedArea("68 872,5", language)).toBe(68872.5);
      expect(typedArea("68,872.5", language)).toBe(68872.5);
      expect(typedArea("68.872,5", language)).toBe(68872.5);
      expect(typedArea("1,000,000", language)).toBe(1000000);
      expect(typedArea("1.000.000", language)).toBe(1000000);
      expect(typedArea("68,5", language)).toBe(68.5);
      expect(typedArea("68.25", language)).toBe(68.25);
      expect(typedArea("1000", language)).toBe(1000);
      expect(typedArea("", language)).toBeNull();
      expect(typedArea("abc", language)).toBeNaN();
      expect(typedArea("-5", language)).toBeNaN();
      expect(typedArea("1,000.5,3", language)).toBeNaN();
    }
    // one mark before three digits: as the language writes numbers
    expect(typedArea("1,000", "en")).toBe(1000);
    expect(typedArea("1.000", "en")).toBe(1);
    expect(typedArea("1,000", "es")).toBe(1);
    expect(typedArea("1.000", "es")).toBe(1000);
  });

  it("show an area as it reads back", () => {
    for (const language of ["en", "es", "fr", "pt", "tr"]) {
      for (const area of [1000, 68872.5, 1234.567, 0.5]) expect(typedArea(shownArea(area, language), language)).toBe(area);
    }
  });

  it("save the strata with an area, the typed ones over the saved ones", () => {
    const strata = [
      { values: ["A"], area: 1000, plots: 2, assessed: 2, haPerPlot: 500 },
      { values: ["B"], area: null, plots: 2, assessed: 1, haPerPlot: null },
      { values: ["C"], area: 5, plots: 1, assessed: 0, haPerPlot: null },
    ];
    const areas = areasOf(strata, { B: "300", C: "" }, "en");
    expect(areas).toEqual([1000, 300, null]);
    expect(strataSettings(["forest"], strata, areas)).toEqual({ mode: "strata", columns: ["forest"], strata: [{ values: ["A"], area: 1000 }, { values: ["B"], area: 300 }] });
  });

  it("take a design's areas: its strata, else the area's total, in hectares", () => {
    expect(designAreas({ strata: [{ value: "Reserve", areaKm2: 12.3456, plots: 10 }] }, { areaKm2: 50 })).toEqual({ mode: "strata", columns: ["stratum"], strata: [{ values: ["Reserve"], area: 1234.56 }] });
    expect(designAreas({ strata: null }, { areaKm2: 50 })).toEqual({ mode: "total", area: 5000 });
  });
});
