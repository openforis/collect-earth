import { describe, expect, it } from "vitest";
import { byId, changedAfterSubmit, countStatuses, indexPlots, labelOfFeature, leftUnsubmitted, matchesFilter, neighbour, nextUnfinished, normalizeStatus, plotsNear,
  MAX_VIEW_HEIGHT, matchesElsewhere, plotLabel, previousMessage, previousPlot, previousStands, surveyView, visibleIds,
  countPeriods, matchesPeriod, periodAnswer } from "./plots";
import type { PeriodAnswer, PlotStatus } from "./types";

const order = ["p1", "p2", "p3", "p4", "p10"];
const statuses: Record<string, PlotStatus> = { p1: "saved", p2: "partial", p3: "saved", p4: "empty", p10: "saved" };

describe("filtering", () => {
  it("applies the status chip and a case-insensitive id search", () => {
    expect(visibleIds(order, statuses, "all", "", byId())).toEqual(order);
    expect(visibleIds(order, statuses, "pending", "", byId())).toEqual(["p2", "p4"]);
    expect(visibleIds(order, statuses, "saved", "", byId())).toEqual(["p1", "p3", "p10"]);
    expect(visibleIds(order, statuses, "all", " P1 ", byId())).toEqual(["p1", "p10"]);
    expect(matchesFilter("x", "empty", "saved", "")).toBe(false);
  });
});

describe("a search that finds nothing in the list filtered", () => {
  it("offers the plots it finds in the list the filter leaves out", () => {
    expect(matchesElsewhere(order, statuses, "pending", "p1", byId())).toEqual({ count: 2, filter: "saved" });
    expect(matchesElsewhere(order, statuses, "saved", "p4", byId())).toEqual({ count: 1, filter: "pending" });
  });
  it("offers nothing when it finds none there either, nothing is filtered or nothing searched", () => {
    expect(matchesElsewhere(order, statuses, "pending", "p9", byId())).toBeNull();
    expect(matchesElsewhere(order, statuses, "all", "p1", byId())).toBeNull();
    expect(matchesElsewhere(order, statuses, "pending", " ", byId())).toBeNull();
  });
});

describe("same as previous plot", () => {
  it("keeps the answers of the plot submitted last, with its survey and the operator", () => {
    const first = previousPlot(null, { type: "ce:saved", plotId: "p1", survey: "s", answers: { a: "1" } }, "ana");
    expect(first).toEqual({ plotId: "p1", survey: "s", operator: "ana", answers: { a: "1" } });
    expect(previousPlot(first, { type: "ce:saved", plotId: "p2", survey: "s", answers: { a: "2" } }, "ana"))
      .toEqual({ plotId: "p2", survey: "s", operator: "ana", answers: { a: "2" } });
  });
  it("is not changed by other messages, nor a submit without answers", () => {
    const first = { plotId: "p1", survey: "s", operator: "ana", answers: { a: "1" } };
    expect(previousPlot(first, { type: "ce:dirty", plotId: "p2" }, "ana")).toBe(first);
    expect(previousPlot(first, { type: "ce:saved", plotId: "p2" }, "ana")).toBe(first);
  });
  it("tells them to the form of another plot only, in the same survey, for the same operator", () => {
    const first = { plotId: "p1", survey: "s", operator: "ana", answers: { a: "1" } };
    expect(previousMessage(first, "p2", "s", "ana")).toEqual({ type: "ce:previous", plotId: "p1", survey: "s", answers: { a: "1" } });
    expect(previousMessage(first, "p1", "s", "ana")).toBeNull();
    expect(previousMessage(first, "p2", "other", "ana")).toBeNull();
    expect(previousMessage(first, "p2", "s", "luis")).toBeNull();
    expect(previousMessage(null, "p2", "s", "ana")).toBeNull();
    expect(previousStands(first, "s", "ana")).toBe(true);
    expect(previousStands(first, "s", null)).toBe(false);
  });
});

describe("the label a plot is shown by", () => {
  // A survey whose round key is hidden from the collector: a quality control copy must look like a main plot
  const features = [
    { properties: { id: "101,1", visibleId: "101" } },
    { properties: { id: "105,2", visibleId: "105" } },
    { properties: { id: "107,2", visibleId: "107" } },
  ];
  const { order, labels } = indexPlots(features, (f) => f);

  it("is the visible id, while the plots stay keyed by their whole id", () => {
    expect(order).toEqual(["101,1", "105,2", "107,2"]);
    expect(plotLabel(labels, "105,2")).toBe("105");
    expect(Object.values(labels).some((label) => label.includes(","))).toBe(false);
  });

  it("is the id for a plot file without visible ids, or a plot not loaded, and nothing for no plot", () => {
    expect(labelOfFeature({ id: "p1" })).toBe("p1");
    expect(labelOfFeature({ id: "p1", visibleId: null })).toBe("p1");
    expect(labelOfFeature({ id: "1,2", visibleId: "" })).toBe("");
    expect(plotLabel(labels, "999,1")).toBe("999,1");
    expect(plotLabel(labels, null)).toBe("");
    expect(plotLabel(labels, "constructor")).toBe("constructor");
  });

  it("is what the search looks in, never the hidden keys", () => {
    const statuses = byId<PlotStatus>();
    expect(visibleIds(order, statuses, "all", "105", labels)).toEqual(["105,2"]);
    expect(visibleIds(order, statuses, "all", ",2", labels)).toEqual([]);
    expect(visibleIds(order, statuses, "all", ",1", labels)).toEqual([]);
    expect(visibleIds(order, statuses, "all", "10", labels)).toEqual(order);
  });

  it("is the plot's place in the file when every key is hidden, never the hidden keys", () => {
    const hidden = indexPlots([
      { properties: { id: "7,1", visibleId: "" } },
      { properties: { id: "9,2", visibleId: "" } },
      { properties: { id: "7,1", visibleId: "" } },
      { properties: { id: "11,1", visibleId: "11" } },
    ], (f) => f);
    expect(hidden.order).toEqual(["7,1", "9,2", "11,1"]);
    expect(plotLabel(hidden.labels, "7,1")).toBe("#1");
    expect(plotLabel(hidden.labels, "9,2")).toBe("#2");
    expect(plotLabel(hidden.labels, "11,1")).toBe("11");
    expect(visibleIds(hidden.order, byId<PlotStatus>(), "all", ",2", hidden.labels)).toEqual([]);
  });

  it("may be shared by two plots, which the list still tells apart by id", () => {
    const twice = indexPlots([{ properties: { id: "5,1", visibleId: "5" } }, { properties: { id: "5,2", visibleId: "5" } }],
      (f) => f.properties.id);
    expect(twice.order).toEqual(["5,1", "5,2"]);
    expect(twice.plots["5,2"]).toBe("5,2");
    expect(visibleIds(twice.order, byId<PlotStatus>(), "all", "5", twice.labels)).toEqual(["5,1", "5,2"]);
    expect(nextUnfinished(twice.order, { "5,1": "saved" }, "5,1")).toBe("5,2");
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

describe("leftUnsubmitted", () => {
  it("is the plot changed after it was submitted, when the form leaves it for another plot or closes", () => {
    expect(leftUnsubmitted("p1", "p1", "p2")).toBe("p1");
    expect(leftUnsubmitted("p1", "p1", null)).toBe("p1");
  });
  it("is none when the plot open again is the same, another plot is left, or nothing was changed", () => {
    expect(leftUnsubmitted("p1", "p1", "p1")).toBeNull();
    expect(leftUnsubmitted("p1", "p2", "p3")).toBeNull();
    expect(leftUnsubmitted(null, "p1", "p2")).toBeNull();
    expect(leftUnsubmitted("p1", null, "p1")).toBeNull();
  });
});

describe("a plot changed after it was submitted", () => {
  it("is the one whose form says a change took its submission back, until it is submitted again", () => {
    let changed = changedAfterSubmit(null, { type: "ce:dirty", plotId: "p1", unsubmitted: true });
    expect(changed).toBe("p1");
    expect(changedAfterSubmit(changed, { type: "ce:dirty", plotId: "p1" })).toBe("p1");
    changed = changedAfterSubmit(changed, { type: "ce:saved", plotId: "p1" });
    expect(changed).toBeNull();
  });
  it("is never a plot not submitted, nor one submitted with questions left, whose check takes it back", () => {
    expect(changedAfterSubmit(null, { type: "ce:dirty", plotId: "p1" })).toBeNull();
    expect(changedAfterSubmit(null, { type: "ce:dirty", plotId: "p1", unsubmitted: false })).toBeNull();
    expect(changedAfterSubmit(null, { type: "ce:key", plotId: "p1" })).toBeNull();
  });
  it("is told when the form leaves it, after a change, and only then", () => {
    let changed = changedAfterSubmit(null, { type: "ce:dirty", plotId: "p1", unsubmitted: true });
    expect(leftUnsubmitted(changed, "p1", "p2")).toBe("p1");
    changed = changedAfterSubmit(changed, { type: "ce:saved", plotId: "p1" });
    expect(leftUnsubmitted(changed, "p1", "p2")).toBeNull();
    expect(leftUnsubmitted(changedAfterSubmit(null, { type: "ce:dirty", plotId: "p3" }), "p3", null)).toBeNull();
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

describe("plotsNear", () => {
  it("keeps plots within the radius, nearest first, up to the limit", () => {
    const m = 1 / 111320;
    const centers: Record<string, [number, number]> = { a: [0, 0], far: [0, 5000 * m], b: [0, 300 * m], c: [0, 100 * m] };
    expect(plotsNear(centers, [0, 0], 1000, 10)).toEqual(["a", "c", "b"]);
    expect(plotsNear(centers, [0, 0], 1000, 2)).toEqual(["a", "c"]);
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

  it("has the plots named like the properties of an object", () => {
    const ids = ["constructor", "toString", "__proto__", "hasOwnProperty", "p1"];
    const { order, plots } = indexPlots(ids.map((id, i) => feature(id, i)), (f) => f.n);
    expect(order).toEqual(ids);
    ids.forEach((id, i) => expect(plots[id]).toBe(i));
    expect(Object.keys(plots)).toEqual(ids);
    expect(plots.valueOf).toBeUndefined();
  });

  it("makes a dictionary by plot id where no id is there before it is put", () => {
    const statuses = byId<PlotStatus>();
    expect(statuses.constructor).toBeUndefined();
    statuses["__proto__"] = "saved";
    expect(Object.keys(statuses)).toEqual(["__proto__"]);
    expect(visibleIds(["__proto__", "constructor"], statuses, "pending", "", byId())).toEqual(["constructor"]);
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
  it("is never higher than the server accepts, for plots spread over continents", () => {
    const view = surveyView([[-40, -70], [60, 140]]);
    expect(view.heightMeters).toBe(MAX_VIEW_HEIGHT);
    expect(view.heightMeters).toBeLessThanOrEqual(2.0e7);
  });
});

describe("a repeat survey's filter by the earlier period", () => {
  const periods = Object.assign(byId<PeriodAnswer>(), { p1: "same", p2: "changed", p3: "corrected" } as const);

  it("shows the plots of one answer, or those not answered yet, and the search and the status chip still apply", () => {
    expect(visibleIds(order, statuses, "all", "", byId(), { periods, filter: "all" })).toEqual(order);
    expect(visibleIds(order, statuses, "all", "", byId(), { periods, filter: "changed" })).toEqual(["p2"]);
    expect(visibleIds(order, statuses, "all", "", byId(), { periods, filter: "none" })).toEqual(["p4", "p10"]);
    expect(visibleIds(order, statuses, "saved", "", byId(), { periods, filter: "none" })).toEqual(["p10"]);
    expect(visibleIds(order, statuses, "all", "1", byId(), { periods, filter: "same" })).toEqual(["p1"]);
    // a project that repeats no survey is not filtered by it
    expect(visibleIds(order, statuses, "all", "", byId(), null)).toEqual(order);
    expect(matchesPeriod(undefined, "same")).toBe(false);
    expect(matchesPeriod("corrected", "corrected")).toBe(true);
  });

  it("counts the plots of each answer", () => {
    expect(countPeriods(order, periods)).toEqual({ all: 5, same: 1, changed: 1, corrected: 1, none: 2 });
  });

  it("reads the answers the server sends: anything else is not answered", () => {
    expect(["same", "changed", "corrected", "", "other", null].map(periodAnswer)).toEqual(["same", "changed", "corrected", null, null, null]);
  });

  it("offers the plots of the other status chip the search finds, filtered by the earlier period too", () => {
    expect(matchesElsewhere(order, statuses, "pending", "p", byId(), { periods, filter: "same" })).toEqual({ count: 1, filter: "saved" });
  });
});
