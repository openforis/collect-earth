import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formUrl } from "./api";
import type { PlotFeature } from "./types";

const plot: PlotFeature = {
  type: "Feature",
  geometry: { type: "GeometryCollection", geometries: [] },
  properties: { id: "17,1", latitude: "1", longitude: "2" },
};

beforeEach(() => vi.stubGlobal("window", { location: { origin: "http://localhost:8028", port: "8028" } }));
afterEach(() => vi.unstubAllGlobals());

describe("the form of a plot", () => {
  it("says a training plot and a plot to correct in its address", () => {
    expect(formUrl(plot, "generated", "es")).toBe("http://localhost:8028/earth/form?id=17%2C1&lang=es");
    expect(formUrl(plot, "generated", "en", true)).toContain("&training=1");
    expect(formUrl(plot, "generated", "en", false, true)).toBe("http://localhost:8028/earth/form?id=17%2C1&lang=en&correction=1");
  });

  it("is always the generated form for a plot to correct, even in a project with its own balloon", () => {
    expect(formUrl(plot, "balloon", "en")).toContain("/earth/balloon?");
    expect(formUrl(plot, "balloon", "en", false, true)).toBe("http://localhost:8028/earth/form?id=17%2C1&lang=en&correction=1");
  });
});
