import { describe, expect, it } from "vitest";
import { toFlagsData, type PatternFlag } from "./api";
import { countsText, flagText, gapText, parseSeconds, totalOf } from "./flagsView";
import { CATALOGUES, translator } from "./i18n";

const t = translator("en");

const flag = (extra: Partial<PatternFlag>): PatternFlag => ({
  kind: "very_fast",
  plot: "12",
  operator: "ana",
  at: Date.UTC(2026, 10, 2, 9),
  gapMs: null,
  previousPlot: null,
  runLength: null,
  firstPlot: null,
  questions: [],
  decision: null,
  decidedAt: null,
  ...extra,
});

describe("flagsView", () => {
  it("each kind's sentence, from the figures", () => {
    expect(flagText(t, flag({ gapMs: 8_400, previousPlot: "11" }), "en")).toBe("Submitted 8.4 s after their previous plot (11).");
    expect(flagText(t, flag({ kind: "same_as_before", previousPlot: "11", runLength: 4, firstPlot: "9" }), "en")).toBe(
      "Every answer is the same as on their previous plot (11): 4 plots in a row from plot 9.",
    );
    expect(flagText(t, flag({ kind: "required_empty", questions: [{ key: "a", label: "Land use" }, { key: "b", label: "Slope" }] }), "en")).toBe("Left empty: Land use, Slope.");
    expect(flagText(t, flag({ kind: "edited_after_decision", decision: "first", decidedAt: Date.UTC(2026, 10, 1, 9) }), "en")).toMatch(/^Saved again on .+, after the decision of .+\.$/);
    expect(flagText(t, flag({ kind: "two_main" }), "en")).toBe("The plot has more than one first assessment.");
    expect(flagText(t, flag({ kind: "no_plot" }), "en")).toBe("The plot is in none of the plot files.");
  });

  it("no sentence names a person or says a plot is a quality check, in any language", () => {
    for (const language of Object.keys(CATALOGUES)) {
      const tr = translator(language);
      const flags = [
        flag({ gapMs: 1000, previousPlot: "1" }),
        flag({ kind: "same_as_before", previousPlot: "1", runLength: 3, firstPlot: "1" }),
        flag({ kind: "required_empty", questions: [{ key: "a", label: "A" }] }),
        flag({ kind: "edited_after_decision", decision: "check", decidedAt: 1 }),
        flag({ kind: "two_main" }),
        flag({ kind: "no_plot" }),
      ];
      for (const f of flags) {
        const text = flagText(tr, f, language);
        expect(text).not.toContain("ana");
        expect(text.toLowerCase()).not.toMatch(/check|control|contrôle|verifica/);
      }
    }
  });

  it("gaps, counts and the threshold field", () => {
    expect(gapText(t, 400, "en")).toBe("0.4 s");
    expect(gapText(t, 14_600, "en")).toBe("15 s");
    const counts = { very_fast: 3, same_as_before: 0, required_empty: 1, edited_after_decision: 0, two_main: 0, no_plot: 2 };
    expect(countsText(t, counts, "en")).toBe("Very fast: 3 · Required answer left empty: 1 · In no plot file: 2");
    expect(totalOf(counts)).toBe(6);
    expect(parseSeconds(" 20 ", 1, 120)).toBe(20);
    for (const bad of ["0", "121", "2.5", "", "abc", "-3"]) expect(parseSeconds(bad, 1, 120)).toBeNull();
  });

  it("reads the server's answer, leaving out kinds it does not know", () => {
    const data = toFlagsData({
      fastSeconds: 20,
      plots: 4,
      counts: { very_fast: 1 },
      people: [{ username: "ana", counts: { very_fast: 1 }, total: 1 }],
      total: 1,
      flags: [
        { kind: "very_fast", plot: "2", operator: "ana", at: 5, details: { gapMs: 1000, previousPlot: "1" } },
        { kind: "something_new", plot: "3", operator: "ana", at: 6, details: {} },
      ],
      requiredQuestions: 2,
      computedAt: 7,
      stale: true,
    });
    expect(data.flags).toHaveLength(1);
    expect(data.flags[0]).toMatchObject({ kind: "very_fast", gapMs: 1000, previousPlot: "1", questions: [] });
    expect(data.counts).toEqual({ very_fast: 1, same_as_before: 0, required_empty: 0, edited_after_decision: 0, two_main: 0, no_plot: 0 });
    expect(data).toMatchObject({ fastSeconds: 20, stale: true, requiredQuestions: 2 });
  });
});
