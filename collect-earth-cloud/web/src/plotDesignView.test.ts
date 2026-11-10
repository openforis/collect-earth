import { describe, expect, it } from "vitest";
import { bytesToBase64, designOf, plotFileName, type DesignForm } from "./plotDesignView";

const form: DesignForm = { method: "random", count: "100", spacing: "", randomOffset: false, field: "", allocation: "equal" };

describe("plot design form", () => {
  it("gives the design once it is complete and within the limit", () => {
    expect(designOf(form, 50000)).toEqual({ method: "random", count: 100 });
    expect(designOf({ ...form, count: "50001" }, 50000)).toBeNull();
    expect(designOf({ ...form, count: "2.5" }, 50000)).toBeNull();
    expect(designOf({ ...form, method: "grid" }, 50000)).toBeNull();
    expect(designOf({ ...form, method: "grid", spacing: "500", randomOffset: true }, 50000)).toEqual({ method: "grid", spacingMeters: 500, randomOffset: true });
    expect(designOf({ ...form, method: "stratified" }, 50000)).toBeNull();
    expect(designOf({ ...form, method: "stratified", field: "zone", allocation: "proportional" }, 50000)).toEqual({
      method: "stratified",
      field: "zone",
      allocation: "proportional",
      count: 100,
    });
  });

  it("sends the file as base64 and names the plot file after it", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(atob(bytesToBase64(bytes)).length).toBe(100_000);
    expect(bytesToBase64(new Uint8Array([80, 75, 3, 4]))).toBe("UEsDBA==");
    expect(plotFileName("zones.geojson")).toBe("zones-plots.csv");
    expect(plotFileName("aoi.shp.zip")).toBe("aoi.shp-plots.csv");
  });
});
