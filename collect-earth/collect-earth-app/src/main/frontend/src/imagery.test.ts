import { describe, expect, it } from "vitest";
import { imageryChoices, imageryForNumber, imageryNumberOf, reconcileImagery } from "./imagery";

describe("the keys of the imagery sources", () => {
  const status = { sources: ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK", "GEE_APP", "EARTH_MAP"], visible: "GOOGLE_EARTH_WEB" } as const;
  const all = { ...status, sources: [...status.sources] };
  it("number them in the order of their buttons, Google Earth Web first", () => {
    expect(imageryNumberOf(all, "GOOGLE_EARTH_WEB")).toBe(1);
    expect(imageryNumberOf(all, "EARTH_MAP")).toBe(4);
    expect(imageryForNumber(all, false, 1)).toBe("GOOGLE_EARTH_WEB");
    expect(imageryForNumber(all, false, 3)).toBe("GEE_APP");
  });
  it("keep their numbers in Google Earth Web's panel, where Alt+1 has no button to press", () => {
    expect(imageryForNumber(all, true, 1)).toBeNull();
    expect(imageryForNumber(all, true, 2)).toBe("ESRI_WAYBACK");
  });
  it("show nothing for a number with no source, or when there is nothing to switch between", () => {
    expect(imageryForNumber(all, false, 5)).toBeNull();
    expect(imageryForNumber({ sources: ["GOOGLE_EARTH_WEB"], visible: null }, false, 1)).toBeNull();
  });
});

describe("imageryChoices", () => {
  it("leaves Google Earth Web out in its own panel, and keeps a single other source there", () => {
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK"], visible: "ESRI_WAYBACK" }, true)).toEqual([
      { source: "ESRI_WAYBACK", shown: true },
    ]);
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB"], visible: "GOOGLE_EARTH_WEB" }, true)).toEqual([]);
  });
  it("offers nothing to switch with one tab or none", () => {
    expect(imageryChoices({ sources: [], visible: null })).toEqual([]);
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB"], visible: "GOOGLE_EARTH_WEB" })).toEqual([]);
  });
  it("lists the tabs in their order and marks the one shown", () => {
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK"], visible: "ESRI_WAYBACK" })).toEqual([
      { source: "GOOGLE_EARTH_WEB", shown: false },
      { source: "ESRI_WAYBACK", shown: true },
    ]);
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
