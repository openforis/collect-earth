import { describe, expect, it } from "vitest";
import { answerRows, foundMessage, hasCheck, matchLabel, recordKindKey, recordStateKey, shownMatches } from "./plotView";

const record = (answers: Record<string, string>, extra: { deleted?: boolean; submitted?: boolean; assessment?: "main" | "check" | "other" } = {}) => ({
  answers,
  deleted: extra.deleted ?? false,
  submitted: extra.submitted ?? true,
  assessment: extra.assessment ?? "main",
});

describe("the plot page", () => {
  it("names a found plot by its id, with the collector's id when it is another", () => {
    expect(matchLabel({ plot: "17", name: "17" })).toBe("17");
    expect(matchLabel({ plot: "17,2025", name: "17" })).toBe("17,2025 (17)");
  });

  it("says what each record is and its state", () => {
    expect(recordKindKey("main")).toBe("plot.record.main");
    expect(recordKindKey("check")).toBe("plot.record.check");
    expect(recordKindKey("other")).toBe("plot.record.other");
    expect(recordStateKey({ submitted: true, deleted: false })).toBe("plot.submitted");
    expect(recordStateKey({ submitted: false, deleted: false })).toBe("plot.draft");
    expect(recordStateKey({ submitted: true, deleted: true })).toBe("plot.deleted");
  });

  it("lays the answers out per question and record, marking those that differ", () => {
    const questions = [
      { key: "lu", label: "Land use" },
      { key: "canopy", label: "Canopy" },
      { key: "notes", label: "Notes" },
      { key: "slope", label: "Slope" },
    ];
    const rows = answerRows(questions, [
      record({ lu: "F", canopy: "50", notes: "" }),
      record({ lu: "G", canopy: "50", notes: "" }),
      record({ lu: "C", slope: "steep" }, { deleted: true }),
    ]);
    expect(rows).toEqual([
      { key: "lu", label: "Land use", values: ["F", "G", null], differs: true },
      { key: "canopy", label: "Canopy", values: ["50", "50", null], differs: false },
    ]);
    // A blank against an answer differs.
    expect(answerRows(questions, [record({ lu: "F" }), record({ lu: "" }, { assessment: "check" })])[0]).toMatchObject({ differs: true, values: ["F", ""] });
    // Only the first assessments and the checks are compared: a record of another round does not shade the row.
    expect(answerRows(questions, [record({ lu: "F" }), record({ lu: "F" }, { assessment: "check" }), record({ lu: "C" }, { assessment: "other" })])[0]).toMatchObject({ differs: false, values: ["F", "F", "C"] });
  });

  it("shows only the matches of what is typed now: Enter never opens an older search's plot", () => {
    const found = { query: "1", result: { plots: [{ plot: "1", name: "1", files: [] }], more: true } };
    expect(shownMatches(found, " 1 ")).toEqual(found.result);
    expect(shownMatches(found, "12")).toEqual({ plots: [], more: false });
    expect(shownMatches(null, "1")).toEqual({ plots: [], more: false });
  });

  it("says how many plots were found, for screen readers", () => {
    expect(foundMessage(0)).toEqual({ key: "plotSearch.foundNone" });
    expect(foundMessage(1)).toEqual({ key: "plotSearch.foundOne" });
    expect(foundMessage(20)).toEqual({ key: "plotSearch.found", n: 20 });
  });

  it("offers \"Check is right\" only with a submitted check", () => {
    expect(hasCheck([record({}), record({}, { assessment: "check", submitted: false })])).toBe(false);
    expect(hasCheck([record({}, { assessment: "check", deleted: true })])).toBe(false);
    expect(hasCheck([record({}), record({}, { assessment: "check" })])).toBe(true);
  });
});
