import { describe, expect, it } from "vitest";
import { countStatuses, matchesFilter, neighbour, nextUnfinished, normalizeStatus, visibleIds } from "./plots";
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
