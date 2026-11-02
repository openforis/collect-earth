import { describe, expect, it } from "vitest";
import { toSurveyHealth, type HealthRow, type SurveyHealthData } from "./api";
import { agreementText, changedText, emptyText, orderText, otherText, reasonText } from "./healthView";
import { CATALOGUES, translator } from "./i18n";

const t = translator("en");

const row = (extra: Partial<HealthRow> = {}): HealthRow => ({
  key: "collect_code_land_use",
  label: "Land use",
  kind: "choice",
  calculated: false,
  required: true,
  answered: 26,
  blank: 8,
  notKnown: 6,
  nonNumeric: 0,
  emptyShare: 8 / 34,
  other: { count: 6, share: 6 / 26, answers: [{ code: "O", label: "Other (specify)", count: 6 }] },
  agreement: { compared: 25, agreeing: 13, rate: 13 / 25 },
  decisions: { changed: 3, share: 3 / 4 },
  reasons: ["low_agreement", "often_other", "often_empty"],
  ...extra,
});

const data = (extra: Partial<SurveyHealthData> = {}): SurveyHealthData => ({
  plots: 40,
  plotsChecked: 25,
  decidedForCheck: 4,
  questions: [row()],
  questionsTotal: 1,
  thresholds: { minPlots: 20, lowAgreement: 0.8, oftenOther: 0.1, oftenEmpty: 0.2, minChanged: 5, oftenChanged: 0.25 },
  computedAt: 1,
  stale: false,
  ...extra,
});

describe("healthView", () => {
  it("each reason in a sentence, from the figures", () => {
    const r = row();
    const d = data();
    expect(reasonText(t, "low_agreement", r, d, "en")).toBe("The checks agree on only 52% of 25 plots (under 80%).");
    expect(reasonText(t, "often_other", r, d, "en")).toBe("23% of the plots answering it choose Other (specify).");
    expect(reasonText(t, "often_empty", r, d, "en")).toBe("Left empty on 24% of the plots where this is known.");
    expect(reasonText(t, "often_changed", r, d, "en")).toBe("A decision took the check's answer, which differs here, on 3 of the 4 plots decided for the check.");
  });

  it("the cells: shares with their counts, too few plots, not known, nothing", () => {
    expect(emptyText(t, row(), "en")).toBe("24% (8 of 34) · 6 not known");
    expect(emptyText(t, row({ emptyShare: null, answered: 5, blank: 2, notKnown: 0 }), "en")).toBe("Too few plots to judge (2 of 7)");
    expect(emptyText(t, row({ answered: 0, blank: 0, emptyShare: null, notKnown: 40 }), "en")).toBe("— · 40 not known");
    expect(otherText(t, row(), "en")).toBe("23% (6 of 26): Other (specify)");
    expect(otherText(t, row({ other: { count: 0, share: 0, answers: [] } }), "en")).toBe("0 of 26");
    expect(otherText(t, row({ kind: "number", other: null }), "en")).toBe("");
    expect(agreementText(t, row(), "en")).toBe("52% (13 of 25 checks)");
    expect(agreementText(t, row({ agreement: { compared: 12, agreeing: 5, rate: null } }), "en")).toBe("Too few checks to judge (5 of 12)");
    expect(agreementText(t, row({ agreement: null }), "en")).toBe("—");
    expect(changedText(t, row(), data(), "en")).toBe("3 of 4 plots");
    expect(changedText(t, row(), data({ decidedForCheck: 0 }), "en")).toBe("—");
  });

  it("the order says the thresholds the server used, in every language", () => {
    expect(orderText(t, data(), "en")).toContain("under 80% of the plots");
    for (const language of Object.keys(CATALOGUES)) {
      const text = orderText(translator(language), data(), language);
      expect(text, language).not.toMatch(/\{\w+\}/);
      for (const r of row().reasons) expect(reasonText(translator(language), r, row(), data(), language), language).not.toMatch(/\{\w+\}/);
    }
  });

  it("reads the server's answer, leaving out what it does not know", () => {
    const d = toSurveyHealth({
      plots: 40,
      plotsChecked: 25,
      decidedForCheck: 4,
      questionsTotal: 2,
      questions: [
        { ...row(), reasons: ["low_agreement", "made_up"] },
        { key: "collect_real_canopy", label: "", kind: "number", answered: 39, blank: 0, notKnown: 0, nonNumeric: 1, emptyShare: 0, other: null, agreement: null, decisions: { changed: 0, share: null }, reasons: [] },
      ],
      thresholds: { minPlots: 20, lowAgreement: 0.8, oftenOther: 0.1, oftenEmpty: 0.2, minChanged: 5, oftenChanged: 0.25 },
      computedAt: 5,
      stale: true,
    });
    expect(d.questions[0].reasons).toEqual(["low_agreement"]);
    expect(d.questions[1]).toMatchObject({ label: "collect_real_canopy", kind: "number", other: null, agreement: null, calculated: false });
    expect(d).toMatchObject({ plots: 40, decidedForCheck: 4, computedAt: 5, stale: true });
    expect(toSurveyHealth({}).thresholds.lowAgreement).toBe(0.8);
  });
});
