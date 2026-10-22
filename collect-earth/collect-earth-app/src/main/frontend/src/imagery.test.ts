import { describe, expect, it } from "vitest";
import { imageryChoices, reconcileImagery } from "./imagery";

describe("imageryChoices", () => {
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
