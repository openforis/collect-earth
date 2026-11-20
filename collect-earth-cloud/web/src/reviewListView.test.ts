import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_QUERY, type ReviewListLine } from "./api";
import { translator } from "./i18n";
import { applyTarget, cardSequence, isPicked, kindsText, NO_SELECTION, pageCount, pageOf, pageState, pickedCount, skippedText, toggle, togglePage } from "./reviewListView";

const t = translator("en");
const line = (plot: string, waiting = true, kinds = ["difference"]): ReviewListLine => ({ plot, section: waiting ? "difference" : null, kinds, people: ["ana"], checks: 1, decision: null });

describe("the review list's view", () => {
  it("says why a plot is there, in words", () => {
    expect(kindsText(t, { kinds: ["difference", "very_fast"] })).toBe("Checks that differ, Very fast");
    expect(kindsText(t, { kinds: ["resubmitted", "odd"] })).toBe("Submitted again, odd");
  });

  it("counts the pages", () => {
    expect(pageCount(0, 100)).toBe(1);
    expect(pageCount(250, 100)).toBe(3);
    expect(pageOf(0, 100)).toBe(1);
    expect(pageOf(200, 100)).toBe(3);
  });

  it("picks plots one by one or a page at a time, or all that match", () => {
    let s = toggle(NO_SELECTION, "1");
    expect([...s.plots]).toEqual(["1"]);
    expect(pageState(s, ["1", "2"])).toBe("some");
    s = togglePage(s, ["1", "2"]);
    expect(pageState(s, ["1", "2"])).toBe("all");
    expect(pickedCount(s, 340)).toBe(2);
    // the page's box again: the page is left out
    s = togglePage(s, ["1", "2"]);
    expect(s.plots.size).toBe(0);
    const all = { plots: new Set<string>(), allMatching: true };
    expect(isPicked(all, "9")).toBe(true);
    expect(pickedCount(all, 340)).toBe(340);
    expect(pageState(all, ["1"])).toBe("all");
    // a plot unticked from "all": back to those picked by name
    expect(toggle(all, "9").allMatching).toBe(false);
  });

  it("applies a decision to the plots picked, or to the filters on every page", () => {
    const query = { ...DEFAULT_LIST_QUERY, kind: "difference" as const, q: "12" };
    expect(applyTarget(toggle(NO_SELECTION, "12"), query)).toEqual({ plots: ["12"] });
    expect(applyTarget({ plots: new Set(), allMatching: true }, query)).toEqual({ filter: { state: "waiting", person: null, kind: "difference", q: "12" } });
  });

  it("works through the page's waiting plots from the one clicked on", () => {
    const lines = [line("1"), line("2", false), line("3"), line("4")];
    expect(cardSequence(lines, "3")).toEqual(["3", "4", "1"]);
    expect(cardSequence(lines, "9")).toEqual(["1", "3", "4"]);
  });

  it("says why a plot was skipped", () => {
    expect(skippedText(t, { plot: "7", reason: "no_check" })).toBe("7: it has no check");
    expect(skippedText(t, { plot: "8", reason: "own_plot" })).toBe("8: you answered it (someone else decides it)");
  });
});
