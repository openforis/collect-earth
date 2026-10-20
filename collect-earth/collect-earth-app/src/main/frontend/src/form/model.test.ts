import { describe, expect, it } from "vitest";
import {
  type Field, type FormModel, availableItems, dateFromInput, dateToInput, entityCount, errorList, fieldsByName,
  indexedField, isTabVisible, joinValues, mergeInfos, parseCodes, qualify, rangeFromInput, rangeToInput, saveBody, selectCodes,
  splitValues, tabsWithErrors, timeToInput,
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
  it("hides a tab whose fields are all not relevant", () => {
    expect(isTabVisible(model.tabs[0], { collect_code_lu: { visible: false }, collect_code_sub: { visible: false } })).toBe(false);
    expect(isTabVisible(model.tabs[0], {})).toBe(true);
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
