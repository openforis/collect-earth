import { describe, expect, it } from "vitest";
import type { DesignQuestion, DesignTable, SurveyDesign } from "../api";
import { translator } from "../i18n";
import { builderRule, conditionQuestions, draftOf, expressionExample, listOptions, newRow, parseNumber, partOf, ruleDraftOf, ruleKinds, ruleOf, rowsOf, testsFor, surveyTranslator } from "./surveyLogicView";

const question = (name: string, type: DesignQuestion["type"], more: Partial<DesignQuestion> = {}): DesignQuestion => ({
  kind: "question",
  id: name.length,
  name,
  type,
  label: { en: name },
  help: {},
  list: type === "choice" || type === "choices" ? "colours" : null,
  parentQuestion: null,
  layout: null,
  required: "never",
  shownWhen: null,
  rules: [],
  key: false,
  fromPlotFile: false,
  hidden: false,
  formulas: null,
  uses: [],
  notExported: false,
  fixed: false,
  ...more,
});

const colour = question("colour", "choice");
const burnt = question("burnt", "yesNo");
const trees = question("trees", "integer");
const note = question("note", "text");
const share = question("share", "decimal");
const table: DesignTable = { kind: "table", id: 90, name: "cover", label: {}, help: {}, rowsList: "colours", layout: "table", shownWhen: null, columns: [share] };
const design: SurveyDesign = {
  languages: ["en"],
  title: {},
  pages: [{ name: "p", label: {}, items: [colour, burnt, trees, note, table] }],
  fromPlotFile: [question("elevation", "integer", { fromPlotFile: true })],
  calculated: [],
  hidden: [question("operator", "text", { fixed: true, hidden: true })],
  lists: [],
  counts: { formulas: 0 },
  pageOrder: ["p"],
  emptyPages: [],
};
const byName = new Map([colour, burnt, trees, note, share].map((q) => [q.name, q]));

describe("the rows of a condition", () => {
  it("offers the tests of each kind of question, as the server takes them", () => {
    expect(testsFor("choice")).toEqual(["is", "isNot", "answered", "notAnswered"]);
    expect(testsFor("decimal")).toContain("lte");
    expect(testsFor("date")).toEqual(["answered", "notAnswered"]);
  });

  it("names the plot's questions, a column's own row first, never itself or a field Collect Earth fills", () => {
    expect(conditionQuestions(design, null, "trees").map((q) => q.name)).toEqual(["colour", "burnt", "note", "elevation"]);
    expect(conditionQuestions(design, table, "share").map((q) => q.name)).toEqual(["colour", "burnt", "trees", "note", "elevation"]);
    expect(conditionQuestions(design, table, null)[0].name).toBe("share");
  });

  it("turns what the fields hold into the rows the server takes, once each is complete", () => {
    expect(newRow(burnt)).toEqual({ question: "burnt", test: "is", value: "true" });
    expect(partOf({ question: "burnt", test: "isNot", value: "false" }, burnt)).toEqual({ question: "burnt", test: "isNot", value: false });
    expect(partOf({ question: "trees", test: "gte", value: "2,5" }, trees)).toEqual({ question: "trees", test: "gte", value: 2.5 });
    expect(partOf({ question: "trees", test: "gte", value: "many" }, trees)).toBeNull();
    expect(partOf({ question: "colour", test: "lt", value: "R" }, colour)).toBeNull();
    expect(partOf({ question: "note", test: "answered", value: "" }, note)).toEqual({ question: "note", test: "answered", value: null });
    expect(rowsOf({ kind: "any", rows: [{ question: "colour", test: "is", value: "R" }, { question: "note", test: "notAnswered", value: "" }] }, byName)).toEqual({
      kind: "any",
      parts: [{ question: "colour", test: "is", value: "R" }, { question: "note", test: "notAnswered", value: null }],
    });
    expect(rowsOf({ kind: "all", rows: [{ question: "colour", test: "is", value: "" }] }, byName)).toBeNull();
    expect(rowsOf({ kind: "all", rows: [] }, byName)).toBeNull();
    expect(parseNumber(" -3.25 ")).toBe(-3.25);
    expect(parseNumber("1e3")).toBeNaN();
  });

  it("reads the rows of a condition back, not an advanced one", () => {
    expect(draftOf({ kind: "all", parts: [{ question: "trees", test: "lt", value: 3 }] })).toEqual({ kind: "all", rows: [{ question: "trees", test: "lt", value: "3" }] });
    expect(draftOf({ kind: "advanced", text: "x" })).toBeNull();
    expect(draftOf(null)).toBeNull();
  });

  it("lists the answers of every level", () => {
    const items = [{ code: "F", label: {}, help: {}, usedBy: [], items: [{ code: "F1", label: {}, help: {}, usedBy: [], items: [] }] }, { code: "G", label: {}, help: {}, usedBy: [], items: [] }];
    expect(listOptions(items).map((i) => i.code)).toEqual(["F", "F1", "G"]);
  });
});

describe("rules", () => {
  it("offers a range for a number, a total in a table, a length for a text, an expression for any; nothing for a calculated value", () => {
    expect(ruleKinds(trees, null)).toEqual(["range", "expression"]);
    expect(ruleKinds(share, table)).toEqual(["range", "total", "expression"]);
    expect(ruleKinds(share, { ...table, layout: "group" })).toEqual(["range", "expression"]);
    expect(ruleKinds(note, null)).toEqual(["length", "expression"]);
    // Any other question: a rule written as an expression (stage 7)
    expect(ruleKinds(colour, null)).toEqual(["expression"]);
    expect(ruleKinds(question("x", "integer", { formulas: [] }), null)).toEqual([]);
  });

  it("makes the rule from its fields, once a limit is given", () => {
    const draft = ruleDraftOf(null, ["range"], "");
    expect(ruleOf(draft, byName)).toBeNull();
    expect(ruleOf({ ...draft, min: { mode: "number", number: "0", question: "", inclusive: true }, max: { mode: "question", number: "", question: "trees", inclusive: false } }, byName)).toEqual({
      flag: "error",
      when: null,
      message: {},
      kind: "range",
      min: { bound: { number: 0 }, inclusive: true },
      max: { bound: { question: "trees" }, inclusive: false },
    });
    const length = ruleDraftOf(null, ["length"], "");
    expect(ruleOf({ ...length, minChars: "2", maxChars: "" }, byName)).toMatchObject({ kind: "length", min: 2, max: null });
    expect(ruleOf({ ...length, minChars: "2.5" }, byName)).toBeNull();
    const total = ruleDraftOf(null, ["total"], "");
    expect(ruleOf({ ...total, total: "100", totalTest: "exactly", flag: "warning" }, byName)).toMatchObject({ kind: "total", test: "exactly", total: 100, flag: "warning" });
    // "Only when" needs complete rows
    expect(ruleOf({ ...total, total: "100", onlyWhen: true, when: { kind: "all", rows: [{ question: "colour", test: "is", value: "" }] } }, byName)).toBeNull();
    expect(ruleOf({ ...total, total: "100", onlyWhen: true, when: { kind: "all", rows: [{ question: "colour", test: "is", value: "R" }] } }, byName)?.when).toEqual({ kind: "all", parts: [{ question: "colour", test: "is", value: "R" }] });
  });

  it("reads a rule back into its fields; one written in Collect is only deleted", () => {
    const draft = ruleDraftOf({ flag: "warning", message: { en: "Hm" }, when: { kind: "all", parts: [{ question: "burnt", test: "is", value: true }] }, kind: "range", min: null, max: { bound: { number: 9 }, inclusive: false } }, ["range"], "Hm");
    expect(draft).toMatchObject({ kind: "range", flag: "warning", message: "Hm", onlyWhen: true, max: { mode: "number", number: "9", inclusive: false }, min: { mode: "none" } });
    expect(builderRule({ flag: "error", message: {}, when: null, kind: "advanced", text: "pattern regex=x", expression: false })).toBe(false);
    expect(builderRule({ flag: "error", message: {}, when: null, kind: "advanced", text: "$this != 1", expression: true })).toBe(true);
    expect(builderRule({ flag: "error", message: {}, when: null, kind: "range", min: { bound: { expression: "a + b" }, inclusive: true }, max: null })).toBe(false);
    expect(builderRule({ flag: "error", message: {}, when: null, kind: "length", min: 1, max: null })).toBe(true);
    // A check's expression changes as text
    expect(ruleDraftOf({ flag: "error", message: {}, when: { kind: "advanced", text: "x > 1" }, kind: "advanced", text: "$this != 2", expression: true }, ["expression"], "")).toMatchObject({
      kind: "expression",
      expressionText: "$this != 2",
      whenText: "x > 1",
    });
    expect(ruleOf({ ...ruleDraftOf(null, ["expression"], ""), kind: "expression", expressionText: " $this > 0 " }, byName)).toEqual({ flag: "error", when: null, message: {}, kind: "expression", text: "$this > 0" });
  });
});

describe("a rule's message written for the survey", () => {
  it("is in the survey's language when the dashboard has it, else none", () => {
    expect(surveyTranslator("fr")?.("survey.and")).toBe(translator("fr")("survey.and"));
    expect(surveyTranslator("pt_BR")?.("survey.and")).toBe(translator("pt")("survey.and"));
    expect(surveyTranslator("sw")).toBeNull();
  });
});

describe("an expression's example in the question's terms (review 3)", () => {
  it("names a real code of a choice's list, in quotes", () => {
    const q = { name: "lu", type: "choice", list: "land" } as DesignQuestion;
    const lists = new Map([["land", { name: "land", items: [{ code: "F", label: { en: "Forest" }, items: [] }] }]]) as never;
    expect(expressionExample(q, lists, "en", ["en"])).toEqual({ kind: "list", code: "F", label: "Forest" });
    expect(expressionExample({ ...q, type: "text", list: null } as DesignQuestion, lists, "en", ["en"])).toEqual({ kind: "text" });
    expect(expressionExample({ ...q, type: "integer", list: null } as DesignQuestion, lists, "en", ["en"])).toBeNull();
  });
});
