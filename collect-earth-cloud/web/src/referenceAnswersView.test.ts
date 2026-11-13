import { describe, expect, it } from "vitest";
import { translator } from "./i18n";
import { aboveHalf, disagreementText, mostDiffering, overallRate } from "./referenceView";

const t = translator("en");

describe("reference answers from a file", () => {
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
