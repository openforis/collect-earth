import { describe, expect, it } from "vitest";
import { answersQuery, NO_ANSWERS_FILTER, toAnswersData, type AnswerFlag, type ChoiceAnswers } from "./api";
import { answerQuestions, chanceText, choiceRows, datesInOrder, flagText, hasFilter, numberText, restOfTeam, shownQuestion, spreadScale, spreadText } from "./answersView";
import { translator } from "./i18n";

const land: ChoiceAnswers = {
  key: "land",
  label: "Land use",
  multiple: false,
  answered: 264,
  blank: 0,
  codes: [
    { code: "F", label: "Forest", count: 194 },
    { code: "C", label: "Cropland", count: 70 },
  ],
  people: [
    { username: "ana", answered: 64, counts: [38, 26] },
    { username: "ben", answered: 200, counts: [156, 44] },
  ],
  flags: 2,
};

const flag: AnswerFlag = {
  key: "land",
  label: "Land use",
  username: "Ana",
  code: "C",
  codeLabel: "cropland",
  plots: 64,
  count: 26,
  share: 26 / 64,
  others: { plots: 200, count: 44, share: 0.22 },
  z: 3.1,
};

describe("answersView", () => {
  it("how many flags chance alone would give", () => {
    const t = translator("en");
    expect(chanceText(t, 6 * 0.0027, "en")).toBe("Chance alone would hardly ever give even one.");
    expect(chanceText(t, 0.27, "en")).toBe("Chance alone would give about 0.3 of them.");
    expect(chanceText(t, 12.6, "en")).toBe("Chance alone would give about 13 of them.");
    expect(chanceText(translator("es"), 1.25, "es")).toContain("1,3");
  });

  it("the flag's text, built from its figures, in each language", () => {
    expect(flagText(translator("en"), flag, "en")).toBe("Ana: cropland on 41% of 64 plots; the rest of the team: 22%.");
    const es = flagText(translator("es"), flag, "es");
    expect(es).toContain("Ana");
    expect(es).toContain("41");
    expect(es).toContain("64");
    expect(es).toContain("22");
    expect(flagText(translator("fr"), { ...flag, plots: 1000 }, "fr")).toContain("1 000");
  });

  it("a choice's rows: the team's shares, and with a person theirs and the rest of the team's", () => {
    const team = choiceRows(land, null);
    expect(team.map((r) => [r.code, r.count, r.share])).toEqual([
      ["F", 194, 194 / 264],
      ["C", 70, 70 / 264],
    ]);
    expect(team[0].person).toBeNull();
    const ana = choiceRows(land, "ana");
    expect(ana[1].person).toEqual({ count: 26, share: 26 / 64 });
    expect(ana[1].rest).toEqual({ count: 44, share: 44 / 200 });
    // Someone not in the figures: the team only.
    expect(choiceRows(land, "zoe")[0].person).toBeNull();
    // Someone with no answer to it: no share (the page says "No answers", not 0 %).
    const none = { ...land, people: [...land.people, { username: "carl", answered: 0, counts: [0, 0] }] };
    expect(choiceRows(none, "carl")[0].person).toEqual({ count: 0, share: null });
    expect(restOfTeam(land, "ana")).toEqual({ answered: 200, counts: [156, 44] });
    expect(restOfTeam(land, null)).toBeNull();
  });

  it("the questions to choose, the one shown first being the first with a flag", () => {
    const data = toAnswersData({
      choices: [{ key: "a", label: "A", codes: [], people: [] }, land],
      numbers: [{ key: "n", label: "N", team: {}, people: [] }],
      // Only one listed: the counts per question are the server's.
      flags: [flag],
    });
    const questions = answerQuestions(data);
    expect(questions.map((q) => [q.key, q.kind, q.flags])).toEqual([
      ["a", "choice", 0],
      ["land", "choice", 2],
      ["n", "number", 0],
    ]);
    expect(shownQuestion(questions, null)).toBe("land");
    expect(shownQuestion(questions, "n")).toBe("n");
    expect(shownQuestion(questions, "gone")).toBe("land");
    expect(shownQuestion([], null)).toBeNull();
  });

  it("numbers: the spread's text and the chart's scale", () => {
    const t = translator("en");
    expect(spreadText(t, { values: 4, nonNumeric: 0, median: 12.345, q1: 8, q3: 20 }, "en")).toBe("median 12.35, half of the plots from 8 to 20");
    expect(spreadText(t, { values: 0, nonNumeric: 2, median: null, q1: null, q3: null }, "en")).toBe("no numbers");
    expect(numberText(null, "en")).toBe("—");
    const s = (q1: number | null, q3: number | null) => ({ values: 1, nonNumeric: 0, median: q1, q1, q3 });
    expect(spreadScale({ key: "n", label: "N", team: s(5, 10), people: [{ username: "a", ...s(2, 8) }, { username: "b", ...s(null, null) }] })).toEqual({ min: 2, max: 10 });
    expect(spreadScale({ key: "n", label: "N", team: s(10, 10), people: [] })).toEqual({ min: 9, max: 11 });
  });

  it("the query sends only what is set, a column only with its file", () => {
    expect(answersQuery(NO_ANSWERS_FILTER, "Europe/Rome").toString()).toBe("tz=Europe%2FRome");
    expect(answersQuery({ ...NO_ANSWERS_FILTER, column: 3, value: "north" }, "UTC").toString()).toBe("tz=UTC");
    expect(answersQuery({ person: "ana", file: "f1", column: 3, value: "", from: "2026-10-01", to: null }, "UTC").toString()).toBe(
      "person=ana&file=f1&column=3&value=&from=2026-10-01&tz=UTC",
    );
    expect(hasFilter(NO_ANSWERS_FILTER)).toBe(false);
    expect(datesInOrder("2026-10-01", "2026-10-01")).toBe(true);
    expect(datesInOrder("2026-10-02", "2026-10-01")).toBe(false);
    expect(datesInOrder(null, "2026-10-01")).toBe(true);
    expect(hasFilter({ ...NO_ANSWERS_FILTER, to: "2026-10-01" })).toBe(true);
  });
});
