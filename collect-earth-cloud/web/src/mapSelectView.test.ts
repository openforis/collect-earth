import { describe, expect, it } from "vitest";
import { addMapPage, MAP_STATUSES, type MapPlots } from "./api";
import { addResult, areaOf, givePlan, inAreas, MOVE_AT_MOST, selectInAreas, summarizeSelection } from "./mapSelectView";
import { shownIndexes } from "./mapView";

const S = Object.fromEntries(MAP_STATUSES.map((s, i) => [s, i])) as Record<(typeof MAP_STATUSES)[number], number>;

/**
 * Plots: 1-3 in the divided file d (1 ana, 2 ben, 3 ana and ben), 4 submitted (ana), 5 a reference plot,
 * 6 in the whole file w, 7 in both files, 8 held by nobody, 9 started (ben), far away at 50, 170.
 */
function map(): MapPlots {
  return addMapPage(null, {
    version: "v",
    offset: 0,
    total: 9,
    points: [
      [1, 1, S.notStarted, 0],
      [2, 2, S.notStarted, 1],
      [3, 3, S.notStarted, 2],
      [4, 4, S.accepted, 0],
      [5, 5, S.notStarted, 0],
      [6, 6, S.notStarted, 0],
      [7, 7, S.started, 0],
      [8, 8, S.notStarted, -1],
      [50, 170, S.started, 1],
    ],
    plots: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    file: [0, 0, 0, 0, 0, 1, -1, 0, 0],
    reference: [4],
    next: null,
    names: null,
    statuses: MAP_STATUSES,
    counts: [6, 2, 0, 1, 0, 0, 0],
    notOnMap: 0,
    files: [
      { id: "d", filename: "divided.csv", plots: 8, onMap: 8, divided: true },
      { id: "w", filename: "whole.csv", plots: 1, onMap: 1, divided: false },
    ],
    people: ["ana", "ben"],
    holders: [["ana"], ["ben"], ["ana", "ben"]],
    figures: null,
    asOf: null,
  });
}

const all = (m: MapPlots) => shownIndexes(m, new Set(MAP_STATUSES));

describe("selecting plots on the map", () => {
  it("selects the shown plots inside the rectangles drawn, also on a map scrolled past ±180", () => {
    const m = map();
    expect([...selectInAreas(m, all(m), [])]).toEqual([]);
    expect([...selectInAreas(m, all(m), [areaOf({ lat: 2.5, lng: 3.5 }, { lat: 0, lng: 0 })])]).toEqual([0, 1]);
    // Two rectangles: their plots together, each once.
    expect([...selectInAreas(m, all(m), [{ south: 0, west: 0, north: 2.5, east: 2.5 }, { south: 1.5, west: 1.5, north: 3.5, east: 3.5 }])]).toEqual([0, 1, 2]);
    // Statuses hidden in the legend are not selected.
    const notStarted = shownIndexes(m, new Set(["notStarted"]));
    expect([...selectInAreas(m, notStarted, [{ south: 0, west: 0, north: 10, east: 10 }])].map((i) => m.plots[i])).toEqual(["1", "2", "3", "5", "6", "8"]);
    // Longitude 170 drawn on the copy of the world to the west (-190) or across the date line.
    expect(inAreas(50, 170, [{ south: 40, west: -195, north: 60, east: -185 }])).toBe(true);
    expect(inAreas(50, 170, [{ south: 40, west: 160, north: 60, east: 200 }])).toBe(true);
    expect(inAreas(50, 170, [{ south: 40, west: -170, north: 60, east: -160 }])).toBe(false);
    expect(inAreas(50, 170, [{ south: 40, west: -400, north: 60, east: 0 }])).toBe(true);
  });

  it("tells what can be given and why the rest cannot", () => {
    const m = map();
    const s = summarizeSelection(m, all(m));
    expect(s.total).toBe(9);
    expect(s.toAssess).toBe(8);
    expect(s.movable).toBe(4);
    expect(s.kept).toEqual({ submitted: 1, reference: 1, severalFiles: 1, wholeFile: 1, nobody: 1 });
    expect(s.keptTotal).toBe(5);
    expect(s.groups).toEqual([
      { fileId: "d", filename: "divided.csv", holder: "ana", plots: ["1", "3"] },
      { fileId: "d", filename: "divided.csv", holder: "ben", plots: ["2", "3", "9"] },
    ]);
    expect(s.byHolder).toEqual([
      { holder: "ben", plots: 3 },
      { holder: "ana", plots: 2 },
    ]);
    expect(s.byFile).toEqual([{ fileId: "d", filename: "divided.csv", plots: 4 }]);
    // A reviewer's map (no file per plot): nothing can be given.
    const reviewer = { ...m, file: null, reference: null, holders: null };
    expect(summarizeSelection(reviewer, all(m)).movable).toBe(0);
    expect(summarizeSelection(m, new Uint32Array(0))).toMatchObject({ total: 0, toAssess: 0, movable: 0, groups: [], keptTotal: 0 });
  });

  it("gives with one call per plot file and person, not from the person who gets them", () => {
    const m = map();
    const s = summarizeSelection(m, all(m));
    const ids = new Map([["ana", "u-ana"], ["ben", "u-ben"], ["cy", "u-cy"]]);
    const toCy = givePlan(s, "cy", ids);
    expect(toCy.moves).toEqual([
      { fileId: "d", filename: "divided.csv", from: "ana", fromUserId: "u-ana", plots: ["1", "3"] },
      { fileId: "d", filename: "divided.csv", from: "ben", fromUserId: "u-ben", plots: ["2", "3", "9"] },
    ]);
    expect(toCy).toMatchObject({ plots: 4, theirs: 0, unknown: 0, from: ["ana", "ben"] });
    // To ben: plot 3 (ana and ben) comes from ana; 2 and 9 are already his.
    const toBen = givePlan(s, "ben", ids);
    expect(toBen.moves.map((x) => [x.from, x.plots])).toEqual([["ana", ["1", "3"]]]);
    expect(toBen).toMatchObject({ plots: 2, theirs: 2, unknown: 0, from: ["ana"] });
    // Someone no longer in the project: their plots stay.
    const noBen = givePlan(s, "cy", new Map([["ana", "u-ana"]]));
    expect(noBen).toMatchObject({ plots: 2, unknown: 2, theirs: 0 });
  });

  it("sends a large group in parts the server takes", () => {
    const plots = Array.from({ length: MOVE_AT_MOST + 5 }, (_, i) => String(i));
    const plan = givePlan(
      { total: plots.length, toAssess: plots.length, movable: plots.length, groups: [{ fileId: "d", filename: "d.csv", holder: "ana", plots }], byHolder: [], byFile: [], kept: { submitted: 0, reference: 0, severalFiles: 0, wholeFile: 0, nobody: 0 }, keptTotal: 0 },
      "ben",
      new Map([["ana", "u"]]),
    );
    expect(plan.moves.map((x) => x.plots.length)).toEqual([MOVE_AT_MOST, 5]);
    expect(plan.plots).toBe(plots.length);
  });

  it("adds up what the calls did", () => {
    let sum = { moved: 0, notMoved: 0, droppedChecks: 0, done: 0 };
    sum = addResult(sum, { moved: 3, notMoved: 1, droppedChecks: 0 });
    sum = addResult(sum, { moved: 2, notMoved: 0, droppedChecks: 1 });
    expect(sum).toEqual({ moved: 5, notMoved: 1, droppedChecks: 1, done: 2 });
  });
});
