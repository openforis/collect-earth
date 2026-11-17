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
  it("reads the fragment Collect Earth builds", () => {
    const p = parsePlotUrl("", new Date("2026-11-01"), `#geoJson=${encodeURIComponent(geoJson)};plotId=101;survey=s;startTime=2020-01-01;endTime=2024-01-01;`);
    expect(p.plot.type).toBe("Polygon");
    expect(p.plotId).toBe("101");
    expect(p.start).toBe("2020-01-01");
    expect(p.end).toBe("2024-01-01");
  });
  it("lets a fragment value win over the same key in the query", () => {
    const p = parsePlotUrl(`?geoJson=${encodeURIComponent(geoJson)}&startTime=2000-01-01`, new Date("2026-11-01"), "#startTime=2010-01-01");
    expect(p.start).toBe("2010-01-01");
  });
  it("accepts plot_id and plotId", () => {
    const q = `?geoJson=${encodeURIComponent(geoJson)}`;
    expect(parsePlotUrl(`${q}&plot_id=A`).plotId).toBe("A");
    expect(parsePlotUrl(q, new Date(), "#plotId=B").plotId).toBe("B");
  });
  it("returns config decoded as configText, undefined when absent", () => {
    const config = '{"v":1,"charts":[{"type":"modis"}]}';
    const q = `?geoJson=${encodeURIComponent(geoJson)}`;
    expect(parsePlotUrl(q).configText).toBeUndefined();
    expect(parsePlotUrl(`${q}&config=${encodeURIComponent(config)}`).configText).toBe(config);
    expect(parsePlotUrl("", new Date(), `#geoJson=${encodeURIComponent(geoJson)};config=${encodeURIComponent(config)};`).configText).toBe(config);
  });
  it("ignores a trailing ;, empty segments and badly encoded ones", () => {
    const p = parsePlotUrl("", new Date(), `#;;geoJson=${encodeURIComponent(geoJson)};;plotId=%E0%A4%A;plotId=7;;`);
    expect(p.plotId).toBe("7");
  });
  it("reads the next plot, in the query and the fragment, normalised like the plot; undefined when absent or unreadable", () => {
    const point = JSON.stringify({ type: "Point", coordinates: [30.17, -2.07] });
    const q = `?geoJson=${encodeURIComponent(geoJson)}`;
    expect(parsePlotUrl(q).next).toBeUndefined();
    expect(parsePlotUrl(`${q}&next=${encodeURIComponent(point)}`).next).toEqual(toPolygon(JSON.parse(point)));
    const h = parsePlotUrl("", new Date(), `#geoJson=${encodeURIComponent(geoJson)};next=${encodeURIComponent(geoJson)};plotId=1;`);
    expect(h.next).toEqual(h.plot);
    for (const bad of ["{oops", '{"type":"MultiPolygon","coordinates":[]}', "null", "%E0%A4%A"]) {
      const p = parsePlotUrl("", new Date(), `#geoJson=${encodeURIComponent(geoJson)};next=${bad === "%E0%A4%A" ? bad : encodeURIComponent(bad)};plotId=1;`);
      expect(p.next).toBeUndefined();
      expect(p.plotId).toBe("1");
    }
  });
  it("closes an open ring", () => {
    const poly = toPolygon({ type: "MultiLineString", coordinates: [ring.slice(0, 4)] });
    expect(poly.coordinates[0].length).toBe(5);
  });
});

describe("toPolygon", () => {
  it("buffers a Point into the backend's 0.0005-degree square, closed and counter-clockwise", () => {
    const poly = toPolygon({ type: "Point", coordinates: [30.17, -2.07] });
    expect(poly.type).toBe("Polygon");
    const d = 0.0005;
    expect(poly.coordinates).toEqual([[
      [30.17 - d, -2.07 - d],
      [30.17 + d, -2.07 - d],
      [30.17 + d, -2.07 + d],
      [30.17 - d, -2.07 + d],
      [30.17 - d, -2.07 - d],
    ]]);
  });
  it("parses a Point geoJson from the URL without an error", () => {
    const point = JSON.stringify({ type: "Point", coordinates: [30.17, -2.07] });
    const p = parsePlotUrl(`?geoJson=${encodeURIComponent(point)}`, new Date("2026-11-01"));
    expect(p.plot.coordinates[0]).toHaveLength(5);
  });
  it("still rejects unsupported geometries", () => {
    expect(() => toPolygon({ type: "MultiPolygon", coordinates: [] })).toThrow(/unsupported geometry MultiPolygon/);
  });
});
