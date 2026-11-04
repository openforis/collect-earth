import { describe, expect, it } from "vitest";
import type { Difference, GuidanceNote, QualityData, QualityDecision, QuestionAgreement } from "./api";
import { translator } from "./i18n";
import {
  barPercent,
  canWriteNote,
  formatRate,
  googleEarthUrl,
  groupDifferences,
  keepLocalChanges,
  labelMap,
  marginKey,
  marginRows,
  marginsToSave,
  parseMargin,
  answerText,
  pollDelay,
  problemMessageKey,
  rateText,
  reloadOnShow,
  splitWeek,
  weekChart,
  weekRateText,
  weekText,
  withDecision,
  withNote,
  withQuestionLabels,
} from "./qualityView";

const question = (key: string, label: string, kind: "choice" | "number", margin: number | null = null): QuestionAgreement => ({
  key,
  label,
  kind,
  compared: 30,
  agreeing: 24,
  rate: 0.8,
  margin,
});

describe("rates as text", () => {
  it("formats a share as a whole percentage in the person's language", () => {
    expect(formatRate(0.82, "en")).toBe("82%");
    expect(formatRate(0.825, "es")).toMatch(/^83\s%$/);
    expect(formatRate(1, "fr")).toMatch(/^100\s%$/);
  });

  it("says how many checks agree, counting checks, not plots", () => {
    expect(rateText(translator("en"), { compared: 50, agreeing: 41, rate: 0.82 }, "en")).toBe("82% agree (41 of 50 checks)");
    expect(rateText(translator("pt"), { compared: 50, agreeing: 41, rate: 0.82 }, "pt")).toMatch(/^82\s?% concordam \(41 de 50 controles\)$/);
  });

  it("says there are too few checks when the rate is null", () => {
    expect(rateText(translator("en"), { compared: 12, agreeing: 12, rate: null }, "en")).toBe("Too few checks to judge (12 checks, 20 needed)");
    expect(rateText(translator("en"), { compared: 1, agreeing: 1, rate: null }, "en")).toBe("Too few checks to judge (1 check, 20 needed)");
    expect(rateText(translator("es"), { compared: 0, agreeing: 0, rate: null }, "es")).toBe("Muy pocos controles para juzgar (0 controles, se necesitan 20)");
    expect(rateText(translator("fr"), { compared: 3, agreeing: 3, rate: null }, "fr")).toBe("Trop peu de contrôles pour juger (3 contrôles, 20 nécessaires)");
    expect(rateText(translator("pt"), { compared: 3, agreeing: 3, rate: null }, "pt")).toBe("Poucos controles para julgar (3 controles, são necessários 20)");
  });

  it("gives a bar only for a rate", () => {
    expect(barPercent({ compared: 50, agreeing: 41, rate: 0.82 })).toBeCloseTo(82);
    expect(barPercent({ compared: 5, agreeing: 5, rate: null })).toBeNull();
  });
});

describe("margins", () => {
  it("keys an indexed entity's question with [*], as the server does", () => {
    expect(marginKey("collect_entity_tree[3].real_height")).toBe("collect_entity_tree[*].real_height");
    expect(marginKey("collect_entity_land_use[F].real_area")).toBe("collect_entity_land_use[F].real_area");
    expect(marginKey("collect_real_x")).toBe("collect_real_x");
  });

  it("shows one margin per question: the ten trees share one, on the first of them", () => {
    const questions = [
      question("collect_code_land_use", "Land use", "choice"),
      question("collect_entity_tree[1].real_height", "Tree 1: Height", "number", 10),
      question("collect_entity_tree[2].real_height", "Tree 2: Height", "number", 10),
      question("collect_real_canopy", "Canopy", "number", 15),
      question("collect_integer_count", "Count", "number"),
    ];
    expect(marginRows(questions, { "collect_entity_tree[*].real_height": 5 })).toEqual([
      { key: "collect_entity_tree[*].real_height", label: "Tree: Height", entity: "Tree", value: 5 },
      { key: "collect_real_canopy", label: "Canopy", entity: null, value: 15 },
      { key: "collect_integer_count", label: "Count", entity: null, value: 10 },
    ]);
  });

  it("saves the margins not on screen too: the server replaces the whole set", () => {
    // A margin saved for a question no longer compared (so not listed) is kept.
    expect(marginsToSave({ collect_real_old: 7, collect_real_canopy: 15 }, { collect_real_canopy: 20, "collect_entity_tree[*].real_height": 5 })).toEqual({
      collect_real_old: 7,
      collect_real_canopy: 20,
      "collect_entity_tree[*].real_height": 5,
    });
  });

  it("reads a typed margin from 0 to 100, with a decimal comma too", () => {
    expect(parseMargin("12,5")).toBe(12.5);
    expect(parseMargin(" 0 ")).toBe(0);
    expect(parseMargin("100")).toBe(100);
    for (const bad of ["", "-1", "101", "abc", "1e2"]) expect(parseMargin(bad), bad).toBeNull();
  });
});

describe("the week chart", () => {
  const box = { width: 300, height: 120, left: 40, right: 10, top: 10, bottom: 10 };

  it("puts the weeks with checks in week order, 0 % at the bottom and 100 % at the top", () => {
    const chart = weekChart(
      [
        { week: "2027-W01", compared: 10, agreeing: 10 },
        { week: "2026-W53", compared: 4, agreeing: 2 },
        { week: "2026-W52", compared: 0, agreeing: 0 },
        { week: "2026-W50", compared: 5, agreeing: 0 },
      ],
      box,
    );
    expect(chart.points.map((p) => [p.week, p.rate, p.x, p.y])).toEqual([
      ["2026-W50", 0, 40, 110],
      ["2026-W53", 0.5, 165, 60],
      ["2027-W01", 1, 290, 10],
    ]);
    // Every week here has fewer than 20 checks: all dashed.
    expect(chart.path).toBe("");
    expect(chart.fewPath).toBe("M40,110 L165,60 M165,60 L290,10");
    expect(chart.ticks).toEqual([
      { value: 0, y: 110 },
      { value: 0.5, y: 60 },
      { value: 1, y: 10 },
    ]);
  });

  it("marks weeks under 20 checks, and dashes the lines that touch them", () => {
    const chart = weekChart(
      [
        { week: "2026-W40", compared: 20, agreeing: 20 },
        { week: "2026-W41", compared: 40, agreeing: 20 },
        { week: "2026-W42", compared: 19, agreeing: 19 },
        { week: "2026-W43", compared: 30, agreeing: 0 },
      ],
      { width: 340, height: 120, left: 40, right: 0, top: 10, bottom: 10 },
    );
    expect(chart.points.map((p) => p.few)).toEqual([false, false, true, false]);
    expect(chart.path).toBe("M40,10 L140,60");
    expect(chart.fewPath).toBe("M140,60 L240,10 M240,10 L340,110");
  });

  it("puts a single week in the middle, and draws nothing without checks", () => {
    expect(weekChart([{ week: "2026-W44", compared: 4, agreeing: 3 }], box).points[0]).toMatchObject({ x: 165, y: 35 });
    expect(weekChart([], box)).toMatchObject({ points: [], path: "", fewPath: "" });
  });

  it("gives every week its share, saying when it has few checks", () => {
    const t = translator("en");
    expect(weekText(t, { week: "2026-W44", compared: 50, agreeing: 41 }, "en")).toBe("Week 44, 2026: 82% agree (41 of 50 checks)");
    expect(weekText(t, { week: "2026-W45", compared: 4, agreeing: 4 }, "en")).toBe("Week 45, 2026: 100% agree (4 of 4 checks, few checks)");
    expect(weekRateText(t, { compared: 10, agreeing: 7 }, "en")).toBe("70% agree (7 of 10 checks, few checks)");
    expect(weekRateText(translator("es"), { compared: 19, agreeing: 19 }, "es")).toMatch(/\(19 de 19 controles, pocos controles\)$/);
    expect(weekRateText(translator("fr"), { compared: 10, agreeing: 7 }, "fr")).toMatch(/\(7 contrôles sur 10, peu de contrôles\)$/);
    expect(weekRateText(translator("pt"), { compared: 10, agreeing: 7 }, "pt")).toMatch(/\(7 de 10 controles, poucos controles\)$/);
  });

  it("names weeks", () => {
    expect(splitWeek("2026-W04")).toEqual({ year: "2026", week: "4" });
    expect(translator("en")("quality.week", splitWeek("2026-W44"))).toBe("Week 44, 2026");
  });
});

describe("the differences", () => {
  it("links a plot to Google Earth on the web, to six decimals (about 10 cm)", () => {
    expect(googleEarthUrl(-12.5, 30.25)).toBe("https://earth.google.com/web/search/-12.500000,30.250000");
    expect(googleEarthUrl(1e-7, 179.1234567)).toBe("https://earth.google.com/web/search/0.000000,179.123457");
  });

  it("can write a note only for a pair of answers: a blank would mean any answer", () => {
    expect(canWriteNote("F", "G")).toBe(true);
    expect(canWriteNote("", "G")).toBe(false);
    expect(canWriteNote("F", "")).toBe(false);
  });

  it("puts a decision in place of the plot's earlier one, or takes it away", () => {
    const decision = (plot: string, kind: "first" | "check"): QualityDecision => ({ plot, decision: kind, comment: null, decidedBy: "x", decidedAt: 1, byAssessor: false });
    const list = [decision("1", "first"), decision("2", "first")];
    expect(withDecision(list, "1", decision("1", "check"))).toEqual([decision("2", "first"), decision("1", "check")]);
    expect(withDecision(list, "2", null)).toEqual([decision("1", "first")]);
  });

  it("keeps the notes in the server's order: by question, then the pair", () => {
    const note = (id: string, questionKey: string, firstValue: string | null): GuidanceNote => ({
      id, questionKey, firstValue, checkValue: null, text: id, updatedBy: null, updatedAt: null,
    });
    const notes = [note("a", "q1", null), note("b", "q2", "F")];
    expect(withNote(notes, note("c", "q1", "G")).map((n) => n.id)).toEqual(["a", "c", "b"]);
    expect(withNote(notes, { ...note("b", "q0", null), text: "changed" }).map((n) => [n.id, n.text])).toEqual([
      ["b", "changed"],
      ["a", "a"],
    ]);
  });

  it("groups the checks of a plot checked twice", () => {
    const d = (plot: string, checker: string): Difference => ({
      plot,
      first: { operator: "ana", recordKey: `${plot},1` },
      check: { operator: checker, recordKey: `${plot},2` },
      fields: [],
    });
    expect(groupDifferences([d("1", "ben"), d("1", "eva"), d("2", "ben")]).map((g) => [g.plot, g.checks.map((c) => c.check.operator)])).toEqual([
      ["1", ["ben", "eva"]],
      ["2", ["ben"]],
    ]);
  });

  it("labels keys by their question, falling back to the key", () => {
    const label = labelMap([question("k", "Land use", "choice")]);
    expect(label("k")).toBe("Land use");
    expect(label("other")).toBe("other");
  });

  it("gives every data problem a sentence", () => {
    const t = translator("en");
    expect(t(problemMessageKey("two_main"), { plot: "3", name: "ana" })).toBe(
      "Plot 3: two people did the first assessment, one of them ana. The latest one is compared.",
    );
    expect(problemMessageKey("something_new")).toBe("quality.problem.other");
  });
});

describe("asking again for newer figures", () => {
  const ask = (over: Partial<Parameters<typeof pollDelay>[0]>) => pollDelay({ stale: false, busy: false, failed: false, hidden: false, round: 0, ...over });

  it("backs off while the figures stay stale: 5, 10, 20, then every 60 seconds", () => {
    expect([0, 1, 2, 3, 4, 10].map((round) => ask({ stale: true, round }))).toEqual([5_000, 10_000, 20_000, 60_000, 60_000, 60_000]);
  });

  it("waits at least the Retry-After of a busy answer", () => {
    expect([0, 1, 2, 3].map((round) => ask({ busy: true, round }))).toEqual([10_000, 10_000, 20_000, 60_000]);
  });

  it("does not ask while the page is hidden, after another error, or when the figures are fresh", () => {
    expect(ask({ stale: true, hidden: true })).toBeNull();
    expect(ask({ stale: true, failed: true })).toBeNull();
    expect(ask({})).toBeNull();
  });
});

describe("asking again when the page is shown", () => {
  it("only for stale or busy figures, or after a minute since the last load", () => {
    expect(reloadOnShow({ stale: true, busy: false, sinceLoad: 0 })).toBe(true);
    expect(reloadOnShow({ stale: false, busy: true, sinceLoad: 0 })).toBe(true);
    expect(reloadOnShow({ stale: false, busy: false, sinceLoad: 59_000 })).toBe(false);
    expect(reloadOnShow({ stale: false, busy: false, sinceLoad: 61_000 })).toBe(true);
  });
});

describe("answers by their label", () => {
  const options = {
    collect_code_land_use: [
      { code: "F", label: "Forest" },
      { code: "C", label: "Cropland" },
      { code: "S", label: "Settlement" },
      { code: "X", label: "" },
    ],
    collect_code_twins: [
      { code: "a", label: "Same" },
      { code: "b", label: "same " },
      { code: "c", label: "Other" },
    ],
    collect_boolean_changed: [
      { code: "true", label: "Yes" },
      { code: "false", label: "No" },
    ],
  };
  const en = translator("en");

  it("shows the option's label, the code when it has none or is not in the list, and (no answer) for a blank", () => {
    expect(answerText(en, "collect_code_land_use", "C", options)).toBe("Cropland");
    expect(answerText(en, "collect_code_land_use", "X", options)).toBe("X");
    expect(answerText(en, "collect_code_land_use", "Q", options)).toBe("Q");
    expect(answerText(en, "collect_code_unknown", "C", options)).toBe("C");
    expect(answerText(en, "collect_code_land_use", "", options)).toBe("(no answer)");
  });

  it("gives several answers each by its label, and the code in brackets only where two options read the same", () => {
    expect(answerText(en, "collect_code_land_use", "F, S", options)).toBe("Forest, Settlement");
    expect(answerText(en, "collect_code_twins", "a", options)).toBe("Same (a)");
    expect(answerText(en, "collect_code_twins", "c", options)).toBe("Other");
  });

  it("says yes and no in the dashboard's language for a yes/no question, also without options", () => {
    expect(answerText(en, "collect_boolean_changed", "true", options)).toBe("Yes");
    expect(answerText(en, "collect_boolean_changed", "false", options)).toBe("No");
    expect(answerText(translator("es"), "collect_boolean_changed", "true", {})).toBe("Sí");
    expect(answerText(translator("fr"), "collect_entity_lu[F].boolean_ok", "false", {})).toBe("Non");
    expect(answerText(translator("pt"), "collect_boolean_changed", "true", {})).toBe("Sim");
    expect(answerText(en, "collect_code_boolean_like", "true", {})).toBe("true");
  });
});

describe("question keys in texts", () => {
  it("are shown as the question's label: exact keys only, longest first, never inside a longer word", () => {
    const labels = new Map([
      ["collect_code_land_use", "Land use"],
      ["collect_code_land_use_category", "Land use category"],
      ["collect_entity_tree[1].real_height", "Tree 1: Height"],
    ]);
    expect(withQuestionLabels("Before you answer collect_code_land_use_category, read collect_code_land_use. Also collect_entity_tree[1].real_height; xcollect_code_land_use", labels)).toBe(
      "Before you answer Land use category, read Land use. Also Tree 1: Height; xcollect_code_land_use",
    );
    expect(withQuestionLabels("plain", new Map())).toBe("plain");
  });
});

describe("a load that started before a change made here", () => {
  const prev = { decisions: ["mine"], notes: ["mine"], margins: { a: 1 }, plotsChecked: 1 } as unknown as QualityData;
  const fresh = { decisions: [], notes: [], margins: {}, plotsChecked: 2 } as unknown as QualityData;

  it("keeps the decisions, notes and margins changed here, and takes the rest", () => {
    expect(keepLocalChanges(fresh, prev)).toEqual({ decisions: ["mine"], notes: ["mine"], margins: { a: 1 }, plotsChecked: 2 });
  });
});
