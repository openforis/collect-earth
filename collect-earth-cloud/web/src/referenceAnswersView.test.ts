import { describe, expect, it } from "vitest";
import { toReferenceView } from "./api";
import { translator } from "./i18n";
import { aboveHalf, disagreementText, mostDiffering, overallRate } from "./referenceView";

const t = translator("en");

describe("reference answers from a file", () => {
  it("reads the set and the figures against it; reviewers get no people", () => {
    const view = toReferenceView({
      coordinator: true,
      external: { count: 3, uploadedAt: 7 },
      figures: {
        plots: 0,
        external: {
          plots: 3,
          assessed: 2,
          checks: 4,
          questions: [{ key: "q", label: "Q", kind: "choice", compared: 4, agreeing: 1, rate: null }],
          people: [{ username: "ben", answers: { compared: 30, agreeing: 10, rate: 1 / 3 }, plots: { compared: 3, agreeing: 0, rate: null }, questions: [] }],
          byPlot: [{ plot: "1", records: 2, compared: 2, agreeing: 0 }],
        },
      },
    });
    expect(view.external).toEqual({ count: 3, uploadedAt: 7 });
    expect(view.figures?.external?.people[0].answers.rate).toBeCloseTo(1 / 3);
    expect(view.figures?.external?.byPlot).toEqual([{ plot: "1", records: 2, compared: 2, agreeing: 0 }]);
    expect(toReferenceView({ figures: { external: { plots: 1, questions: [] } } }).figures?.external?.people).toEqual([]);
    expect(toReferenceView({ figures: {} }).figures?.external).toBeNull();
    expect(toReferenceView({}).external).toEqual({ count: 0, uploadedAt: null });
  });

  it("says how much differs, flags above half, and lists the plots that differ most", () => {
    expect(disagreementText(t, { compared: 30, agreeing: 10, rate: 1 / 3 }, "en")).toBe("67% differ from the reference (20 of 30 answers)");
    expect(disagreementText(t, { compared: 4, agreeing: 1, rate: null }, "en")).toBe("Too few answers to judge (4 answers, 20 needed)");
    expect(aboveHalf({ compared: 30, agreeing: 10, rate: 1 / 3 })).toBe(true);
    expect(aboveHalf({ compared: 30, agreeing: 15, rate: 0.5 })).toBe(false);
    expect(aboveHalf({ compared: 4, agreeing: 0, rate: null })).toBe(false);
    expect(overallRate([{ compared: 15, agreeing: 10, rate: null }, { compared: 10, agreeing: 0, rate: null }])).toEqual({ compared: 25, agreeing: 10, rate: 0.4 });
    const plots = [
      { plot: "1", records: 1, compared: 2, agreeing: 2 },
      { plot: "2", records: 1, compared: 2, agreeing: 0 },
      { plot: "3", records: 1, compared: 4, agreeing: 2 },
    ];
    expect(mostDiffering(plots, 5).map((p) => p.plot)).toEqual(["2", "3"]);
  });
});
