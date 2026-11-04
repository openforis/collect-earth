import { describe, expect, it } from "vitest";
import {
  type Field, type FormModel, availableItems, clickCode, dateFromInput, dateToInput, entityCount, errorList, fieldsByName,
  indexedField, isTabVisible, joinValues, mergeInfos, parseCodes, plainMessage, qualify, rangeFromInput, rangeToInput,
  requiredMessage, saveBody, selectCodes, splitValues, summaryLines, tabsWithErrors, timeToInput, unansweredRequired, errorsByTab, neededByTab, updateRequired,
  DROPDOWN_AS_BUTTONS, advanceTarget, answeredWithKeys, codeControl, firstToAnswer, numberProblem, stepsOf,
} from "./model";

const category: Field = {
  kind: "field", name: "collect_code_lu", type: "code", label: "Land use",
  code: { layout: "buttons", items: [{ id: 1, code: "F", label: "Forest" }, { id: 2, code: "C", label: "Cropland" }] },
};
const subdivision: Field = {
  kind: "field", name: "collect_code_sub", type: "code", label: "Subdivision",
  code: {
    layout: "dropdown", parent: "collect_code_lu", items: [
      { id: 11, code: "dec", label: "Deciduous", parentId: 1 },
      { id: 12, code: "ever", label: "Evergreen", parentId: 1 },
      { id: 21, code: "rice", label: "Rice", parentId: 2 },
    ],
  },
};
const comments: Field = { kind: "field", name: "collect_text_comments", type: "memo", label: "Comments" };
const model: FormModel = {
  survey: "s", language: "en", keys: ["collect_text_id"], csvFields: [], unsupported: [],
  tabs: [
    { id: "a", label: "A", items: [category, subdivision] },
    { id: "b", label: "B", items: [comments, { kind: "multiple", entity: "tree", label: "Tree", fields: [
      { kind: "field", name: "collect_entity_tree[$index].real_height", type: "real", label: "Height" }] }] },
  ],
};

describe("value formats", () => {
  it("converts dates between the server (MM/dd/yyyy) and the date input", () => {
    expect(dateToInput("3/7/2021")).toBe("2021-03-07");
    expect(dateFromInput("2021-03-07")).toBe("03/07/2021");
    expect(dateToInput("")).toBe("");
    expect(timeToInput("7:05")).toBe("07:05");
  });
  it("reads and writes ranges as FROM-TO, negative numbers included", () => {
    expect(rangeToInput("10-20")).toEqual(["10", "20"]);
    expect(rangeToInput("8")).toEqual(["8", "8"]);
    expect(rangeToInput("-5--2.5")).toEqual(["-5", "-2.5"]);
    expect(rangeToInput("")).toEqual(["", ""]);
    expect(rangeFromInput("10", "20")).toBe("10-20");
    expect(rangeFromInput("-5", "-2")).toBe("-5--2");
    expect(rangeFromInput("8", "8")).toBe("8");
    expect(rangeFromInput("8", "")).toBe("8");
    expect(rangeFromInput("", "")).toBe("");
  });
  it("splits and joins multiple values with ===", () => {
    expect(splitValues("a===b")).toEqual(["a", "b"]);
    expect(splitValues("")).toEqual([]);
    expect(joinValues(["a", "b"])).toBe("a===b");
  });
});

describe("clickCode", () => {
  it("keeps a single answer chosen when it is clicked again", () => {
    expect(clickCode(["F"], "F", false)).toBeNull();
  });
  it("picks another single answer in its place", () => {
    expect(clickCode(["F"], "C", false)).toEqual(["C"]);
    expect(clickCode([], "C", false)).toEqual(["C"]);
  });
  it("toggles the answers of a multiple choice", () => {
    expect(clickCode(["F", "C"], "F", true)).toEqual(["C"]);
    expect(clickCode(["C"], "F", true)).toEqual(["C", "F"]);
  });
});

describe("qualifiable items (Other, specify)", () => {
  it("reads each code with its qualifier", () => {
    expect(parseCodes("pine===other::Eucalyptus")).toEqual([{ code: "pine", qualifier: "" }, { code: "other", qualifier: "Eucalyptus" }]);
    expect(parseCodes("other::a :: b")).toEqual([{ code: "other", qualifier: "a :: b" }]);
  });
  it("keeps the qualifier of a code that stays selected, and drops the others", () => {
    expect(selectCodes("other::Teak", ["other", "pine"])).toBe("other::Teak===pine");
    expect(selectCodes("other::Teak", ["pine"])).toBe("pine");
    expect(selectCodes("other::Teak", [])).toBe("");
  });
  it("writes the qualifier of one code; an empty one is no qualifier", () => {
    expect(qualify("pine===other", "other", "Teak")).toBe("pine===other::Teak");
    expect(qualify("other::Teak", "other", "  ")).toBe("other");
  });
  it("a qualified parent still selects its children", () => {
    const byName = fieldsByName(model, {});
    const items = availableItems(subdivision, {}, { collect_code_lu: "F::planted" }, byName).map((i) => i.code);
    expect(items).toEqual(["dec", "ever"]);
  });
});

describe("hierarchical codes", () => {
  const byName = fieldsByName(model, {});
  it("offers nothing until the parent is chosen", () => {
    expect(availableItems(subdivision, {}, {}, byName)).toEqual([]);
  });
  it("follows the parent the operator just picked, before the server answers", () => {
    expect(availableItems(subdivision, {}, { collect_code_lu: "C" }, byName).map((i) => i.code)).toEqual(["rice"]);
  });
  it("follows the parent item the server reports (calculated parents)", () => {
    const infos = { collect_code_lu: { value: "F", codeItemId: 1 } };
    expect(availableItems(subdivision, infos, {}, byName).map((i) => i.code)).toEqual(["dec", "ever"]);
  });
  it("narrows to the items the server says are valid", () => {
    const infos = { collect_code_lu: { codeItemId: 1 }, collect_code_sub: { possibleCodedItems: [{ code: "ever", label: "E" }] } };
    expect(availableItems(subdivision, infos, {}, byName).map((i) => i.code)).toEqual(["ever"]);
  });
  it("a cleared parent offers nothing", () => {
    const infos = { collect_code_lu: { value: "F", codeItemId: 1 } };
    expect(availableItems(subdivision, infos, { collect_code_lu: "" }, byName)).toEqual([]);
  });
});

describe("server responses", () => {
  it("a partial update only changes the fields it reports", () => {
    const known = { a: { value: "1", visible: true }, b: { value: "2", visible: true } };
    const merged = mergeInfos(known, { success: true, inputFieldInfoByParameterName: { b: { visible: false } } }, false);
    expect(merged.a).toEqual({ value: "1", visible: true });
    expect(merged.b).toEqual({ value: "2", visible: false });
  });
  it("a full response replaces everything", () => {
    const merged = mergeInfos({ a: { inError: true } }, { success: true, inputFieldInfoByParameterName: { b: {} } }, true);
    expect(Object.keys(merged)).toEqual(["b"]);
  });
  it("a deleted entity takes its fields away", () => {
    const known = { "collect_entity_tree[1].real_height": { value: "3" }, "collect_entity_tree[2].real_height": { value: "4" } };
    const merged = mergeInfos(known, { success: true, deletedEntityDefName: "tree", inputFieldInfoByParameterName: {} }, false);
    expect(Object.keys(merged)).toEqual(["collect_entity_tree[1].real_height"]);
  });
  it("counts the entities of a multiple item from the names the server returned", () => {
    const item = model.tabs[1].items[1] as Extract<FormModel["tabs"][0]["items"][0], { kind: "multiple" }>;
    expect(entityCount(item, {})).toBe(0);
    expect(entityCount(item, { "collect_entity_tree[2].real_height": {}, "collect_entity_tree[1].real_height": {} })).toBe(2);
    expect(indexedField(item.fields[0], 2).name).toBe("collect_entity_tree[2].real_height");
  });
});

describe("errors and tabs", () => {
  it("lists visible errors with their tab, and ignores non relevant fields", () => {
    const infos = {
      collect_text_comments: { inError: true, errorMessage: "Required" },
      collect_code_sub: { inError: true, visible: false },
    };
    expect(errorList(model, infos).map((e) => [e.tab, e.field.name, e.message])).toEqual([[1, "collect_text_comments", "Required"]]);
    expect([...tabsWithErrors(model, infos)]).toEqual([1]);
  });
  it("says where an error is when the label alone does not: the row of a table, the entity of a multiple item", () => {
    const table: FormModel = { ...model, tabs: [{ id: "t", label: "T", items: [{ kind: "table", label: "Cover", columns: [{ label: "Percent" }],
      rows: [
        { code: "trees", label: "Trees", fields: [{ kind: "field", name: "collect_entity_cover[trees].real_pct", type: "real", label: "Percent" }] },
        { code: "grass", label: "Grass", fields: [{ kind: "field", name: "collect_entity_cover[grass].real_pct", type: "real", label: "Percent" }] },
      ] }] }, model.tabs[1]] };
    const infos = {
      "collect_entity_cover[grass].real_pct": { inError: true },
      "collect_entity_tree[1].real_height": {},
      "collect_entity_tree[2].real_height": { inError: true },
    };
    expect(errorList(table, infos).map((e) => [e.field.name, e.context])).toEqual([
      ["collect_entity_cover[grass].real_pct", "Grass"], ["collect_entity_tree[2].real_height", "Tree 2"]]);
  });
  it("words an unanswered question after its control, and leaves a multiple one to the server", () => {
    expect(requiredMessage(category)).toBe("entry.required.choose");
    expect(requiredMessage(comments)).toBe("entry.required.text");
    expect(requiredMessage({ ...comments, type: "boolean", affirmativeOnly: true })).toBe("entry.required.tick");
    expect(requiredMessage({ ...comments, type: "integerRange" })).toBe("entry.required.range");
    expect(requiredMessage({ ...category, multiple: true })).toBeNull();
  });
  it("reads the HTML of the messages about a value that could not be read", () => {
    expect(plainMessage("'&lt;b&gt;1 &amp; &quot;2&quot;' is not a number")).toBe(`'<b>1 & "2"' is not a number`);
    expect(plainMessage(null)).toBe("");
  });
  it("hides a tab whose fields are all not relevant", () => {
    expect(isTabVisible(model.tabs[0], { collect_code_lu: { visible: false }, collect_code_sub: { visible: false } })).toBe(false);
    expect(isTabVisible(model.tabs[0], {})).toBe(true);
  });
  it("hides a tab with only plot file data, which the header shows instead", () => {
    const tab = { id: "csv", label: "From CSV", items: [{ kind: "info" as const, name: "collect_text_region", label: "Region" }, category] };
    expect(isTabVisible(tab, { collect_code_lu: { visible: false } })).toBe(false);
    expect(isTabVisible(tab, {})).toBe(true);
  });
});

describe("save request", () => {
  it("is built like the balloon's", () => {
    const body = saveBody("1,2025", { "collect_entity_x[a].code_y": "v" }, 2, true);
    expect(body.get("placemarkId")).toBe("1,2025");
    expect(body.get("partialUpdate")).toBe("true");
    expect(body.get("currentStep")).toBe("2");
    expect(body.get("values[collect_entity_x%5Ba%5D.code_y]")).toBe("v");
  });
});

describe("answeredWithKeys", () => {
  it("is a choice or Yes and No, never a text, a number or a calculated value", () => {
    expect(answeredWithKeys(category)).toBe(true);
    expect(answeredWithKeys(subdivision)).toBe(true);
    expect(answeredWithKeys({ ...comments, type: "boolean" })).toBe(true);
    expect(answeredWithKeys(comments)).toBe(false);
    expect(answeredWithKeys({ ...comments, type: "text" })).toBe(false);
    expect(answeredWithKeys({ ...comments, type: "integer" })).toBe(false);
    expect(answeredWithKeys({ ...category, readOnly: true })).toBe(false);
  });
});

describe("codeControl", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, code: String(i), label: String(i) }));
  it("shows a dropdown of a few answers as buttons, all in view", () => {
    expect(codeControl(subdivision, items(DROPDOWN_AS_BUTTONS))).toBe("buttons");
    expect(codeControl(subdivision, items(2))).toBe("buttons");
  });
  it("keeps a dropdown of many answers a searchable list, and buttons buttons", () => {
    expect(codeControl(subdivision, items(DROPDOWN_AS_BUTTONS + 1))).toBe("select");
    expect(codeControl(category, items(20))).toBe("buttons");
  });
});

describe("moves of the focus", () => {
  const q = (name: string, byKey: boolean, needed: boolean) => ({ name, byKey, needed });
  const steps = [
    { tab: 0, questions: [q("lu", true, false), q("sub", true, true), q("note", false, false), q("canopy", true, true)] },
    { tab: 1, questions: [q("comments", false, false), q("optional", true, false)] },
    { tab: 2, questions: [q("change", true, true), q("year", false, true)] },
  ];
  it("opens a step on its first question needed that is answered from the keyboard", () => {
    expect(firstToAnswer(steps, 0)).toBe("sub");
    expect(firstToAnswer(steps, 2)).toBe("change");
  });
  it("opens a step with none such on nothing", () => {
    expect(firstToAnswer(steps, 1)).toBeNull();
    expect(firstToAnswer(steps, 7)).toBeNull();
  });
  it("goes on to the next question needed below, past the texts and the questions answered", () => {
    expect(advanceTarget(steps, 0, "lu")).toEqual({ tab: 0, name: "sub" });
    expect(advanceTarget(steps, 0, "sub")).toEqual({ tab: 0, name: "canopy" });
  });
  it("comes back to one left above on the same step", () => {
    const left = [{ tab: 0, questions: [q("lu", true, true), q("sub", true, false)] }];
    expect(advanceTarget(left, 0, "sub")).toEqual({ tab: 0, name: "lu" });
  });
  it("goes to the next step that needs an answer, skipping one with only optional questions and texts", () => {
    const done = [{ ...steps[0], questions: steps[0].questions.map((x) => ({ ...x, needed: false })) }, steps[1], steps[2]];
    expect(advanceTarget(done, 0, "canopy")).toEqual({ tab: 2, name: "change" });
  });
  it("goes back to a step before that needs an answer once those after are done", () => {
    const before = [steps[0], steps[1], { tab: 2, questions: [q("change", true, false)] }];
    expect(advanceTarget(before, 2, "change")).toEqual({ tab: 0, name: "sub" });
  });
  it("stays on a step that still needs an answer typed, on its step button, never in the text box", () => {
    expect(advanceTarget(steps, 2, "change")).toEqual({ tab: 2, name: null });
  });
  it("goes to the step button, Submit, when nothing is left anywhere", () => {
    const none = steps.map((s) => ({ ...s, questions: s.questions.map((x) => ({ ...x, needed: false })) }));
    expect(advanceTarget(none, 0, "canopy")).toEqual({ tab: 0, name: null });
    expect(advanceTarget(none, 2, null)).toEqual({ tab: 2, name: null });
  });
  it("never lands in an optional question, even one answered with keys", () => {
    const optional = [{ tab: 0, questions: [q("lu", true, false), q("optional", true, false), q("comments", false, false)] }];
    expect(advanceTarget(optional, 0, "lu")).toEqual({ tab: 0, name: null });
  });
  it("describes the steps shown, with their questions shown in order", () => {
    const infos = { collect_code_sub: { visible: false }, "collect_entity_tree[1].real_height": {} };
    const described = stepsOf(model, infos, (f) => ({ name: f.name, byKey: answeredWithKeys(f), needed: f.name === "collect_code_lu" }));
    expect(described).toEqual([
      { tab: 0, questions: [{ name: "collect_code_lu", byKey: true, needed: true }] },
      { tab: 1, questions: [{ name: "collect_text_comments", byKey: false, needed: false },
        { name: "collect_entity_tree[1].real_height", byKey: false, needed: false }] },
    ]);
    expect(stepsOf(model, { collect_code_lu: { visible: false }, collect_code_sub: { visible: false } }, () => null).map((s) => s.tab)).toEqual([1]);
  });
});

describe("numberProblem", () => {
  it("takes whole numbers, decimals with a dot or a comma, and nothing", () => {
    expect(numberProblem("integer", "12")).toBeNull();
    expect(numberProblem("integer", "-3")).toBeNull();
    expect(numberProblem("real", "1,5")).toBeNull();
    expect(numberProblem("real", ".5")).toBeNull();
    expect(numberProblem("real", "2.")).toBeNull();
    expect(numberProblem("integer", " ")).toBeNull();
  });
  it("says what is wrong with anything else, instead of the server reading 1.5x as 1", () => {
    expect(numberProblem("integer", "1.5x")).toBe("entry.invalidInteger");
    expect(numberProblem("integer", "1.5")).toBe("entry.invalidInteger");
    expect(numberProblem("real", "1.5x")).toBe("entry.invalidNumber");
    expect(numberProblem("real", "1.2.3")).toBe("entry.invalidNumber");
  });
});

describe("required questions", () => {
  const calculated: Field = { kind: "field", name: "collect_real_area", type: "real", label: "Area", readOnly: true, calculated: true };
  const fields = { ...fieldsByName(model, {}), [calculated.name]: calculated };
  it("are those the server reports in error while not answered, and shown", () => {
    const infos = {
      collect_code_lu: { inError: true }, collect_code_sub: { inError: true, visible: false },
      collect_text_comments: { inError: false }, collect_real_area: { inError: true },
    };
    expect(unansweredRequired(fields, infos, () => "")).toEqual(["collect_code_lu"]);
  });
  it("leave out a question answered, whose error is about the value given", () => {
    const infos = { collect_code_lu: { inError: true }, collect_text_comments: { inError: true } };
    expect(unansweredRequired(fields, infos, (n) => (n === "collect_text_comments" ? "x" : ""))).toEqual(["collect_code_lu"]);
  });
  it("are remembered once answered, and forgotten when the server no longer asks an answer for them", () => {
    const asked = updateRequired(new Set(), fields, { collect_code_lu: { inError: true }, collect_text_comments: { inError: true } }, () => "");
    expect([...asked].sort()).toEqual(["collect_code_lu", "collect_text_comments"]);
    // land use answered: still required; comments left empty and no longer in error: an answer made it optional
    const after = updateRequired(asked, fields, { collect_code_lu: { inError: false }, collect_text_comments: { inError: false } },
      (n) => (n === "collect_code_lu" ? "F" : ""));
    expect([...after]).toEqual(["collect_code_lu"]);
    // hidden, or not reported: kept
    expect([...updateRequired(asked, fields, { collect_code_lu: { visible: false } }, () => "")].sort())
      .toEqual(["collect_code_lu", "collect_text_comments"]);
  });
  it("count, by step, the answers still to give, not the values to correct", () => {
    const infos = { collect_code_lu: { inError: true }, collect_code_sub: { inError: true }, collect_text_comments: { inError: true } };
    expect(neededByTab(errorList(model, infos), (n) => (n === "collect_text_comments" ? "too long" : ""))).toEqual({ 0: 2 });
  });
  it("are counted by step", () => {
    const infos = { collect_code_lu: { inError: true }, collect_code_sub: { inError: true }, collect_text_comments: { inError: true } };
    expect(errorsByTab(errorList(model, infos))).toEqual({ 0: 2, 1: 1 });
    expect(errorsByTab([])).toEqual({});
  });
});

describe("summaryLines", () => {
  const found = errorList(model, { collect_code_lu: { inError: true }, collect_text_comments: { inError: true } });
  it("keeps what Submit found, ticking off what is answered since, so the list keeps its height", () => {
    const now = errorList(model, { collect_text_comments: { inError: true } });
    expect(summaryLines(found, now).map((l) => [l.error.field.name, l.fixed])).toEqual([
      ["collect_code_lu", true], ["collect_text_comments", false]]);
  });
  it("adds none of those in error since, which would push the questions down, and has the latest message of the others", () => {
    const now = errorList(model, { collect_code_sub: { inError: true }, collect_text_comments: { inError: true, errorMessage: "Too long" } });
    expect(summaryLines(found, now).map((l) => [l.error.field.name, l.fixed, l.error.message])).toEqual([
      ["collect_code_lu", true, ""], ["collect_text_comments", false, "Too long"]]);
  });
});
