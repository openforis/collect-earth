import { describe, expect, it } from "vitest";
import type { FlagDetails, FlagKind, PatternFlag } from "./api";
import { countsText, flagSaysMore, flagText, gapText, parseSeconds, totalOf } from "./flagsView";
import { CATALOGUES, translator } from "./i18n";

const t = translator("en");

const flag = (kind: FlagKind, details: FlagDetails = { recordKey: "12" }): PatternFlag => ({
  kind,
  plot: "12",
  operator: "ana",
  at: Date.UTC(2026, 10, 2, 9),
  details,
});

describe("flagsView", () => {
  it("a sentence that only repeats the kind is not shown", () => {
    expect(flagSaysMore("two_main")).toBe(false);
    expect(flagSaysMore("no_plot")).toBe(false);
    expect(flagSaysMore("very_fast")).toBe(true);
  });
  it("each kind's sentence, from the figures", () => {
    expect(flagText(t, flag("very_fast", { gapMs: 8_400, previousPlot: "11" }), "en")).toBe("Submitted 8.4 s after their previous plot (11).");
    expect(flagText(t, flag("same_as_before", { previousPlot: "11", runLength: 4, firstPlot: "9", answers: 5 }), "en")).toBe(
      "Every answer is the same as on their previous plot (11): 4 plots in a row from plot 9.",
    );
    // A plot the viewer may not see is not named (null from the server, Decision 10).
    expect(flagText(t, flag("very_fast", { gapMs: 8_400, previousPlot: null }), "en")).toBe("Submitted 8.4 s after their previous plot.");
    expect(flagText(t, flag("same_as_before", { previousPlot: "11", runLength: 4, firstPlot: null, answers: 5 }), "en")).toBe(
      "Every answer is the same as on their previous plot: 4 plots in a row.",
    );
    expect(flagText(t, flag("required_empty", { questions: [{ key: "a", label: "Land use" }, { key: "b", label: "Slope" }] }), "en")).toBe("Left empty: Land use, Slope.");
    // One question or several (Spanish says it apart).
    const es = translator("es");
    expect(flagText(es, flag("required_empty", { questions: [{ key: "a", label: "Uso" }] }), "es")).toBe("Vacía: Uso.");
    expect(flagText(es, flag("required_empty", { questions: [{ key: "a", label: "Uso" }, { key: "b", label: "Pendiente" }] }), "es")).toBe("Vacías: Uso, Pendiente.");
    expect(flagText(t, flag("edited_after_decision", { decision: "first", decidedAt: Date.UTC(2026, 10, 1, 9) }), "en")).toMatch(/^Saved again on .+, after the decision of .+\.$/);
    expect(flagText(t, flag("two_main"), "en")).toBe("The plot has more than one first assessment.");
    expect(flagText(t, flag("no_plot"), "en")).toBe("The plot is in none of the plot files.");
  });

  it("no sentence names a person or says a plot is a quality check, in any language", () => {
    for (const language of Object.keys(CATALOGUES)) {
      const tr = translator(language);
      const flags = [
        flag("very_fast", { gapMs: 1000, previousPlot: "1" }),
        flag("same_as_before", { previousPlot: "1", runLength: 3, firstPlot: "1", answers: 3 }),
        flag("required_empty", { questions: [{ key: "a", label: "A" }] }),
        flag("edited_after_decision", { decision: "check", decidedAt: 1 }),
        flag("two_main"),
        flag("no_plot"),
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
});
