import { describe, it, expect } from "vitest";
import { chartRequest, resolveConfig } from "./config";
import { layerRequest } from "../components/LayerSources";

const MAX_YEAR = 2026;
const resolve = (doc: unknown) => resolveConfig(typeof doc === "string" ? doc : JSON.stringify(doc), MAX_YEAR);
const types = (entries: { type: string }[]) => entries.map((e) => e.type);
const STANDARD_LAYERS = ["sentinel2", "landsat", "sentinel1"];
const STANDARD_CHARTS = ["ccdc", "landsat-series", "sentinel2-series", "modis", "sentinel1-series", "precipitation"];

describe("resolveConfig", () => {
  it("gives the standard configuration without a document", () => {
    const r = resolveConfig(undefined, MAX_YEAR);
    expect(types(r.layers)).toEqual(STANDARD_LAYERS);
    expect(types(r.charts)).toEqual(STANDARD_CHARTS);
    expect(r.notices).toEqual([]);
  });

  it.each(["{not json", "[]", '"x"', "null"])("falls back to standard with one notice for %s", (text) => {
    const r = resolveConfig(text, MAX_YEAR);
    expect(types(r.layers)).toEqual(STANDARD_LAYERS);
    expect(types(r.charts)).toEqual(STANDARD_CHARTS);
    expect(r.notices).toHaveLength(1);
  });

  it("keeps standard layers when only charts are given", () => {
    const r = resolve({ v: 1, charts: [{ type: "modis" }] });
    expect(types(r.layers)).toEqual(STANDARD_LAYERS);
    expect(r.charts).toEqual([{ type: "modis", params: { index: "NDVI", collapsed: false, median: false, trend: true, change: false, unusual: false, season: false, rainfall: false } }]);
    expect(r.notices).toEqual([]);
  });

  it("keeps standard charts when only layers are given", () => {
    const r = resolve({ v: 1, layers: [{ type: "landsat" }] });
    expect(types(r.layers)).toEqual(["landsat"]);
    expect(types(r.charts)).toEqual(STANDARD_CHARTS);
  });

  it("skips a layer of unknown type with a notice naming it", () => {
    const r = resolve({ v: 1, layers: [{ type: "sentinel2" }, { type: "planet" }, { type: "landsat" }] });
    expect(types(r.layers)).toEqual(["sentinel2", "landsat"]);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toContain("planet");
  });

  it("skips a chart with an invalid parameter with a notice naming the type and parameter", () => {
    const r = resolve({ v: 1, charts: [{ type: "landsat-series", index: "XYZ" }, { type: "modis" }] });
    expect(types(r.charts)).toEqual(["modis"]);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toContain("landsat-series");
    expect(r.notices[0]).toContain("index");
  });

  it("skips a Sentinel-2 entry with only one date or a window that does not move forward, as the API would", () => {
    const r = resolve({
      v: 1,
      layers: [
        { type: "sentinel2", start: "2022-01-01" },
        { type: "sentinel2", end: "2022-07-01" },
        { type: "sentinel2", start: "2022-07-01", end: "2022-07-01" },
        { type: "sentinel2", start: "2022-01-01", end: "2022-07-01" },
      ],
    });
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].params).toMatchObject({ start: "2022-01-01", end: "2022-07-01" });
    expect(r.notices).toHaveLength(3);
    for (const n of r.notices) expect(n).toContain("sentinel2");
  });

  it("accepts a Sentinel-2 year and years from 2016, and skips them together with a composite window", () => {
    const ok = (entry: object) => resolve({ v: 1, layers: [entry] }).notices.length === 0;
    expect(ok({ type: "sentinel2", years: [2016, 2026], year: 2020 })).toBe(true);
    expect(ok({ type: "sentinel2", year: 2015 })).toBe(false);
    expect(ok({ type: "sentinel2", years: [2015, 2020] })).toBe(false);
    const r = resolve({
      v: 1,
      layers: [
        { type: "sentinel2", year: 2020, start: "2022-01-01", end: "2022-07-01" },
        { type: "sentinel2", years: [2018, 2020], start: "2022-01-01", end: "2022-07-01" },
        { type: "landsat" },
      ],
    });
    expect(types(r.layers)).toEqual(["landsat"]);
    expect(r.notices).toHaveLength(2);
    for (const n of r.notices) expect(n).toMatch(/sentinel2.*year/);
  });

  it("skips an entry with an unknown parameter", () => {
    const r = resolve({ v: 1, charts: [{ type: "modis", colour: "red" }, { type: "ccdc" }] });
    expect(types(r.charts)).toEqual(["ccdc"]);
    expect(r.notices[0]).toContain("colour");
  });

  it("falls back to standard layers when none is valid, keeping the notices", () => {
    const r = resolve({ v: 1, layers: [{ type: "planet" }, { type: "landsat", maxCloud: 0 }] });
    expect(types(r.layers)).toEqual(STANDARD_LAYERS);
    expect(r.notices).toHaveLength(2);
  });

  it("honours an explicit empty chart list", () => {
    const r = resolve({ v: 1, charts: [] });
    expect(r.charts).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  it("gives standard layers for an empty layer list (a map needs imagery)", () => {
    expect(types(resolve({ v: 1, layers: [] }).layers)).toEqual(STANDARD_LAYERS);
  });

  it("keeps repeated types in order", () => {
    const r = resolve({ v: 1, layers: [{ type: "sentinel2", label: "A" }, { type: "sentinel2", label: "B" }] });
    expect(r.layers.map((e) => e.params.label)).toEqual(["A", "B"]);
  });

  it("falls back to standard with a notice for another version", () => {
    const r = resolve({ v: 2, layers: [{ type: "landsat" }] });
    expect(types(r.layers)).toEqual(STANDARD_LAYERS);
    expect(types(r.charts)).toEqual(STANDARD_CHARTS);
    expect(r.notices).toHaveLength(1);
  });

  it("treats a missing version as version 1", () => {
    const r = resolve({ layers: [{ type: "landsat" }] });
    expect(types(r.layers)).toEqual(["landsat"]);
    expect(r.notices).toEqual([]);
  });

  it("fills in the catalogue defaults and leaves parameters without one absent", () => {
    const [s2] = resolve({ v: 1, layers: [{ type: "sentinel2" }] }).layers;
    expect(s2).toEqual({ type: "sentinel2", params: { bands: "false-colour", maxCloud: 70 } });
  });

  it("applies the API's rules to each parameter type", () => {
    const ok = (entry: object) => resolve({ v: 1, layers: [entry] }).notices.length === 0;
    expect(ok({ type: "landsat", maxCloud: 30, years: [2000, 2024], year: 2026, label: "x" })).toBe(true);
    expect(ok({ type: "landsat", maxCloud: "30" })).toBe(false);
    expect(ok({ type: "landsat", maxCloud: 30.5 })).toBe(false);
    expect(ok({ type: "landsat", maxCloud: 101 })).toBe(false);
    expect(ok({ type: "landsat", year: 2027 })).toBe(false);
    expect(ok({ type: "landsat", year: 1983 })).toBe(false);
    expect(ok({ type: "landsat", years: [2024, 2000] })).toBe(false);
    expect(ok({ type: "landsat", years: [2000] })).toBe(false);
    expect(ok({ type: "landsat", label: "x".repeat(61) })).toBe(false);
    expect(ok({ type: "landsat", label: "<b>x</b>" })).toBe(false);
    expect(ok({ type: "sentinel2", start: "2020-01-01", end: "2023-01-01" })).toBe(true);
    expect(ok({ type: "sentinel2", start: "2020-01-01", end: "2023-01-02" })).toBe(false);
    expect(ok({ type: "sentinel2", start: "2021-02-28", end: "2021-12-31" })).toBe(true);
    expect(ok({ type: "sentinel2", start: "2021-02-30", end: "2021-12-31" })).toBe(false);
    expect(ok({ type: "sentinel2", start: "2021-13-01", end: "2021-12-31" })).toBe(false);
    const chartOk = (entry: object) => resolve({ v: 1, charts: [entry] }).notices.length === 0;
    expect(chartOk({ type: "ccdc", collapsed: true })).toBe(true);
    expect(chartOk({ type: "ccdc", collapsed: "true" })).toBe(false);
  });

  it("checks a series formula as the API does, against the sensor's bands, and keeps it apart from a named index", () => {
    const chartOk = (entry: object) => resolve({ v: 1, charts: [entry] }).notices.length === 0;
    for (const type of ["landsat-series", "sentinel2-series"]) {
      expect(chartOk({ type, index: "MSAVI" })).toBe(true);
      expect(chartOk({ type, formula: "(nir - red) / (nir + red)", name: "My NDVI" })).toBe(true);
      expect(chartOk({ type, formula: "sqrt(abs(nir)) + min(red, 0.1) + max(nir, -1) + pow(nir, 2)" })).toBe(true);
      expect(chartOk({ type, formula: "nir / red", index: "NDVI" })).toBe(true);
      expect(chartOk({ type, formula: "nir / red", index: "NDMI" })).toBe(false);
      for (const bad of ["nir; red", "ndvi * 2", "(nir - red", "()", "nir + * red", "red 2", "1 + 2", "", "b('nir')", "x".repeat(201), 5]) {
        expect(chartOk({ type, formula: bad }), JSON.stringify(bad)).toBe(false);
      }
      expect(chartOk({ type, formula: "nir / red", name: "x".repeat(31) })).toBe(false);
    }
    expect(chartOk({ type: "sentinel2-series", formula: "(rededge3 - rededge1) / (rededge3 + rededge1)" })).toBe(true);
    const r = resolve({ v: 1, charts: [{ type: "landsat-series", formula: "(rededge1 - red) / (rededge1 + red)" }, { type: "modis" }] });
    expect(types(r.charts)).toEqual(["modis"]);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toContain("formula");
  });

  it("resolves Sentinel-1 entries with their defaults and builds their requests", () => {
    const r = resolve({ v: 1, layers: [{ type: "sentinel1" }, { type: "sentinel1", year: 2014 }], charts: [{ type: "sentinel1-series", band: "VV" }] });
    expect(r.layers).toEqual([{ type: "sentinel1", params: { bands: "false-colour" } }]);
    expect(r.notices).toEqual(['Layer "sentinel1" skipped: year is not valid.']);
    expect(r.charts[0].params).toEqual({ band: "VV", median: false, trend: true, change: false, unusual: false, season: false, collapsed: false });
    const p = { plot: { type: "Polygon" as const, coordinates: [] }, start: "2020-01-01", end: "2021-01-01" };
    expect(chartRequest(r.charts[0], p)).toEqual({ path: "series/sentinel1", body: { ...p, band: "VV" } });
    expect(layerRequest(r.layers[0], 2020, p)).toEqual({ path: "tiles/sentinel1", body: { ...p, year: 2020 } });
    expect(layerRequest({ type: "sentinel1", params: { bands: "vh" } }, 2020, p).body.bands).toBe("vh");
  });

  it("resolves a rainfall chart with every analysis off and requests it with the plot only", () => {
    const r = resolve({ v: 1, charts: [{ type: "precipitation" }, { type: "modis", rainfall: true }] });
    expect(r.charts[0].params).toEqual({ median: false, trend: false, change: false, unusual: false, season: false, collapsed: false });
    expect(r.charts[1].params.rainfall).toBe(true);
    const p = { plot: { type: "Polygon" as const, coordinates: [] }, start: "2020-01-01", end: "2021-01-01" };
    expect(chartRequest(r.charts[0], p)).toEqual({ path: "series/precipitation", body: p });
    // The MODIS request does not change with the rainfall overlay.
    expect(chartRequest(r.charts[1], p)).toEqual({ path: "series/modis", body: p });
  });
});
