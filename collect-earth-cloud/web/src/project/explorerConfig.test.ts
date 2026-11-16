import { describe, expect, it } from "vitest";
import { CATALOGUES } from "../i18n";
import {
  add, docSize, entryErrors, EXPLORER_CONFIG_MAX, move, parseDoc, previewUrl, remove, serialiseDoc, type Catalogue, type Doc, type EntryError,
} from "./explorerConfig";

// The Explorer's catalogue (collect-earth-explorer/functions/catalogue.json), trimmed: every parameter type is here.
const indices = ["NDVI", "EVI", "NBR"];
const catalogue: Catalogue = {
  v: 1,
  layers: {
    sentinel2: {
      title: "Sentinel-2 composite",
      params: {
        label: { type: "text", max: 60 },
        years: { type: "yearRange", min: 2016 },
        year: { type: "year", min: 2016 },
        start: { type: "date" },
        end: { type: "date" },
        bands: { type: "choice", values: ["false-colour", "true-colour"], default: "false-colour" },
        maxCloud: { type: "int", min: 1, max: 100, default: 70 },
      },
    },
    landsat: {
      title: "Landsat yearly composite",
      params: {
        label: { type: "text", max: 60 },
        years: { type: "yearRange", min: 1984 },
        year: { type: "year", min: 1984 },
        bands: { type: "choice", values: ["false-colour", "true-colour"], default: "false-colour" },
        maxCloud: { type: "int", min: 1, max: 100, default: 50 },
      },
    },
  },
  charts: {
    ccdc: {
      title: "CCDC temporal segmentation",
      params: {
        band: { type: "choice", values: ["NDFI", "NDVI"], default: "NDFI" },
        collapsed: { type: "bool", default: false },
      },
    },
    "sentinel2-series": {
      title: "Sentinel-2 index series",
      params: {
        index: { type: "choice", values: indices, default: "NDVI" },
        formula: { type: "formula", max: 200 },
        name: { type: "text", max: 30 },
        collapsed: { type: "bool", default: false },
      },
    },
    "landsat-series": {
      title: "Landsat index series",
      params: { index: { type: "choice", values: indices, default: "NDVI" }, formula: { type: "formula", max: 200 } },
    },
  },
  indices: { NDVI: "(nir - red) / (nir + red)", EVI: "2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1)", NBR: "(nir - swir2) / (nir + swir2)" },
  bands: { "landsat-series": ["blue", "green", "red", "nir", "swir1", "swir2"], "sentinel2-series": ["blue", "green", "red", "nir", "swir1", "swir2", "rededge1", "rededge2", "rededge3"] },
  standard: { v: 1, layers: [{ type: "sentinel2" }, { type: "landsat" }], charts: [{ type: "ccdc" }, { type: "sentinel2-series" }] },
};

const standard: Doc = {
  layers: [{ type: "sentinel2", params: {} }, { type: "landsat", params: {} }],
  charts: [{ type: "ccdc", params: {} }, { type: "sentinel2-series", params: {} }],
};

const everyType: Doc = {
  layers: [
    { type: "sentinel2", params: { label: "Dry season 2019", start: "2019-06-01", end: "2019-09-30", bands: "true-colour", maxCloud: 30 } },
    { type: "landsat", params: { years: [2000, 2024], year: 2015 } },
  ],
  charts: [
    { type: "ccdc", params: { band: "NDVI", collapsed: true } },
    { type: "sentinel2-series", params: { name: "NDRE", formula: "(nir - rededge1) / (nir + rededge1)" } },
  ],
};

describe("parseDoc", () => {
  it("gives the standard configuration for nothing stored or an unreadable text", () => {
    expect(parseDoc("", catalogue)).toEqual({ doc: standard, unknown: false });
    expect(parseDoc("{not json", catalogue)).toEqual({ doc: standard, unknown: true });
    expect(parseDoc('{"v":2,"layers":[{"type":"landsat"}]}', catalogue)).toEqual({ doc: standard, unknown: true });
  });

  it("keeps a half left out as the standard one, and an empty chart list as none", () => {
    expect(parseDoc('{"v":1,"charts":[]}', catalogue)).toEqual({ doc: { layers: standard.layers, charts: [] }, unknown: false });
    expect(parseDoc('{"layers":[{"type":"landsat","year":2015}]}', catalogue).doc).toEqual({
      layers: [{ type: "landsat", params: { year: 2015 } }], charts: standard.charts,
    });
  });

  it("keeps only what was stored: defaults are not filled in, even invalid values are kept for the form to show", () => {
    expect(parseDoc('{"layers":[{"type":"sentinel2","maxCloud":500}]}', catalogue).doc.layers).toEqual([{ type: "sentinel2", params: { maxCloud: 500 } }]);
  });

  it("drops what the catalogue lacks and says so", () => {
    const r = parseDoc('{"layers":[{"type":"landsat","glow":1},{"type":"planet"},"x"],"charts":[{"type":"ccdc"}]}', catalogue);
    expect(r).toEqual({ doc: { layers: [{ type: "landsat", params: {} }], charts: [{ type: "ccdc", params: {} }] }, unknown: true });
    // Nothing known left: the Explorer shows the standard list
    expect(parseDoc('{"charts":[{"type":"nope"}]}', catalogue)).toEqual({ doc: standard, unknown: true });
  });
});

describe("serialiseDoc", () => {
  it("stores nothing for the standard configuration", () => {
    expect(serialiseDoc(standard, catalogue)).toBe("");
    expect(serialiseDoc({ ...standard, layers: [{ type: "sentinel2", params: { maxCloud: 70, label: "" } }, { type: "landsat", params: {} }] }, catalogue)).toBe("");
  });

  it("writes compact JSON without defaults and empty texts", () => {
    const doc: Doc = { layers: [{ type: "landsat", params: { maxCloud: 50, bands: "true-colour", label: "" } }], charts: [] };
    expect(serialiseDoc(doc, catalogue)).toBe('{"v":1,"layers":[{"type":"landsat","bands":"true-colour"}],"charts":[]}');
  });

  it("reads back what it wrote, for every parameter type", () => {
    const text = serialiseDoc(everyType, catalogue);
    expect(parseDoc(text, catalogue)).toEqual({ doc: everyType, unknown: false });
    expect(docSize(everyType, catalogue)).toBe(text.length);
    expect(docSize(standard, catalogue)).toBe(0);
    expect(EXPLORER_CONFIG_MAX).toBe(2000);
  });
});

describe("entryErrors", () => {
  const errors = (kind: "layers" | "charts", type: string, params: Record<string, unknown>) => entryErrors(kind, { type, params }, catalogue, 2026);

  it("finds nothing wrong with defaults, blanks or good values", () => {
    expect(errors("layers", "sentinel2", {})).toEqual({});
    expect(errors("layers", "sentinel2", { label: "", maxCloud: undefined })).toEqual({});
    for (const e of everyType.layers) expect(entryErrors("layers", e, catalogue, 2026)).toEqual({});
    for (const e of everyType.charts) expect(entryErrors("charts", e, catalogue, 2026)).toEqual({});
  });

  it("checks each parameter by its type", () => {
    expect(errors("layers", "landsat", { maxCloud: 0, bands: "pink" })).toEqual({ maxCloud: "number", bands: "invalid" });
    expect(errors("layers", "landsat", { maxCloud: 2.5 })).toEqual({ maxCloud: "number" });
    expect(errors("layers", "landsat", { year: 1983 })).toEqual({ year: "year" });
    expect(errors("layers", "landsat", { year: 2027 })).toEqual({ year: "year" });
    expect(errors("layers", "landsat", { years: [2000, 2027] })).toEqual({ years: "year" });
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
    expect(errors("charts", "sentinel2-series", { formula: "(nir - red) / (nir + red)" })).toEqual({});
    expect(errors("charts", "sentinel2-series", { formula: "sqrt(nir) - 2 * rededge1" })).toEqual({});
  });

  it("refuses control characters in a text, as the server does", () => {
    for (const label of ["a\tb", "a\nb", "a\u0000b", "a\u007fb"]) expect(errors("layers", "landsat", { label }), label).toEqual({ label: "textChars" });
  });

  it("treats a text or formula of spaces as blank: no error, not stored", () => {
    expect(errors("layers", "landsat", { label: "   " })).toEqual({});
    expect(errors("charts", "sentinel2-series", { name: " ", formula: "  ", index: "NBR" })).toEqual({});
    expect(serialiseDoc({ ...standard, layers: [{ type: "sentinel2", params: { label: "  " } }, { type: "landsat", params: {} }] }, catalogue)).toBe("");
  });

  it("asks for a Sentinel-2 window with both dates, start first, at most 1,096 days", () => {
    expect(errors("layers", "sentinel2", { start: "2019-06-01" })).toEqual({ end: "bothDates" });
    expect(errors("layers", "sentinel2", { end: "2019-06-01" })).toEqual({ start: "bothDates" });
    expect(errors("layers", "sentinel2", { start: "2019-06-01", end: "2019-06-01" })).toEqual({ end: "dateOrder" });
    expect(errors("layers", "sentinel2", { start: "2019-01-01", end: "2022-01-01" })).toEqual({});
    expect(errors("layers", "sentinel2", { start: "2019-01-01", end: "2022-01-02" })).toEqual({ end: "window" });
  });

  it("refuses a year slider with a fixed window, and a formula with another index", () => {
    expect(errors("layers", "sentinel2", { start: "2019-06-01", end: "2019-09-30", year: 2019, years: [2018, 2020] }))
      .toEqual({ year: "yearOrWindow", years: "yearOrWindow" });
    expect(errors("charts", "sentinel2-series", { index: "NBR", formula: "nir / red" })).toEqual({ formula: "indexOrFormula" });
    expect(errors("charts", "sentinel2-series", { index: "NDVI", formula: "nir / red" })).toEqual({});
  });
});

describe("previewUrl", () => {
  const plot = { lat: -3.5, lon: 20.25 };
  const point = encodeURIComponent('{"type":"Point","coordinates":[20.25,-3.5]}');

  it("opens the Explorer on a sample plot, with the configuration unless it is the standard one", () => {
    expect(previewUrl("https://x.org", standard, catalogue, plot)).toBe(`https://x.org/?geoJson=${point}&plot_id=Preview`);
    const url = previewUrl("https://x.org", everyType, catalogue, plot);
    expect(new URL(url).searchParams.get("config")).toBe(serialiseDoc(everyType, catalogue));
  });
});

describe("list helpers", () => {
  const list = [{ type: "a", params: {} }, { type: "b", params: {} }, { type: "c", params: {} }];
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

describe("messages", () => {
  it("has an English message for every error code (all languages have the English keys: i18n.test.ts)", () => {
    const codes: Record<EntryError, true> = {
      invalid: true, number: true, year: true, yearOrder: true, date: true, textLength: true, textChars: true, formulaLength: true, formula: true,
      bothDates: true, dateOrder: true, window: true, yearOrWindow: true, indexOrFormula: true,
    };
    for (const code of Object.keys(codes)) expect(Object.hasOwn(CATALOGUES.en, `file.explorer.error.${code}`), code).toBe(true);
  });
});
