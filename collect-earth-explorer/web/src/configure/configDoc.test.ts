import { describe, expect, it } from "vitest";
import { resolveConfig } from "../lib/config";
import { CONFIGURE_DICTIONARIES } from "./texts";
import {
  add, docValid, entryErrors, EXPLORER_CONFIG_MAX, move, parseDoc, presetDoc, PRESETS, previewUrl, remove, serialiseDoc, summarize,
  type Doc, type EntryError,
} from "./configDoc";

const YEAR = 2026;
const blank = (types: string[]) => types.map((type) => ({ type, params: {} }));
const standard: Doc = {
  layers: blank(["sentinel2", "landsat", "sentinel1"]),
  charts: [...blank(["landsat-series", "sentinel2-series", "ccdc", "modis"]), { type: "sentinel1-series", params: { collapsed: true } }, { type: "precipitation", params: { collapsed: true } }],
};

// Every type, both Sentinel-2 modes and both index modes, with non-default values.
const everyType: Doc = {
  layers: [
    { type: "sentinel2", params: { label: "Dry season 2019", start: "2019-06-01", end: "2019-09-30", bands: "true-colour", maxCloud: 30 } },
    { type: "sentinel2", params: { years: [2018, 2024], year: 2020 } },
    { type: "landsat", params: { years: [2000, 2024], year: 2015, maxCloud: 20 } },
    { type: "sentinel1", params: { bands: "vh", year: 2020 } },
  ],
  charts: [
    { type: "ccdc", params: { band: "NDVI", collapsed: true } },
    { type: "sentinel2-series", params: { name: "NDRE", formula: "(nir - rededge1) / (nir + rededge1)" } },
    { type: "landsat-series", params: { index: "NBR", change: true, trend: false, maxCloud: "any" } },
    { type: "modis", params: { index: "EVI", rainfall: true, season: true } },
    { type: "sentinel1-series", params: { band: "VV", unusual: true } },
    { type: "precipitation", params: { median: true } },
  ],
};

describe("parseDoc", () => {
  it("gives the standard configuration for nothing stored or an unreadable text", () => {
    expect(parseDoc("")).toEqual({ doc: standard, unknown: false });
    expect(parseDoc("{not json")).toEqual({ doc: standard, unknown: true });
    expect(parseDoc('{"v":2,"layers":[{"type":"landsat"}]}')).toEqual({ doc: standard, unknown: true });
  });

  it("keeps a half left out as the standard one, and an empty chart list as none", () => {
    expect(parseDoc('{"v":1,"charts":[]}')).toEqual({ doc: { layers: standard.layers, charts: [] }, unknown: false });
    expect(parseDoc('{"layers":[{"type":"landsat","year":2015}]}').doc).toEqual({ layers: [{ type: "landsat", params: { year: 2015 } }], charts: standard.charts });
  });

  it("keeps only what was stored: defaults are not filled in, even invalid values are kept for the page to show", () => {
    expect(parseDoc('{"layers":[{"type":"sentinel2","maxCloud":500}]}').doc.layers).toEqual([{ type: "sentinel2", params: { maxCloud: 500 } }]);
  });

  it("drops what the catalogue lacks and says so", () => {
    const r = parseDoc('{"layers":[{"type":"landsat","glow":1},{"type":"planet"},"x"],"charts":[{"type":"ccdc"}]}');
    expect(r).toEqual({ doc: { layers: [{ type: "landsat", params: {} }], charts: [{ type: "ccdc", params: {} }] }, unknown: true });
    expect(parseDoc('{"charts":[{"type":"nope"}]}')).toEqual({ doc: standard, unknown: true });
  });
});

describe("serialiseDoc", () => {
  it("stores nothing for the standard configuration", () => {
    expect(serialiseDoc(standard)).toBe("");
    expect(serialiseDoc({ ...standard, layers: [{ type: "sentinel2", params: { maxCloud: 70, label: "" } }, ...standard.layers.slice(1)] })).toBe("");
  });

  it("keeps the standard charts folded when something else changes", () => {
    const doc = parseDoc("").doc;
    doc.layers = [{ type: "landsat", params: {} }];
    expect(serialiseDoc(doc)).toContain('{"type":"sentinel1-series","collapsed":true},{"type":"precipitation","collapsed":true}');
  });

  it("writes compact JSON without defaults and empty texts", () => {
    const doc: Doc = { layers: [{ type: "landsat", params: { maxCloud: 50, bands: "true-colour", label: "" } }], charts: [] };
    expect(serialiseDoc(doc)).toBe('{"v":1,"layers":[{"type":"landsat","bands":"true-colour"}],"charts":[]}');
  });

  it("reads back what it wrote, for every parameter type", () => {
    expect(parseDoc(serialiseDoc(everyType))).toEqual({ doc: everyType, unknown: false });
    expect(EXPLORER_CONFIG_MAX).toBe(2000);
  });
});

describe("entryErrors", () => {
  const errors = (kind: "layers" | "charts", type: string, params: Record<string, unknown>) => entryErrors(kind, { type, params }, YEAR);

  it("finds nothing wrong with defaults, blanks or good values", () => {
    expect(errors("layers", "sentinel2", {})).toEqual({});
    expect(errors("layers", "sentinel2", { label: "", maxCloud: undefined })).toEqual({});
    for (const kind of ["layers", "charts"] as const) for (const e of everyType[kind]) expect(entryErrors(kind, e, YEAR), e.type).toEqual({});
  });

  it("checks each parameter by its type", () => {
    expect(errors("layers", "landsat", { maxCloud: 0, bands: "pink" })).toEqual({ maxCloud: "number", bands: "invalid" });
    expect(errors("layers", "landsat", { maxCloud: 2.5 })).toEqual({ maxCloud: "number" });
    expect(errors("layers", "landsat", { year: 1983 })).toEqual({ year: "year" });
    expect(errors("layers", "landsat", { year: 2027 })).toEqual({ year: "year" });
    expect(errors("layers", "landsat", { years: [2000, 2027] })).toEqual({ years: "year" });
    expect(errors("layers", "landsat", { years: [2000, undefined] })).toEqual({ years: "year" });
    expect(errors("layers", "landsat", { years: [2010, 2000] })).toEqual({ years: "yearOrder" });
    expect(errors("layers", "sentinel2", { start: "2019-02-30", end: "2019-03-01" })).toEqual({ start: "date" });
    expect(errors("layers", "landsat", { label: "x".repeat(61) })).toEqual({ label: "textLength" });
    expect(errors("layers", "landsat", { label: "<b>" })).toEqual({ label: "textChars" });
    expect(errors("charts", "sentinel2-series", { formula: "nir".repeat(67) })).toEqual({ formula: "formulaLength" });
    expect(errors("charts", "ccdc", { collapsed: "yes" })).toEqual({ collapsed: "invalid" });
  });

  it("refuses a formula the Explorer would not understand, for the chart's own bands", () => {
    for (const formula of ["foo + 1", "2 * 3", "(nir - red", "nir +", "sqrt nir", "nir red", "nir\t/ red", "nir /\nred"])
      expect(errors("charts", "sentinel2-series", { formula }), formula).toEqual({ formula: "formula" });
    expect(errors("charts", "landsat-series", { formula: "rededge1 / nir" })).toEqual({ formula: "formula" });
    expect(errors("charts", "sentinel2-series", { formula: "sqrt(nir) - 2 * rededge1" })).toEqual({});
  });

  it("refuses control characters in a text, as the dashboard's server does", () => {
    for (const label of ["a\tb", "a\nb", "a\u0000b", "a\u007fb"]) expect(errors("layers", "landsat", { label }), label).toEqual({ label: "textChars" });
  });

  it("asks a fixed period for both dates, start first, at most 1,096 days", () => {
    expect(errors("layers", "sentinel2", { start: "", end: "" })).toEqual({ start: "dateRequired", end: "dateRequired" });
    expect(errors("layers", "sentinel2", { start: "2019-06-01" })).toEqual({ end: "dateRequired" });
    expect(errors("layers", "sentinel2", { start: "2019-06-01", end: "2019-06-01" })).toEqual({ end: "dateOrder" });
    expect(errors("layers", "sentinel2", { start: "2019-01-01", end: "2022-01-01" })).toEqual({});
    expect(errors("layers", "sentinel2", { start: "2019-01-01", end: "2022-01-02" })).toEqual({ end: "window" });
  });

  it("asks a custom formula for its text, and refuses it with another index or a fixed period with years", () => {
    expect(errors("charts", "sentinel2-series", { formula: " " })).toEqual({ formula: "formulaRequired" });
    expect(errors("charts", "sentinel2-series", { index: "NBR", formula: "nir / red" })).toEqual({ formula: "indexOrFormula" });
    expect(errors("charts", "sentinel2-series", { index: "NDVI", formula: "nir / red" })).toEqual({});
    expect(errors("layers", "sentinel2", { start: "2019-06-01", end: "2019-09-30", year: 2019, years: [2018, 2020] }))
      .toEqual({ year: "yearOrWindow", years: "yearOrWindow" });
  });

  it("has a message for every error code in English (and so in all five: i18n.test.ts)", () => {
    const codes: Record<EntryError, true> = {
      invalid: true, number: true, year: true, yearOrder: true, date: true, textLength: true, textChars: true, formulaLength: true, formula: true,
      dateRequired: true, formulaRequired: true, dateOrder: true, window: true, yearOrWindow: true, indexOrFormula: true,
    };
    for (const code of Object.keys(codes)) expect(Object.hasOwn(CONFIGURE_DICTIONARIES.en, `error.${code}`), code).toBe(true);
  });
});

describe("what the page calls valid, the Explorer takes without a notice", () => {
  it("for every type and both modes of a Sentinel-2 layer and an index chart", () => {
    expect(docValid(everyType, YEAR)).toBe(true);
    const r = resolveConfig(serialiseDoc(everyType), YEAR);
    expect(r.notices).toEqual([]);
    expect(r.layers.map((e) => e.type)).toEqual(everyType.layers.map((e) => e.type));
    expect(r.charts.map((e) => e.type)).toEqual(everyType.charts.map((e) => e.type));
  });

  it.each(PRESETS)("for the %s starting point", (name) => {
    const doc = presetDoc(name);
    expect(docValid(doc, YEAR)).toBe(true);
    expect(resolveConfig(serialiseDoc(doc) || undefined, YEAR).notices).toEqual([]);
    if (name !== "standard") expect(serialiseDoc(doc)).not.toBe("");
  });

  it("not for a document too long to store", () => {
    const long: Doc = { layers: Array.from({ length: 40 }, () => ({ type: "landsat", params: { label: "x".repeat(50) } })), charts: [] };
    expect(serialiseDoc(long).length).toBeGreaterThan(EXPLORER_CONFIG_MAX);
    expect(docValid(long, YEAR)).toBe(false);
  });
});

describe("summarize", () => {
  it("says only what differs from the standard", () => {
    expect(summarize("charts", { type: "landsat-series", params: {} })).toEqual([]);
    expect(summarize("charts", { type: "landsat-series", params: { index: "NBR", trend: false, change: true, maxCloud: "40", collapsed: true } }))
      .toEqual(["NBR", "Trend off", "Change year", "folded"]);
    expect(summarize("layers", everyType.layers[0])).toEqual(["“Dry season 2019”", "2019-06-01 to 2019-09-30", "true colour", "cloud limit 30 %"]);
    expect(summarize("charts", everyType.charts[1])).toEqual(["NDRE"]);
  });
});

describe("previewUrl", () => {
  it("opens the Explorer on the plot, with the configuration unless it is the standard one", () => {
    const point = '{"type":"Point","coordinates":[20.25,-3.5]}';
    const url = new URL(previewUrl("", point), "https://x.org");
    expect(url.pathname).toBe("/");
    expect([...url.searchParams]).toEqual([["geoJson", point], ["plot_id", "Preview"], ["preview", "1"]]);
    const full = new URL(previewUrl(serialiseDoc(everyType), point, "es"), "https://x.org");
    expect(full.searchParams.get("config")).toBe(serialiseDoc(everyType));
    expect(full.searchParams.get("lang")).toBe("es");
  });
});

describe("list helpers", () => {
  const list = blank(["a", "b", "c"]);
  const types = (l: { type: string }[]) => l.map((e) => e.type).join("");

  it("move, remove and add return new lists", () => {
    expect(types(move(list, 0, 1))).toBe("bac");
    expect(types(move(list, 2, -1))).toBe("acb");
    expect(types(move(list, 0, -1))).toBe("abc");
    expect(types(move(list, 2, 1))).toBe("abc");
    expect(types(remove(list, 1))).toBe("ac");
    expect(add(list, "a")).toEqual([...list, { type: "a", params: {} }]);
    expect(types(list)).toBe("abc");
  });
});
