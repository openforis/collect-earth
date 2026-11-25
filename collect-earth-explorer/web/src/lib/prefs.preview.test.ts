import { describe, expect, it, vi } from "vitest";

// Before any import: prefs.ts reads the address once, when it loads.
vi.hoisted(() => window.history.replaceState({}, "", "/?geoJson=x&preview=1"));

import { readPref, sessionNumber, writePref } from "./prefs";

describe("in the editor's preview (preview=1)", () => {
  it("prefs neither read nor write localStorage, keeping choices in memory", () => {
    localStorage.setItem("explorer.trend", "false");
    localStorage.setItem("explorer.view.abc", '{"activeLayer":"1"}');
    expect(readPref("explorer.trend", true)).toBe(true);
    expect(readPref("explorer.view.abc", "{}")).toBe("{}");
    writePref("explorer.trend", true);
    writePref("explorer.maxCloud", "20");
    expect(localStorage.getItem("explorer.trend")).toBe("false");
    expect(localStorage.getItem("explorer.maxCloud")).toBeNull();
    expect(readPref("explorer.maxCloud", "40")).toBe("20");
    window.history.replaceState({}, "", "/");
  });

  it("sessionNumber is Infinity and stores nothing", () => {
    expect(sessionNumber("explorer.guide")).toBe(Infinity);
    expect(localStorage.getItem("explorer.guide")).toBeNull();
    expect(sessionStorage.getItem("explorer.guide")).toBeNull();
  });
});
