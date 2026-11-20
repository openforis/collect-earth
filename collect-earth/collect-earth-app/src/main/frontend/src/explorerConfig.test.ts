import { describe, expect, it } from "vitest";
import { configureUrl, explorerMessage, explorerOrigin, explorerSummary } from "./explorerConfig";

const TEXTS: Record<string, string> = {
  "SettingsPage.explorerConfig.standard": "Standard window",
  "SettingsPage.explorerConfig.custom": "Custom window. Layers: {0}, charts: {1}",
  "SettingsPage.explorerConfig.standardPart": "standard",
  "SettingsPage.explorerConfig.unreadable": "Unreadable",
};
const s = (key: string) => TEXTS[key] ?? "!" + key + "!";

describe("explorerSummary", () => {
  it("says the standard window when empty", () => {
    expect(explorerSummary("", s)).toBe("Standard window");
    expect(explorerSummary("  ", s)).toBe("Standard window");
  });
  it("counts the layers and the charts", () => {
    expect(explorerSummary('{"v":1,"layers":[{},{},{}],"charts":[{},{},{},{},{},{}]}', s)).toBe("Custom window. Layers: 3, charts: 6");
  });
  it("says standard for a half left out or not a list", () => {
    expect(explorerSummary('{"v":1,"layers":[{"type":"landsat"}]}', s)).toBe("Custom window. Layers: 1, charts: standard");
    expect(explorerSummary('{"charts":[],"layers":"x"}', s)).toBe("Custom window. Layers: standard, charts: 0");
  });
  it("says it cannot be read when it is no JSON object", () => {
    expect(explorerSummary("landsat", s)).toBe("Unreadable");
    expect(explorerSummary("[1]", s)).toBe("Unreadable");
    expect(explorerSummary("null", s)).toBe("Unreadable");
  });
});

describe("explorerOrigin", () => {
  it("is the origin of gee_app_url", () => {
    expect(explorerOrigin("https://explorer.example.org/some/path/#x")).toBe("https://explorer.example.org");
    expect(explorerOrigin("http://localhost:5000/")).toBe("http://localhost:5000");
  });
  it("falls back to the public Explorer", () => {
    expect(explorerOrigin("")).toBe("https://explorer.collectearth.org");
    expect(explorerOrigin(null)).toBe("https://explorer.collectearth.org");
    expect(explorerOrigin("not an address")).toBe("https://explorer.collectearth.org");
    expect(explorerOrigin("javascript:alert(1)")).toBe("https://explorer.collectearth.org");
  });
});

describe("configureUrl", () => {
  it("carries the document, the plot as a point and the language", () => {
    const url = new URL(configureUrl("https://e.org", '{"v":1, "a":"&"}', [10.5, -3.25], "es-ES"));
    expect(url.origin + url.pathname).toBe("https://e.org/configure");
    expect(url.searchParams.get("config")).toBe('{"v":1, "a":"&"}');
    expect(JSON.parse(url.searchParams.get("geoJson")!)).toEqual({ type: "Point", coordinates: [-3.25, 10.5] });
    expect(url.searchParams.get("lang")).toBe("es");
  });
  it("leaves out an empty document and a point that is not in degrees; English for another language", () => {
    expect(configureUrl("https://e.org", "", [400000, 5000000], "mn")).toBe("https://e.org/configure?lang=en");
    expect(configureUrl("https://e.org", " ", null, "tr")).toBe("https://e.org/configure?lang=tr");
  });
});

describe("explorerMessage", () => {
  const frame = {} as Window;
  const data = { source: "collect-earth-explorer", type: "config", config: '{"v":1}', valid: true };
  const event = (over: Partial<{ origin: string; source: unknown; data: unknown }> = {}) =>
    ({ origin: "https://e.org", source: frame, data, ...over }) as Pick<MessageEvent, "origin" | "source" | "data">;

  it("takes the editor's message", () => {
    expect(explorerMessage(event(), "https://e.org", frame)).toEqual({ config: '{"v":1}', valid: true });
    expect(explorerMessage(event({ data: { ...data, config: "", valid: false } }), "https://e.org", frame)).toEqual({ config: "", valid: false });
  });
  it("refuses another origin or another window", () => {
    expect(explorerMessage(event({ origin: "https://evil.org" }), "https://e.org", frame)).toBeNull();
    expect(explorerMessage(event({ source: {} }), "https://e.org", frame)).toBeNull();
    expect(explorerMessage(event({ source: null }), "https://e.org", null)).toBeNull();
  });
  it("refuses another shape", () => {
    for (const d of [null, "config", { ...data, source: "x" }, { ...data, type: "ready" }, { ...data, config: 1 }, { ...data, valid: "true" }]) {
      expect(explorerMessage(event({ data: d }), "https://e.org", frame)).toBeNull();
    }
  });
});
