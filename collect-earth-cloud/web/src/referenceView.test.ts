import { describe, expect, it } from "vitest";
import { toPersonData, toPlotPage, toReferenceView, toSamplingView } from "./api";
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
      for (const language of ["en", "es", "fr", "pt"] as const) expect(CATALOGUES[language][key!], `${language} ${key}`).toBeTruthy();
    }
    expect(refusalKey("other")).toBeNull();
  });

  it("lists the lowest accuracy first, too few plots last; the weakest questions", () => {
    const view = toReferenceView({
      coordinator: true,
      count: 2,
      figures: {
        plots: 2,
        assessed: 2,
        checks: 3,
        questions: [{ key: "q", label: "Land use", kind: "choice", compared: 3, agreeing: 2, rate: null }],
        people: [
          { username: "zoe", plots: { compared: 25, agreeing: 20, rate: 0.8 }, questions: [] },
          { username: "ana", plots: { compared: 5, agreeing: 5, rate: null }, questions: [] },
          {
            username: "ben",
            plots: { compared: 30, agreeing: 15, rate: 0.5 },
            questions: [
              { key: "a", compared: 30, agreeing: 30, rate: 1 },
              { key: "b", compared: 30, agreeing: 20, rate: 0.667 },
              { key: "c", compared: 30, agreeing: 15, rate: 0.5 },
              { key: "d", compared: 4, agreeing: 1, rate: null },
            ],
          },
        ],
        computedAt: 5,
        stale: false,
      },
      plots: [{ csvFileId: "f", filename: "north.csv", plot: "1", assessor: "coord", assessorUserId: "u", addedAt: 1, assessed: true, copies: 3, checked: 2 }],
    });
    expect(sortedPeople(view.figures!).map((p) => p.username)).toEqual(["ben", "zoe", "ana"]);
    expect(weakestQuestions(view.figures!.people[2]).map((q) => q.key)).toEqual(["c", "b", "d"]);
    expect(view.plots[0]).toMatchObject({ plot: "1", assessorInProject: true, copies: 3, checked: 2 });
    expect(view.max).toBe(500);
    // A reviewer's answer: no plots, no files.
    expect(toReferenceView({ coordinator: false, count: 2, figures: null })).toMatchObject({ coordinator: false, count: 2, plots: [], files: [], figures: null });
  });

  it("reads the person page's accuracy, the plot page's reference and the reference copies of the Checks section", () => {
    expect(toPlotPage({ plot: "1", reference: { assessor: "coord" } }).reference).toEqual({ assessor: "coord" });
    expect(toPlotPage({ plot: "1", reference: {} }).reference).toEqual({ assessor: null });
    expect(toPlotPage({ plot: "1", reference: null }).reference).toBeNull();
    expect(toSamplingView({ files: [{ csvFileId: "f", referenceCopies: 6 }] }).files[0].referenceCopies).toBe(6);
    const person = toPersonData({ person: { userId: "u" }, quality: { reference: { username: "ana", plots: { compared: 3, agreeing: 2, rate: null }, questions: [] } } });
    expect(person.quality.reference).toEqual({ username: "ana", plots: { compared: 3, agreeing: 2, rate: null }, questions: [] });
    expect(toPersonData({ person: { userId: "u" }, quality: { reference: null } }).quality.reference).toBeNull();
    // No reference plot in the project: no line at all.
    expect(toPersonData({ person: { userId: "u" }, quality: {} }).quality.reference).toBeUndefined();
    expect(toPersonData({ person: { userId: "u" }, plots: [] }).quality).toBeDefined();
  });
});
