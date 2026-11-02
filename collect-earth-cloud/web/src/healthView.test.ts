import { describe, expect, it } from "vitest";
import { toSurveyHealth, type HealthRow, type SurveyHealthData } from "./api";
import { agreementText, changedText, emptyText, noneText, orderText, otherText, reasonText } from "./healthView";
import { CATALOGUES, translator } from "./i18n";

const t = translator("en");

const row = (extra: Partial<HealthRow> = {}): HealthRow => ({
  key: "collect_code_land_use",
  label: "Land use",
  kind: "choice",
  calculated: false,
  required: true,
  conditional: false,
  inGroup: false,
  answered: 26,
  blank: 8,
  nonNumeric: 0,
  emptyBase: 34,
  emptyBlank: 8,
  notKnown: 6,
  emptyShare: 8 / 34,
  emptyWhy: null,
  other: { count: 6, share: 6 / 26, answers: [{ code: "O", label: "Other (specify)", count: 6 }] },
  none: null,
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
    expect(emptyText(t, row(), data(), "en")).toBe("24% (8 of 34) · 6 do not say");
    expect(emptyText(t, row({ emptyShare: null, emptyWhy: "few_records", emptyBase: 7, notKnown: 0 }), data(), "en")).toBe(
      "Not enough records that say what was left empty (7; at least 20 are needed)",
    );
    expect(emptyText(t, row({ emptyShare: null, emptyWhy: "group" }), data(), "en")).toBe("Not known: inside a group of questions, empty answers are not sent");
    expect(emptyText(translator("es"), row(), data(), "es")).toContain("6 sin información");
    expect(noneText(t, row(), "en")).toBe("");
    expect(noneText(t, row({ none: { count: 13, share: 0.5, answers: [{ code: "N", label: "None (no disturbance)", count: 13 }] } }), "en")).toBe(
      "50% (13 of 26): None (no disturbance)",
    );
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
    // The minimum applies to every figure, said once before them.
    expect(orderText(t, data(), "en")).toMatch(/^Order: each figure is judged only with at least 20 plots/);
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
        { ...row(), reasons: ["low_agreement", "made_up"], emptyWhy: "other", conditional: true },
        { key: "collect_real_canopy", label: "", kind: "number", answered: 39, blank: 0, notKnown: 0, nonNumeric: 1, emptyShare: 0, other: null, agreement: null, decisions: { changed: 0, share: null }, reasons: [] },
      ],
      thresholds: { minPlots: 20, lowAgreement: 0.8, oftenOther: 0.1, oftenEmpty: 0.2, minChanged: 5, oftenChanged: 0.25 },
      computedAt: 5,
      stale: true,
    });
    expect(d.questions[0]).toMatchObject({ reasons: ["low_agreement"], emptyWhy: null, conditional: true, none: null });
    expect(d.questions[1]).toMatchObject({ label: "collect_real_canopy", kind: "number", other: null, agreement: null, calculated: false });
    expect(d).toMatchObject({ plots: 40, decidedForCheck: 4, computedAt: 5, stale: true });
    expect(toSurveyHealth({}).thresholds.lowAgreement).toBe(0.8);
  });
});
