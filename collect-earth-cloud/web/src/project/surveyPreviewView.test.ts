import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surveyDesign } from "../../../src/survey/design";
import type { DesignQuestion, DesignTable } from "../api";
import { brokenRules, columnTotal, isRequired, isShown, noAnswers, optionsOf, typesOf, type Answers } from "./surveyPreviewView";

const basic = surveyDesign(readFileSync(new URL("../../../templates/collect_earth.idm.xml", import.meta.url)));
const questions = [...basic.pages.flatMap((p) => p.items)] as DesignQuestion[];
const q = (name: string) => questions.find((x) => x.name === name)!;
const typeOf = typesOf(basic);
const with_ = (plot: Answers["plot"]): Answers => ({ ...noAnswers(), plot });

describe("the preview of the form", () => {
  it("shows a question when its condition holds", () => {
    expect(isShown(q("memo_text_demo"), noAnswers(), {}, typeOf)).toBe(false);
    expect(isShown(q("memo_text_demo"), with_({ yes_no_demo: "true" }), {}, typeOf)).toBe(true);
    expect(isShown(q("memo_text_demo"), with_({ yes_no_demo: "false" }), {}, typeOf)).toBe(false);
    // An advanced condition the preview cannot evaluate shows it
    expect(isShown({ ...q("integer_demo"), shownWhen: { kind: "advanced", text: "starts-with(x, 'P')" } }, noAnswers(), {}, typeOf)).toBe(true);
  });

  it("requires a question when its condition holds", () => {
    expect(isRequired(q("code_demo"), noAnswers(), {}, typeOf)).toBe(true);
    const date = basic.pages[1].items[0] as DesignQuestion;
    expect(isRequired(date, with_({ code_demo: "A" }), {}, typeOf)).toBe(false);
    expect(isRequired(date, with_({ code_demo: ["A", "B"] }), {}, typeOf)).toBe(true);
  });

  it("says the rules an answer breaks, never for no answer", () => {
    expect(brokenRules(q("integer_demo"), noAnswers(), {}, typeOf)).toEqual([]);
    expect(brokenRules(q("integer_demo"), with_({ integer_demo: "12" }), {}, typeOf)).toEqual([]);
    expect(brokenRules(q("integer_demo"), with_({ integer_demo: "25" }), {}, typeOf).map((r) => r.kind)).toEqual(["range"]);
    expect(brokenRules(q("integer_demo"), with_({ integer_demo: "5" }), {}, typeOf)).toHaveLength(1);
    expect(brokenRules(q("short_text_demo"), with_({ short_text_demo: "short" }), {}, typeOf).map((r) => r.kind)).toEqual(["length"]);
    expect(brokenRules(q("short_text_demo"), with_({ short_text_demo: "long enough" }), {}, typeOf)).toEqual([]);
  });

  it("adds a table's column over its rows", () => {
    const share: DesignQuestion = { ...q("integer_demo"), name: "share", rules: [{ flag: "error", message: {}, when: null, kind: "total", test: "atMost", total: 100 }] };
    const table: DesignTable = { kind: "table", id: 1, name: "cover", label: {}, help: {}, rowsList: "x", layout: "table", shownWhen: null, columns: [share] };
    const answers: Answers = { plot: {}, rows: { cover: { F: { share: "60" }, G: { share: "50" } } } };
    expect(columnTotal(table, "share", answers)).toBe(110);
    expect(brokenRules(share, answers, { table, row: "F" }, typeOf)).toHaveLength(1);
    answers.rows.cover.G.share = "40";
    expect(brokenRules(share, answers, { table, row: "F" }, typeOf)).toEqual([]);
  });

  it("offers a sub-list's answers under its parent question's", () => {
    const items = [{ code: "F", label: {}, help: {}, items: [{ code: "F1", label: {}, help: {}, items: [] }] }, { code: "G", label: {}, help: {}, items: [] }];
    const sub: DesignQuestion = { ...q("code_demo"), name: "sub", parentQuestion: "code_demo" };
    expect(optionsOf(sub, items, noAnswers(), {})).toEqual([]);
    expect(optionsOf(sub, items, with_({ code_demo: "F" }), {}).map((i) => i.code)).toEqual(["F1"]);
    expect(optionsOf(q("code_demo"), items, noAnswers(), {}).map((i) => i.code)).toEqual(["F", "G"]);
  });
});
