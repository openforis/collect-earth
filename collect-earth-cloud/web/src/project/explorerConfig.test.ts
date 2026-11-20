import { describe, expect, it } from "vitest";
import { configMessage, configureUrl, summarise, type Catalogue } from "./explorerConfig";

// The Explorer's catalogue (collect-earth-explorer/functions/catalogue.json), trimmed to what the dashboard reads.
const catalogue: Catalogue = {
  layers: { sentinel2: { title: "Sentinel-2 composite" }, landsat: { title: "Landsat yearly composite" } },
  charts: { ccdc: { title: "CCDC" }, modis: { title: "MODIS" } },
  standard: { layers: [{ type: "sentinel2" }, { type: "landsat" }], charts: [{ type: "ccdc" }, { type: "modis" }] },
};

describe("summarise", () => {
  it("is null for the standard window, and for a text the Explorer could not read", () => {
    expect(summarise("", catalogue)).toBeNull();
    expect(summarise("{not json", catalogue)).toBeNull();
    expect(summarise("[1]", catalogue)).toBeNull();
  });

  it("counts and names each half, a half left out being the standard one", () => {
    expect(summarise('{"v":1,"layers":[{"type":"landsat"}]}', catalogue)).toEqual({
      layers: 1, charts: 2, names: ["Landsat yearly composite", "CCDC", "MODIS"],
    });
    expect(summarise('{"v":1,"charts":[]}', catalogue)).toEqual({ layers: 2, charts: 0, names: ["Sentinel-2 composite", "Landsat yearly composite"] });
  });

  it("skips what the Explorer does not know, as it does; nothing known left is the standard list", () => {
    expect(summarise('{"layers":[{"type":"landsat"},{"type":"planet"},"x"],"charts":[{"type":"nope"}]}', catalogue)).toEqual({
      layers: 1, charts: 2, names: ["Landsat yearly composite", "CCDC", "MODIS"],
    });
    expect(summarise('{"layers":[]}', catalogue)?.layers).toBe(2);
  });

  it("without the catalogue, counts what is given and names nothing", () => {
    expect(summarise('{"v":1,"layers":[{"type":"landsat"},{"type":"planet"}],"charts":[]}', null)).toEqual({ layers: 2, charts: 0, names: [] });
    expect(summarise('{"v":1,"layers":[{"type":"landsat"}]}', null)).toEqual({ layers: 1, charts: "standard", names: [] });
  });
});

describe("configureUrl", () => {
  it("passes the stored document, the plot and the language", () => {
    const url = new URL(configureUrl("https://x.org", '{"v":1,"charts":[]}', "fr", { lat: -3.5, lon: 20.25 }));
    expect(url.origin + url.pathname).toBe("https://x.org/configure");
    expect(url.searchParams.get("config")).toBe('{"v":1,"charts":[]}');
    expect(JSON.parse(url.searchParams.get("geoJson")!)).toEqual({ type: "Point", coordinates: [20.25, -3.5] });
    expect(url.searchParams.get("lang")).toBe("fr");
  });

  it("leaves out an empty document and a missing plot", () => {
    expect(configureUrl("https://x.org", "", "en", null)).toBe("https://x.org/configure?lang=en");
  });
});

describe("configMessage", () => {
  const frame = {};
  const data = { source: "collect-earth-explorer", type: "config", config: '{"v":1}', valid: true };
  const origin = "https://explorer.collectearth.org";

  it("takes the setup page's report from its own frame", () => {
    expect(configMessage({ origin, source: frame, data }, origin, frame)).toEqual({ config: '{"v":1}', valid: true });
    expect(configMessage({ origin, source: frame, data: { ...data, config: "", valid: false } }, origin, frame)).toEqual({ config: "", valid: false });
  });

  it("ignores another origin or another window", () => {
    expect(configMessage({ origin: "https://evil.example", source: frame, data }, origin, frame)).toBeNull();
    expect(configMessage({ origin: "https://explorer.collectearth.org.evil.example", source: frame, data }, origin, frame)).toBeNull();
    expect(configMessage({ origin, source: {}, data }, origin, frame)).toBeNull();
    expect(configMessage({ origin, source: null, data }, origin, null)).toBeNull();
  });

  it("ignores a message of another shape", () => {
    for (const bad of [null, "config", { ...data, source: "other" }, { ...data, type: "ready" }, { ...data, config: 1 }, { ...data, valid: "yes" }, { source: data.source, type: "config" }])
      expect(configMessage({ origin, source: frame, data: bad }, origin, frame), JSON.stringify(bad)).toBeNull();
  });
});
