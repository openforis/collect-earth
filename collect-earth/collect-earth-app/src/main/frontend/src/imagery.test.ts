import { describe, expect, it } from "vitest";
import { imageryChoices, imageryForNumber, imageryNumberOf, reconcileImagery } from "./imagery";

describe("the keys of the imagery sources", () => {
  const status = { sources: ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK", "GEE_APP", "EARTH_MAP"], visible: "GOOGLE_EARTH_WEB" } as const;
  const all = { ...status, sources: [...status.sources] };
  it("number them in the order of the tabs, Google Earth Web first", () => {
    expect(imageryNumberOf(all, "GOOGLE_EARTH_WEB")).toBe(1);
    expect(imageryNumberOf(all, "EARTH_MAP")).toBe(4);
    expect(imageryForNumber(all, 2)).toBe("ESRI_WAYBACK");
    expect(imageryForNumber(all, 3)).toBe("GEE_APP");
  });
  it("show nothing for Google Earth Web, which has no button in its own panel, nor for a number with no source", () => {
    expect(imageryForNumber(all, 1)).toBeNull();
    expect(imageryForNumber(all, 5)).toBeNull();
  });
});

describe("imageryChoices", () => {
  it("leaves Google Earth Web out, keeps a single other source, and marks the one shown", () => {
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK"], visible: "ESRI_WAYBACK" })).toEqual([
      { source: "ESRI_WAYBACK", shown: true },
    ]);
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK", "PLANET"], visible: "PLANET" })).toEqual([
      { source: "ESRI_WAYBACK", shown: false },
      { source: "PLANET", shown: true },
    ]);
  });
  it("offers nothing with Google Earth Web alone, or no tab", () => {
    expect(imageryChoices({ sources: [], visible: null })).toEqual([]);
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB"], visible: "GOOGLE_EARTH_WEB" })).toEqual([]);
  });
});

describe("reconcileImagery", () => {
  const sources = ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK"] as const;
  const server = { sources: [...sources], visible: "GOOGLE_EARTH_WEB" as const };
  it("keeps the source the user picked until the server shows it, or the wait is over", () => {
    const picked = { source: "ESRI_WAYBACK" as const, until: 1000 };
    expect(reconcileImagery(server, picked, 500)).toEqual({ status: { ...server, visible: "ESRI_WAYBACK" }, expected: picked });
    expect(reconcileImagery(server, picked, 1001)).toEqual({ status: server, expected: null });
    const shown = { ...server, visible: "ESRI_WAYBACK" as const };
    expect(reconcileImagery(shown, picked, 500)).toEqual({ status: shown, expected: null });
  });
});
