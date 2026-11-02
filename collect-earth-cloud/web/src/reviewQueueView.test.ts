import { describe, expect, it } from "vitest";
import { earthMapUrl, nextUndecided, queueKeyAction, stepIndex } from "./reviewQueueView";

const key = (k: string, extra: Partial<Parameters<typeof queueKeyAction>[0]> = {}) => queueKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra });
const field = (tagName: string, extra: { type?: string; role?: string | null; isContentEditable?: boolean } = {}) => ({
  tagName,
  type: extra.type,
  isContentEditable: extra.isContentEditable ?? false,
  getAttribute: (name: string) => (name === "role" ? (extra.role ?? null) : null),
});

describe("queueKeyAction: the review queue's keys", () => {
  it("1, 2, 3 decide; J and K move; C goes to the comment, in either case", () => {
    expect(["1", "2", "3", "j", "J", "k", "K", "c", "C"].map((k) => key(k))).toEqual(["first", "check", "recheck", "next", "next", "previous", "previous", "comment", "comment"]);
    expect(key("x")).toBeNull();
    expect(key("Escape")).toBeNull();
    expect(key("ArrowDown")).toBeNull();
  });

  it("never while typing: in a text field only Escape counts (it leaves the field)", () => {
    for (const target of [field("TEXTAREA"), field("INPUT", { type: "text" }), field("INPUT", { type: "search" }), field("INPUT"), field("SELECT"), field("DIV", { isContentEditable: true }), field("DIV", { role: "combobox" }), field("LI", { role: "option" })]) {
      expect(key("1", { target }), target.tagName).toBeNull();
      expect(key("j", { target }), target.tagName).toBeNull();
      expect(key("Escape", { target }), target.tagName).toBe("leave");
    }
    // On a button or a checkbox the keys work.
    expect(key("2", { target: field("BUTTON") })).toBe("check");
    expect(key("2", { target: field("INPUT", { type: "checkbox" }) })).toBe("check");
  });

  it("not with Ctrl, Cmd or Alt (the browser's own shortcuts)", () => {
    expect(key("1", { ctrlKey: true })).toBeNull();
    expect(key("c", { metaKey: true })).toBeNull();
    expect(key("j", { altKey: true })).toBeNull();
  });
});

describe("moving through the queue", () => {
  it("stepIndex stays within the list", () => {
    expect(stepIndex(0, 5, 1)).toBe(1);
    expect(stepIndex(4, 5, 1)).toBe(4);
    expect(stepIndex(0, 5, -1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it("nextUndecided: the next plot without a decision made here, else the next one, else the same", () => {
    const decided = new Set(["b", "c"]);
    expect(nextUndecided(["a", "b", "c", "d"], decided, 0)).toBe(3);
    expect(nextUndecided(["a", "b", "c"], decided, 0)).toBe(1);
    expect(nextUndecided(["a"], decided, 0)).toBe(0);
  });
});

describe("earthMapUrl", () => {
  it("opens Earth Map as Collect Earth does: the plot as a GeoJSON polygon named by its id, every area, embedded", () => {
    const url = earthMapUrl("101", -12.5, 30.25);
    expect(url.startsWith("https://earthmap.org?polygon=")).toBe(true);
    expect(url.endsWith("&aoi=global&embed=true")).toBe(true);
    const polygon = JSON.parse(new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("polygon")!);
    expect(polygon.type).toBe("Feature");
    expect(polygon.properties).toEqual({ name: "101" });
    expect(polygon.geometry.type).toBe("Polygon");
    const ring: [number, number][] = polygon.geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // Around the plot's centre, longitude first.
    const lons = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    expect((Math.min(...lons) + Math.max(...lons)) / 2).toBeCloseTo(30.25, 6);
    expect((Math.min(...lats) + Math.max(...lats)) / 2).toBeCloseTo(-12.5, 6);
    expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(0.002);
  });

  it("keeps a plot id with quotes valid", () => {
    const url = earthMapUrl('a"b\\c', 0, 0);
    const polygon = JSON.parse(new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("polygon")!);
    expect(polygon.properties.name).toBe('a"b\\c');
  });
});
