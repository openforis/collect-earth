import { describe, expect, it } from "vitest";
import type { Difference, QuestionAgreement } from "./api";
import { translator } from "./i18n";
import {
  barPercent,
  formatRate,
  googleEarthUrl,
  groupDifferences,
  labelMap,
  marginKey,
  marginRows,
  parseMargin,
  problemMessageKey,
  rateText,
  splitWeek,
  weekChart,
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
    expect(rateText(translator("en"), { compared: 12, agreeing: 12, rate: null }, "en")).toBe("Too few checks to judge (12 of 20)");
    expect(rateText(translator("es"), { compared: 0, agreeing: 0, rate: null }, "es")).toBe("Muy pocos controles para juzgar (0 de 20)");
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
    expect(chart.path).toBe("M40,110 L165,60 L290,10");
    expect(chart.ticks).toEqual([
      { value: 0, y: 110 },
      { value: 0.5, y: 60 },
      { value: 1, y: 10 },
    ]);
  });

  it("puts a single week in the middle, and draws nothing without checks", () => {
    expect(weekChart([{ week: "2026-W44", compared: 4, agreeing: 3 }], box).points[0]).toMatchObject({ x: 165, y: 35 });
    expect(weekChart([], box)).toMatchObject({ points: [], path: "" });
  });

  it("names weeks", () => {
    expect(splitWeek("2026-W04")).toEqual({ year: "2026", week: "4" });
    expect(translator("en")("quality.week", splitWeek("2026-W44"))).toBe("Week 44, 2026");
  });
});

describe("the differences", () => {
  it("links a plot to Google Earth on the web", () => {
    expect(googleEarthUrl(-12.5, 30.25)).toBe("https://earth.google.com/web/search/-12.5,30.25");
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
