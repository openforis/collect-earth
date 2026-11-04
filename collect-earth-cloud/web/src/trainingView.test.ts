import { describe, expect, it } from "vitest";
import { answerLabel, goldenKeys, kappaText, readPassMark, shareText } from "./trainingView";

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
