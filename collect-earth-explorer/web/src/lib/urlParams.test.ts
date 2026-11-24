import { describe, it, expect } from "vitest";
import { parsePlotUrl, shapeProblem, toPolygon } from "./urlParams";

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
  it("clamps a future endTime to today, as the API does", () => {
    const p = parsePlotUrl(`?geoJson=${encodeURIComponent(geoJson)}&endTime=2030-12-31`, new Date("2026-11-01"));
    expect(p.end).toBe("2026-11-01");
  });
  it("says the plot has no outline when Collect Earth sends empty coordinates", () => {
    const empty = JSON.stringify({ type: "MultiLineString", coordinates: [[]] });
    expect(() => parsePlotUrl(`?geoJson=${encodeURIComponent(empty)}`)).toThrow("the plot has no outline");
  });
  it("says a Polygon has no outline unless its first ring has three positions of finite numbers", () => {
    for (const coordinates of [[], [[]], [[[0, 0], [1, 1]]], [[[0, 0], [1, 1], [1, "x"]]], [[[0, 0], [1, 1], [1]]], [[[0, 0], [1, 1], [1, null]]], "x", [[[0, 0], [1, 1], [Infinity, 0]]]])
      expect(() => toPolygon({ type: "Polygon", coordinates }), JSON.stringify(coordinates)).toThrow("the plot has no outline");
    expect(() => toPolygon({ type: "Polygon" } as never)).toThrow("the plot has no outline");
    const ring = [[0, 0], [1, 0], [1, 1, 5], [0, 0]];
    expect(toPolygon({ type: "Polygon", coordinates: [ring] })).toEqual({ type: "Polygon", coordinates: [ring] });
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

// The shapes functions/lib/plotRequest.test.js refuses (and accepts), so the two checks agree.
describe("shapeProblem", () => {
  const poly = (ring: number[][]) => toPolygon({ type: "Polygon", coordinates: [ring] });
  it("refuses what the server refuses", () => {
    expect(shapeProblem(poly([[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]]))).toBe("tooLarge"); // ~490 ha
    expect(shapeProblem(poly([[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]))).toBe("tooWide");
    expect(shapeProblem(poly([[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01], [0, 0]]))).toBe("crosses");
    expect(shapeProblem(poly([[0, 0], [0.01, 0], [0, 0]]))).toBe("noArea");
    const many = Array.from({ length: 501 }, (_, i) => [0.001 * Math.cos(i / 80), 0.001 * Math.sin(i / 80)]);
    expect(shapeProblem(poly([...many, many[0]]))).toBe("tooMany");
    expect(shapeProblem(poly([...many.slice(0, 500), many[0]]))).toBeUndefined();
  });
  it("accepts a plot and the square of a point; the area is measured as the server's @turf/area does", () => {
    expect(shapeProblem(poly(ring))).toBeUndefined();
    expect(shapeProblem(toPolygon({ type: "Point", coordinates: [-88.76, 17.25] }))).toBeUndefined();
    // 0.009° square at the equator is ~100.2 ha (just over), 0.0089° ~98 ha.
    expect(shapeProblem(poly([[0, 0], [0.009, 0], [0.009, 0.009], [0, 0.009], [0, 0]]))).toBe("tooLarge");
    expect(shapeProblem(poly([[0, 0], [0.0089, 0], [0.0089, 0.0089], [0, 0.0089], [0, 0]]))).toBeUndefined();
  });
});
