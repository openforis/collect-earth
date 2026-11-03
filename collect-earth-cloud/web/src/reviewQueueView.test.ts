import { describe, expect, it } from "vitest";
import { earthMapUrl, nextUndecided, outlineRing, queueKeyAction, stepIndex } from "./reviewQueueView";

const key = (k: string, extra: Partial<Parameters<typeof queueKeyAction>[0]> = {}) => queueKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, composing: false, inside: true, target: null, ...extra });
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

  it("a held key decides once: 1/2/3 and C are not repeated, J and K are", () => {
    for (const k of ["1", "2", "3", "c"]) expect(key(k, { repeat: true }), k).toBeNull();
    expect(key("j", { repeat: true })).toBe("next");
    expect(key("k", { repeat: true })).toBe("previous");
  });

  it("not while an input method is composing, nor for keys pressed outside the queue (a dialog in a portal)", () => {
    expect(key("1", { composing: true })).toBeNull();
    expect(key("Escape", { composing: true, target: field("TEXTAREA") })).toBeNull();
    expect(key("2", { inside: false })).toBeNull();
    expect(key("j", { inside: false })).toBeNull();
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

describe("outlineRing: the plot's outline as Collect Earth draws it", () => {
  /** Metres between two points, on the WGS84 ellipsoid (a local approximation, good to millimetres over 100 m). */
  const metres = (lat: number, dLat: number, dLon: number) => {
    const a = 6378137;
    const e2 = 0.00669437999014;
    const s = Math.sin((lat * Math.PI) / 180);
    const m = (a * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5);
    const n = a / Math.sqrt(1 - e2 * s * s);
    return { north: (dLat * Math.PI * m) / 180, east: (dLon * Math.PI * n * Math.cos((lat * Math.PI) / 180)) / 180 };
  };

  it("a square of the plot's side, top left first, clockwise, closed (SquareKmlGenerator): 70 m at -1.2, 36.8", () => {
    const ring = outlineRing(-1.2, 36.8, { kind: "square", sideMeters: 70 });
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    const [tl, tr, br, bl] = ring;
    // Longitude first; top left is north-west.
    expect(tl[1]).toBeGreaterThan(bl[1]);
    expect(tl[0]).toBeLessThan(tr[0]);
    const side = metres(-1.2, tl[1] - bl[1], tr[0] - tl[0]);
    expect(side.north).toBeCloseTo(70, 1);
    expect(side.east).toBeCloseTo(70, 1);
    // Centred on the plot.
    expect((tl[0] + br[0]) / 2).toBeCloseTo(36.8, 6);
    expect((tl[1] + br[1]) / 2).toBeCloseTo(-1.2, 6);
    // 1 degree of latitude at the equator is 110,574 m: 35 m north is 0.000317 degrees.
    expect(outlineRing(0, 0, { kind: "square", sideMeters: 70 })[0][1]).toBeCloseTo(35 / 110574.3, 7);
  });

  it("a circle of 130 points at the radius, each offset rounded to whole metres (CircleKmlGenerator), closed", () => {
    const ring = outlineRing(45, 7, { kind: "circle", radiusMeters: 35, vertices: 130 });
    expect(ring).toHaveLength(131);
    expect(ring[0]).toEqual(ring[130]);
    // The first point: 35 m east (cos 0 = 1, sin 0 = 0).
    expect(metres(45, ring[0][1] - 45, ring[0][0] - 7).east).toBeCloseTo(35, 1);
    expect(ring[0][1]).toBeCloseTo(45, 7);
    // The hexagon's second vertex is at 60 degrees: round(55 × 0.5) = 28 m east, round(55 × 0.866) = 48 m north.
    const hexagon = outlineRing(45, 7, { kind: "circle", radiusMeters: 55, vertices: 6 });
    expect(hexagon).toHaveLength(7);
    const second = metres(45, hexagon[1][1] - 45, hexagon[1][0] - 7);
    expect(second.east).toBeCloseTo(28, 1);
    expect(second.north).toBeCloseTo(48, 1);
  });

  it("only the place: a marker square of 100 m", () => {
    const ring = outlineRing(0, 0, { kind: "place" });
    expect(ring).toHaveLength(5);
    expect(metres(0, ring[0][1] - ring[3][1], 0).north).toBeCloseTo(100, 0);
  });
});

describe("earthMapUrl", () => {
  it("opens Earth Map as Collect Earth does: the plot as a GeoJSON polygon named by its visible id, every area, embedded", () => {
    const url = earthMapUrl("101", -12.5, 30.25, { kind: "square", sideMeters: 70 });
    expect(url.startsWith("https://earthmap.org?polygon=")).toBe(true);
    expect(url.endsWith("&aoi=global&embed=true")).toBe(true);
    const polygon = JSON.parse(new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("polygon")!);
    expect(polygon.type).toBe("Feature");
    expect(polygon.properties).toEqual({ name: "101" });
    expect(polygon.geometry.type).toBe("Polygon");
    expect(polygon.geometry.coordinates[0]).toEqual(outlineRing(-12.5, 30.25, { kind: "square", sideMeters: 70 }));
  });

  it("keeps a plot id with quotes valid", () => {
    const url = earthMapUrl('a"b\\c', 0, 0, { kind: "place" });
    const polygon = JSON.parse(new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("polygon")!);
    expect(polygon.properties.name).toBe('a"b\\c');
  });
});
