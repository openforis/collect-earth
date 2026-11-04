import { describe, expect, it } from "vitest";
import { answerLabel, goldenKeys, kappaText, plotAccuracy, questionAccuracy, readPassMark, shareText } from "./trainingView";

const questions = [
  { key: "lu", label: "Land use", kind: "choice" as const, options: [{ code: "F", label: "Forest" }, { code: "C", label: "" }], multiple: true },
  { key: "cover", label: "Cover", kind: "number" as const, options: null, multiple: false },
];

describe("the Training tab's texts", () => {
  it("shares, kappa and answers as people read them", () => {
    expect(shareText({ compared: 4, agreeing: 3, rate: 0.75 }, "en")).toBe("75%");
    expect(shareText({ compared: 0, agreeing: 0, rate: null }, "en")).toBe("–");
    expect(kappaText(0.4567, "en")).toBe("0.46");
    expect(kappaText(null, "en")).toBe("–");
    expect(answerLabel(questions, "lu", "F, C")).toBe("Forest, C");
    expect(answerLabel(questions, "cover", "50")).toBe("50");
    expect(answerLabel(questions, "other", "x")).toBe("x");
  });

  it("asks golden answers for the survey's questions and those already given", () => {
    expect(goldenKeys(questions, { extra: "1", lu: "F" })).toEqual(["lu", "cover", "extra"]);
  });

  it("reads a pass mark", () => {
    expect(readPassMark("")).toBeNull();
    expect(readPassMark(" 80 ")).toBe(80);
    expect(readPassMark("101")).toBeUndefined();
    expect(readPassMark("8.5")).toBeUndefined();
  });
});

describe("the training report's figures", () => {
  const plot = (id: string, compared: number, agreeing: number) => ({ plot: id, submittedAt: 1, answers: { compared, agreeing, rate: agreeing / compared }, right: compared === agreeing, questions: [] });
  const score = (byQuestion: Record<string, [number, number]>, byPlot: ReturnType<typeof plot>[]) => ({
    score: {
      plots: 2,
      submitted: byPlot.length,
      answers: { compared: 0, agreeing: 0, rate: null },
      plotsRight: 0,
      passed: null,
      byQuestion: Object.fromEntries(Object.entries(byQuestion).map(([k, [c, a]]) => [k, { compared: c, agreeing: a, rate: a / c }])),
      byPlot,
    },
  });
  const scores = [score({ lu: [2, 1], cover: [2, 2] }, [plot("1", 2, 2), plot("2", 2, 1)]), score({ lu: [2, 0], cover: [1, 1] }, [plot("2", 2, 0)])];

  it("adds up each question over everyone, weakest first", () => {
    expect(questionAccuracy(scores)).toEqual([
      { key: "lu", compared: 4, agreeing: 1, rate: 0.25 },
      { key: "cover", compared: 3, agreeing: 3, rate: 1 },
    ]);
  });

  it("adds up each plot over those who submitted it, hardest first", () => {
    expect(plotAccuracy(scores)).toEqual([
      { key: "2", compared: 4, agreeing: 1, rate: 0.25, people: 2, allRight: 0 },
      { key: "1", compared: 2, agreeing: 2, rate: 1, people: 1, allRight: 1 },
    ]);
  });
});
