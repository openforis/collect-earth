import { describe, expect, it } from "vitest";
import type { ReferenceFiguresAnswer } from "./api";
import { CATALOGUES, translator } from "./i18n";
import { accuracyText, parsePlotIds, refusalKey, sortedPeople, weakestQuestions } from "./referenceView";

const t = translator("en");

describe("the Reference plots section", () => {
  it("reads plot ids one per line, from a pasted column, without repeats; commas stay inside an id", () => {
    expect(parsePlotIds(" 12\r\n\r\n13\n12\t14; 15 ")).toEqual(["12", "13", "14", "15"]);
    expect(parsePlotIds("12,3\n12,4")).toEqual(["12,3", "12,4"]);
    expect(parsePlotIds("   ")).toEqual([]);
  });

  it("says the accuracy, or that there are too few plots to judge", () => {
    expect(accuracyText(t, { compared: 20, agreeing: 15, rate: 0.75 }, "en")).toBe("75% match the reference (15 of 20 plots)");
    expect(accuracyText(t, { compared: 12, agreeing: 12, rate: null }, "en")).toBe("Too few plots to judge (12 plots, 20 needed)");
    expect(accuracyText(t, { compared: 1, agreeing: 1, rate: null }, "en")).toBe("Too few plots to judge (1 plot, 20 needed)");
  });

  it("has a text for every refusal the server gives", () => {
    for (const code of ["whole_file", "unknown_plots", "not_a_plot", "in_other_file", "assessed_by_others", "too_many", "bad_assessor", "none_free"]) {
      const key = refusalKey(code);
      expect(key, code).not.toBeNull();
      for (const language of ["en", "es", "fr", "pt", "tr"] as const) expect(CATALOGUES[language][key!], `${language} ${key}`).toBeTruthy();
    }
    expect(refusalKey("other")).toBeNull();
  });

  it("lists the lowest accuracy first, too few plots last; the weakest questions", () => {
    const figures: ReferenceFiguresAnswer = {
      plots: 2,
      assessed: 2,
      checks: 3,
      questions: [{ key: "q", label: "Land use", kind: "choice", compared: 3, agreeing: 2, rate: null }],
      byPlot: [{ plot: "1", assessor: "coord", assessed: true, checks: 3 }],
      people: [
        { username: "zoe", plots: { compared: 25, agreeing: 20, rate: 0.8 }, questions: [] },
        { username: "ana", plots: { compared: 5, agreeing: 5, rate: null }, questions: [] },
        {
          username: "ben",
          plots: { compared: 30, agreeing: 15, rate: 0.5 },
          questions: [
            { key: "a", label: "A", compared: 30, agreeing: 30, rate: 1 },
            { key: "b", label: "B", compared: 30, agreeing: 20, rate: 0.667 },
            { key: "c", label: "C", compared: 30, agreeing: 15, rate: 0.5 },
            { key: "d", label: "D", compared: 4, agreeing: 1, rate: null },
          ],
        },
      ],
      computedAt: 5,
      stale: false,
    };
    expect(sortedPeople(figures).map((p) => p.username)).toEqual(["ben", "zoe", "ana"]);
    expect(weakestQuestions(figures.people![2]).map((q) => q.key)).toEqual(["c", "b", "d"]);
    // A reviewer's figures name nobody.
    expect(sortedPeople({ ...figures, people: undefined })).toEqual([]);
  });
});
