import { describe, it, expect } from "vitest";
import { parsePlotUrl, toPolygon } from "./urlParams";

const ring = [[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]];
const geoJson = JSON.stringify({ type: "MultiLineString", coordinates: [ring] });

describe("parsePlotUrl", () => {
  it("reads Collect Earth parameters", () => {
    const p = parsePlotUrl(`?geoJson=${encodeURIComponent(geoJson)}&startTime=2000-01-01&endTime=2026-11-01&plot_id=P42`, new Date("2026-11-01"));
    expect(p.plot.type).toBe("Polygon");
    expect(p.start).toBe("2000-01-01");
    expect(p.end).toBe("2026-11-01");
    expect(p.plotId).toBe("P42");
  });
  it("defaults dates and plot id", () => {
    const p = parsePlotUrl(`?geoJson=${encodeURIComponent(geoJson)}`, new Date("2026-11-01"));
    expect(p.start).toBe("1984-01-01");
    expect(p.end).toBe("2026-11-01");
    expect(p.plotId).toBe("");
  });
  it("throws when geoJson is missing", () => {
    expect(() => parsePlotUrl("?", new Date())).toThrow(/geoJson/);
  });
  it("closes an open ring", () => {
    const poly = toPolygon({ type: "MultiLineString", coordinates: [ring.slice(0, 4)] });
    expect(poly.coordinates[0].length).toBe(5);
  });
});
