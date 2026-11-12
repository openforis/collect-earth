import { describe, expect, it } from "vitest";
import type { DistributionState, Member, PersonShare } from "./api";
import { translator } from "./i18n";
import {
  holdersOf,
  initialShareForm,
  moveLines,
  paceText,
  pacesOf,
  percentSum,
  planRows,
  shareCandidates,
  sharedText,
  shareRequest,
  toggleChosen,
  type ShareForm,
} from "./rebalanceView";

const t = translator("en");
const members: Member[] = [
  { userId: "c", username: "coord", role: "admin" },
  { userId: "b", username: "bo", role: "operator" },
  { userId: "a", username: "ana", role: "operator" },
  { userId: "d", username: "dee", role: "operator", disabled: true },
  { userId: "e", username: "eli", role: "reviewer" },
];
const share = (userId: string, plots: number, submitted: number): PersonShare => ({
  userId,
  username: userId,
  plots,
  overlap: 0,
  sampled: 0,
  reference: 0,
  submitted,
});
const state = (people: PersonShare[]): DistributionState => ({
  distribution: { mode: "manual", groups: [] } as unknown as DistributionState["distribution"],
  plotCount: 100,
  unassigned: 0,
  people,
});

describe("who shares the plots left", () => {
  it("lists the collectors and anyone holding plots, a coordinator too, coordinators last", () => {
    const s = state([share("a", 10, 2), share("c", 5, 0), share("x", 0, 0)]);
    expect(holdersOf(s)).toEqual(["a", "c"]);
    expect(shareCandidates(members, s).map((m) => m.userId)).toEqual(["a", "b", "d", "e", "c"]);
    expect(shareCandidates(members, state([share("a", 1, 0)])).map((m) => m.userId)).toEqual(["a", "b", "d", "e"]);
  });

  it("ticks those with plots still to do (not a turned-off account), else the collectors", () => {
    const s = state([share("b", 10, 2), share("a", 4, 4), share("d", 6, 0), share("c", 3, 0)]);
    expect(initialShareForm(members, s)).toEqual({ how: "equal", chosen: ["b", "c"], percents: {} });
    expect(initialShareForm(members, state([])).chosen).toEqual(["a", "b", "e"]);
    expect(toggleChosen(toggleChosen({ how: "equal", chosen: ["a"], percents: {} }, "a"), "b").chosen).toEqual(["b"]);
  });
});

describe("the request", () => {
  const form = (how: ShareForm["how"], chosen: string[], percents: Record<string, string> = {}): ShareForm => ({ how, chosen, percents });

  it("equally: weight 1 each; a holder not ticked gives all away (0)", () => {
    expect(shareRequest(form("equal", ["a", "b"]), ["a", "c"])).toEqual({
      people: [
        { userId: "a", weight: 1 },
        { userId: "b", weight: 1 },
        { userId: "c", weight: 0 },
      ],
      problem: null,
    });
    // one person ticked takes everything of the others
    expect(shareRequest(form("equal", ["b"]), ["a", "b"]).people).toEqual([
      { userId: "b", weight: 1 },
      { userId: "a", weight: 0 },
    ]);
  });

  it("needs someone ticked and two people in all", () => {
    expect(shareRequest(form("equal", []), ["a", "b"]).problem).toBe("divide.move.shareProblemNobody");
    expect(shareRequest(form("equal", ["a"]), ["a"]).problem).toBe("divide.move.shareProblemTwo");
  });

  it("by percentage: whole numbers from 0 to 100 making 100", () => {
    const f = form("percent", ["a", "b"], { a: "70", b: " 30" });
    expect(percentSum(f)).toBe(100);
    expect(shareRequest(f, []).people).toEqual([
      { userId: "a", weight: 70 },
      { userId: "b", weight: 30 },
    ]);
    expect(shareRequest(form("percent", ["a", "b"], { a: "100", b: "0" }), []).people?.[1]).toEqual({ userId: "b", weight: 0 });
    expect(shareRequest(form("percent", ["a", "b"], { a: "60", b: "30" }), []).problem).toBe("divide.problemPercents");
    expect(shareRequest(form("percent", ["a", "b"], { a: "60.5", b: "39.5" }), []).problem).toBe("divide.problemPercents");
    expect(shareRequest(form("percent", ["a", "b"], { a: "100" }), []).problem).toBe("divide.problemPercents");
    expect(percentSum(form("percent", ["a", "b"], { a: "40", b: "x" }))).toBe(40);
  });

  it("by pace: plots of the last 7 days a day; without any, the middle pace of the others", () => {
    const rows = [
      { userId: "a", submittedLast7: 70 },
      { userId: "b", submittedLast7: 14 },
      { userId: "c", submittedLast7: 0 },
      { userId: "e", submittedLast7: 35 },
    ];
    const paces = pacesOf(["a", "b", "c"], rows)!;
    expect(paces.get("a")).toEqual({ perDay: 10, used: 10, guessed: false });
    expect(paces.get("c")).toEqual({ perDay: null, used: 6, guessed: true });
    expect(shareRequest(form("pace", ["a", "b", "c"]), ["a", "d"], paces).people).toEqual([
      { userId: "a", weight: 10 },
      { userId: "b", weight: 2 },
      { userId: "c", weight: 6 },
      { userId: "d", weight: 0 },
    ]);
    expect(pacesOf(["c", "x"], rows)).toBeNull();
    expect(shareRequest(form("pace", ["c", "x"]), [], null).problem).toBe("divide.move.shareProblemNoPace");
    expect(paceText(t, paces.get("b"), "en")).toBe("2 plots a day (last 7 days)");
    expect(paceText(t, paces.get("c"), "en")).toBe("No plots in the last 7 days: counted at the middle pace of the others, 6 plots a day");
  });
});

describe("the plan in words", () => {
  const names = new Map([
    ["a", "ana"],
    ["b", "bo"],
    ["c", "coord"],
  ]);
  const plan = { left: { b: 30, a: 0, c: 6 }, target: { b: 18, a: 18, c: 0 }, moves: [{ from: "b", to: "a", count: 12 }, { from: "c", to: "a", count: 1 }, { from: "c", to: "a", count: 0 }] };

  it("a row per person, before and after, in the list's order", () => {
    expect(planRows(plan, names, ["a", "b", "c"])).toEqual([
      { userId: "a", name: "ana", before: 0, after: 18 },
      { userId: "b", name: "bo", before: 30, after: 18 },
      { userId: "c", name: "coord", before: 6, after: 0 },
    ]);
  });

  it("who gives how many to whom, and what Apply did", () => {
    expect(moveLines(t, plan, names, "en")).toEqual(["bo gives 12 plots to ana", "coord gives 1 plot to ana"]);
    expect(sharedText(t, { moved: 1200, notMoved: 0 }, "en")).toMatch(/^Plots moved: 1,200\. Collectors get/);
    expect(sharedText(t, { moved: 10, notMoved: 3 }, "en")).toMatch(/Kept where they were: 3 \(plots that the person taking them already assessed or checked/);
  });
});
