import { describe, expect, it } from "vitest";
import { byId, countStatuses, footprintCorners, indexPlots, heightForZoom, matchesFilter, neighbour, nextUnfinished, normalizeStatus, plotParam, plotsNear,
  plotToRestore, plotsGone, sameView, surveyView, withoutPlotParam,
  visibleIds, zoomForHeight } from "./plots";
import type { PlotStatus } from "./types";

const order = ["p1", "p2", "p3", "p4", "p10"];
const statuses: Record<string, PlotStatus> = { p1: "saved", p2: "partial", p3: "saved", p4: "empty", p10: "saved" };

describe("filtering", () => {
  it("applies the status chip and a case-insensitive id search", () => {
    expect(visibleIds(order, statuses, "all", "")).toEqual(order);
    expect(visibleIds(order, statuses, "pending", "")).toEqual(["p2", "p4"]);
    expect(visibleIds(order, statuses, "saved", "")).toEqual(["p1", "p3", "p10"]);
    expect(visibleIds(order, statuses, "all", " P1 ")).toEqual(["p1", "p10"]);
    expect(matchesFilter("x", "empty", "saved", "")).toBe(false);
  });
});

describe("nextUnfinished", () => {
  it("starts at the beginning, skips completed plots and wraps around", () => {
    expect(nextUnfinished(order, statuses, null)).toBe("p2");
    expect(nextUnfinished(order, statuses, "p2")).toBe("p4");
    expect(nextUnfinished(order, statuses, "p4")).toBe("p2");
  });
  it("returns null when everything is completed", () => {
    expect(nextUnfinished(["a"], { a: "saved" }, null)).toBeNull();
    expect(nextUnfinished([], {}, null)).toBeNull();
  });
});

describe("neighbour", () => {
  it("moves within the list and stops at the ends", () => {
    expect(neighbour(order, "p2", 1)).toBe("p3");
    expect(neighbour(order, "p2", -1)).toBe("p1");
    expect(neighbour(order, "p10", 1)).toBeNull();
    expect(neighbour(order, "p1", -1)).toBeNull();
  });
  it("enters the list from outside", () => {
    expect(neighbour(order, null, 1)).toBe("p1");
    expect(neighbour(order, "zz", -1)).toBe("p10");
    expect(neighbour([], "p1", 1)).toBeNull();
  });
});

describe("counts and statuses", () => {
  it("counts completed, in-progress and pending plots", () => {
    expect(countStatuses(order, statuses)).toEqual({ total: 5, saved: 3, partial: 1, pending: 2 });
  });
  it("treats unknown status values as not started", () => {
    expect(normalizeStatus("saved")).toBe("saved");
    expect(normalizeStatus("bogus")).toBe("empty");
    expect(normalizeStatus(undefined)).toBe("empty");
  });
});

describe("Google Earth Web footprint", () => {
  const view = { latitude: 0, longitude: 0, widthMeters: 2000, heightMeters: 1000, heading: 0 };
  const m = 1 / 111320; // degrees per metre at the equator
  it("is the camera rectangle when looking north", () => {
    const [tl, tr, br, bl] = footprintCorners(view);
    expect(tl[0]).toBeCloseTo(500 * m, 9); expect(tl[1]).toBeCloseTo(-1000 * m, 9);
    expect(tr[1]).toBeCloseTo(1000 * m, 9);
    expect(br[0]).toBeCloseTo(-500 * m, 9); expect(bl[1]).toBeCloseTo(-1000 * m, 9);
  });
  it("rotates with the heading (90 = looking east: screen-up points east)", () => {
    const [tl] = footprintCorners({ ...view, heading: 90 });
    // top-left of the screen is then north-east of the centre
    expect(tl[0]).toBeCloseTo(1000 * m, 9);
    expect(tl[1]).toBeCloseTo(500 * m, 9);
  });
});

describe("plotsNear", () => {
  it("keeps plots within the radius, nearest first, up to the limit", () => {
    const m = 1 / 111320;
    const centers: Record<string, [number, number]> = { a: [0, 0], far: [0, 5000 * m], b: [0, 300 * m], c: [0, 100 * m] };
    expect(plotsNear(centers, [0, 0], 1000, 10)).toEqual(["a", "c", "b"]);
    expect(plotsNear(centers, [0, 0], 1000, 2)).toEqual(["a", "c"]);
  });
});

describe("map zoom and Google Earth Web camera", () => {
  it("converts both ways between the zoom and the height of ground in view", () => {
    // Web Mercator zoom 17 at the equator: 1.194 m per pixel, 800 px high
    expect(heightForZoom(17, 800, 0)).toBeCloseTo(955.46, 1);
    expect(zoomForHeight(heightForZoom(16.3, 640, -4.99), 640, -4.99)).toBeCloseTo(16.3, 9);
    // Twice the ground in view is one zoom level out
    expect(zoomForHeight(2000, 800, 45) - zoomForHeight(4000, 800, 45)).toBeCloseTo(1, 9);
  });
  it("treats views within a few per cent as the same", () => {
    const a = { center: [-4.99, 151.35] as [number, number], heightMeters: 1000 };
    expect(sameView(a, { center: [-4.99 + 10 / 111320, 151.35], heightMeters: 1010 })).toBe(true);
    // moved by a tenth of the view, or zoomed by a fifth
    expect(sameView(a, { center: [-4.99 + 100 / 111320, 151.35], heightMeters: 1000 })).toBe(false);
    expect(sameView(a, { ...a, heightMeters: 1200 })).toBe(false);
  });
  it("treats views of no height at the same place as the same", () => {
    const flat = { center: [-4.99, 151.35] as [number, number], heightMeters: 0 };
    expect(sameView(flat, { ...flat })).toBe(true);
    expect(sameView(flat, { center: [-4.99 + 100 / 111320, 151.35], heightMeters: 0 })).toBe(false);
    expect(sameView(flat, { ...flat, heightMeters: 1000 })).toBe(false);
    expect(sameView({ ...flat, heightMeters: 1000 }, flat)).toBe(false);
  });
});

describe("a plots map reopened on a plot", () => {
  it("reads the plot from the address, decoded as Collect Earth encodes it", () => {
    expect(plotParam("?plot=710%2C1")).toBe("710,1");
    expect(plotParam("?plot=a+b%26c%3Dd")).toBe("a b&c=d");
    expect(plotParam("")).toBeNull();
    expect(plotParam("?plot=")).toBeNull();
    expect(plotParam("?other=1")).toBeNull();
  });

  it("selects it only if the survey has it", () => {
    const plots = { "710,1": {}, p2: {} };
    expect(plotToRestore("710,1", plots)).toBe("710,1");
    expect(plotToRestore("gone", plots)).toBeNull();
    expect(plotToRestore("toString", plots)).toBeNull();
    expect(plotToRestore(null, plots)).toBeNull();
  });

  it("takes the plot out of the address and keeps the rest", () => {
    expect(withoutPlotParam("http://127.0.0.1:8028/earth/map?plot=710%2C1")).toBe("http://127.0.0.1:8028/earth/map");
    expect(withoutPlotParam("http://h/earth/map?a=1&plot=x#top")).toBe("http://h/earth/map?a=1#top");
  });
});

describe("the plots of a load", () => {
  const feature = (id: string, n: number) => ({ properties: { id }, n });

  it("keeps the order of the file, an id repeated in the place it first had with its last data", () => {
    const { order, plots } = indexPlots([feature("p1", 1), feature("p2", 2), feature("p1", 3)], (f) => f.n);
    expect(order).toEqual(["p1", "p2"]);
    expect(plots.p1).toBe(3);
    expect(plots.p2).toBe(2);
  });

  it("tells the plots of the load before that this load no longer has", () => {
    const before = indexPlots([feature("p1", 1), feature("p2", 2), feature("__proto__", 3)], (f) => f.n).plots;
    const now = indexPlots([feature("p2", 2), feature("p3", 3)], (f) => f.n).plots;
    expect(plotsGone(before, now)).toEqual(["p1", "__proto__"]);
    expect(plotsGone(byId<number>(), now)).toEqual([]);
  });

  it("has the plots named like the properties of an object", () => {
    const ids = ["constructor", "toString", "__proto__", "hasOwnProperty", "p1"];
    const { order, plots } = indexPlots(ids.map((id, i) => feature(id, i)), (f) => f.n);
    expect(order).toEqual(ids);
    ids.forEach((id, i) => expect(plots[id]).toBe(i));
    expect(Object.keys(plots)).toEqual(ids);
    expect(plots.valueOf).toBeUndefined();
    expect(plotToRestore("__proto__", plots)).toBe("__proto__");
    expect(plotToRestore("valueOf", plots)).toBeNull();
  });

  it("makes a dictionary by plot id where no id is there before it is put", () => {
    const statuses = byId<PlotStatus>();
    expect(statuses.constructor).toBeUndefined();
    statuses["__proto__"] = "saved";
    expect(Object.keys(statuses)).toEqual(["__proto__"]);
    expect(visibleIds(["__proto__", "constructor"], statuses, "pending", "")).toEqual(["constructor"]);
  });
});

describe("surveyView", () => {
  it("looks at the middle of the plots from high enough to see them all", () => {
    const view = surveyView([[0, 10], [0.2, 10.1], [0.1, 10.2]]);
    expect(view.center[0]).toBeCloseTo(0.1);
    expect(view.center[1]).toBeCloseTo(10.1);
    expect(view.heightMeters).toBe(Math.round(0.2 * 111320 * 1.5));
  });
  it("is never closer than 5 km, for a single plot", () => {
    expect(surveyView([[1, 2]]).heightMeters).toBe(5000);
  });
});
