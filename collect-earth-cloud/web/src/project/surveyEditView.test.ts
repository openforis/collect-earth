import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surveyDesign } from "../../../src/survey/design";
import type { DesignQuestion, DesignRule, SurveyDesign } from "../api";
import {
  changedTexts,
  Drafts,
  editKey,
  isItemCode,
  isLanguageCode,
  itemsFromLines,
  languagesUsed,
  listLevels,
  moveTarget,
  namesEmptied,
  operationsOf,
  pageMoveTarget,
  PendingTexts,
  rebaseChange,
  ruleAnchor,
  ruleIndexOf,
  sameSurvey,
  slugName,
  subListParents,
  surveyTexts,
  textOf,
  uniqueName,
  withPendingTexts,
  withText,
  type PendingText,
} from "./surveyEditView";

const label = (text: string, current = "Land use"): PendingText => ({ target: { kind: "node", id: 8 }, part: "label", language: "en", text, current });

describe("the words changed before they are saved", () => {
  it("keeps one text per target, part and language", () => {
    let pending = withText(new Map(), label("Land use now"));
    pending = withText(pending, label("Land use today"));
    pending = withText(pending, { ...label("Uso"), language: "es", current: "" });
    expect(pending.size).toBe(2);
    expect(pending.get(editKey({ kind: "node", id: 8 }, "label", "en"))?.text).toBe("Land use today");
  });

  it("forgets a text typed back to what it was, and sends only what differs", () => {
    let pending = withText(new Map(), label("Land use now"));
    pending = withText(pending, label("Land use"));
    expect(pending.size).toBe(0);
    pending = withText(pending, label("Land use "));
    expect(changedTexts(pending)).toEqual([]);
    expect(operationsOf(pending)).toEqual([]);
  });

  it("sends the languages added first, then the texts, trimmed", () => {
    const pending = withText(new Map(), { ...label(" Matumizi ya ardhi "), language: "sw", current: "" });
    expect(operationsOf(pending, ["sw"])).toEqual([
      { op: "addLanguage", language: "sw" },
      { op: "setText", target: { kind: "node", id: 8 }, part: "label", language: "sw", text: "Matumizi ya ardhi" },
    ]);
  });

  it("takes language codes as the survey writes them", () => {
    expect(["fr", "pt_BR", "fil"].every(isLanguageCode)).toBe(true);
    expect(["French", "pt-BR", "", "FR"].some(isLanguageCode)).toBe(false);
  });
});

describe("the questions changed (stage 3)", () => {
  it("makes names and codes as the server does", () => {
    expect(slugName("Tree cover (%)", "question")).toBe("tree_cover");
    expect(slugName("Land use 2020", "question")).toBe("land_use2020");
    expect(uniqueName("water", new Set(["water", "water_b"]))).toBe("water_c");
    expect(itemsFromLines("Forest\n\n  Crop land \nForest", "en")).toEqual([
      { code: "forest", label: { en: "Forest" } },
      { code: "crop_land", label: { en: "Crop land" } },
      { code: "forest_b", label: { en: "Forest" } },
    ]);
    expect(isItemCode("F.1-a_b")).toBe(true);
    expect(isItemCode("F 1")).toBe(false);
  });

  it("works out where a question, a page goes one step up or down", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(moveTarget(items, 1, -1)).toBeNull();
    expect(moveTarget(items, 3, -1)).toEqual({ before: 2 });
    expect(moveTarget(items, 2, 1)).toEqual({ before: 4 });
    expect(moveTarget(items, 3, 1)).toEqual({ before: undefined });
    expect(moveTarget(items, 4, 1)).toBeNull();
    expect(pageMoveTarget(["a", "b", "c"], "a", 1)).toEqual({ before: "c" });
    expect(pageMoveTarget(["a", "b", "c"], "c", -1)).toEqual({ before: "b" });
  });
});

const basic = surveyDesign(readFileSync(new URL("../../../templates/collect_earth.idm.xml", import.meta.url)));
const title = (text: string, current: string): PendingText => ({ target: { kind: "title" }, part: "label", language: "en", text, current });

describe("the texts typed and not saved yet", () => {
  it("tells whoever listens, and gives each field its own text", () => {
    const store = new PendingTexts();
    let heard = 0;
    const stop = store.subscribe(() => heard++);
    const before = store.all();
    store.set(label("Land use now"));
    expect(heard).toBe(1);
    expect(store.all()).not.toBe(before);
    expect(store.get(editKey({ kind: "node", id: 8 }, "label", "en"))?.text).toBe("Land use now");
    expect(store.get(editKey({ kind: "title" }, "label", "en"))).toBeUndefined();
    stop();
    store.clear();
    expect(heard).toBe(1);
    expect(store.all().size).toBe(0);
  });

  it("after a save keeps what was typed meanwhile, and compares the rest with the survey saved", () => {
    const now = textOf(surveyTexts(basic), { kind: "title" }, "label", "en")!;
    const store = new PendingTexts();
    // Sent as "A"; typed on to "AB" while the save was on its way
    const sent = title("A", "old");
    store.set(title("AB", "old"));
    // Another text, sent and unchanged since
    const page = { target: { kind: "page", name: "plot_tab" }, part: "label", language: "en", text: "Page one", current: "x" } as const;
    store.set(page);
    // A text not sent (typed after), now equal to the survey's
    store.set({ ...label("same"), target: { kind: "node", id: basic.pages[0].items[0].id }, text: textOf(surveyTexts(basic), { kind: "node", id: basic.pages[0].items[0].id }, "label", "en")! + " ", current: "y" });
    store.settle(basic, [sent, page]);
    const left = [...store.all().values()];
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "AB", current: now });
  });

  it("shows the survey with the texts typed: the preview reads them", () => {
    expect(withPendingTexts(basic, [])).toBe(basic);
    const q = basic.pages[0].items.find((i) => i.kind === "question" && i.rules.length > 0)!;
    const list = basic.lists.find((l) => l.items.length > 0)!;
    const changed = withPendingTexts(basic, [
      title("New title ", "x"),
      { target: { kind: "node", id: q.id }, part: "help", language: "es", text: "Ayuda", current: "" },
      { target: { kind: "rule", node: q.id, index: 0 }, part: "message", language: "en", text: "Too big", current: "" },
      { target: { kind: "item", list: list.name, code: list.items[0].code }, part: "label", language: "fr", text: "Oui", current: "" },
    ]);
    expect(changed.title.en).toBe("New title");
    expect(changed.title.es).toBe(basic.title.es);
    const q2 = changed.pages[0].items.find((i) => i.id === q.id)!;
    expect(q2.help.es).toBe("Ayuda");
    expect(q2.kind === "question" && q2.rules[0].message.en).toBe("Too big");
    expect(changed.lists.find((l) => l.name === list.name)!.items[0].label.fr).toBe("Oui");
    // The survey read is left as it was
    expect(basic.title.en).not.toBe("New title");
  });

  it("finds a text by what it belongs to, whatever the order of its fields", () => {
    const texts = surveyTexts(basic);
    const q = basic.pages[0].items[0];
    expect(textOf(texts, { id: q.id, kind: "node" } as never, "label", "en")).toBe(q.label.en ?? "");
    expect(textOf(texts, { kind: "node", id: -1 }, "label", "en")).toBeUndefined();
  });
});

/** The basic survey with integer_demo's rules replaced */
const withRules = (rules: DesignRule[]): SurveyDesign => ({
  ...basic,
  pages: basic.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.name === "integer_demo" && i.kind === "question" ? { ...i, rules } : i)) })),
});
const integer = basic.pages.flatMap((p) => p.items).find((i) => i.name === "integer_demo")!;
const rule = (n: number): DesignRule => ({ kind: "length", min: n, max: null, flag: "error", message: { en: `Rule ${n}` }, when: null });
const ruleText = (index: number, r: DesignRule, text: string): PendingText => ({
  target: { kind: "rule", node: integer.id, index },
  part: "message",
  language: "en",
  text,
  current: r.message.en ?? "",
  anchor: ruleAnchor(r),
});

describe("texts typed for what changed meanwhile (review 3)", () => {
  it("drops a text whose question is gone, and says how many", () => {
    const store = new PendingTexts();
    store.set({ ...label("For a deleted question"), target: { kind: "node", id: 99999 } }, title("Kept", "x"));
    expect(store.settle(basic)).toBe(1);
    expect([...store.all().values()].map((p) => p.text)).toEqual(["Kept"]);
  });

  it("drops a rule's message when its place now holds another rule, keeps it when the rule is still there", () => {
    const [a, b, c] = [rule(1), rule(2), rule(3)];
    const store = new PendingTexts();
    store.set(ruleText(1, b, "For rule 2"));
    // Someone else deleted the first rule: place 1 now holds rule 3
    expect(store.settle(withRules([b, c]))).toBe(1);
    expect(store.all().size).toBe(0);
    store.set(ruleText(1, b, "For rule 2"));
    expect(store.settle(withRules([a, b, c]))).toBe(0);
    expect(store.all().size).toBe(1);
  });

  it("moves the texts of the rules after one deleted here up with them", () => {
    const [a, b, c] = [rule(1), rule(2), rule(3)];
    const store = new PendingTexts();
    store.set(ruleText(0, a, "Gone with it"), ruleText(2, c, "For rule 3"));
    expect(store.afterOps([{ op: "deleteRule", id: integer.id, index: 0 }])).toBe(1);
    expect(store.settle(withRules([b, c]))).toBe(0);
    const left = [...store.all().values()];
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "For rule 3", target: { kind: "rule", index: 1 } });
  });

  it("tells a field only when its own text changes", () => {
    const store = new PendingTexts();
    let mine = 0;
    let other = 0;
    store.subscribeKey(editKey({ kind: "title" }, "label", "en"), () => mine++);
    store.subscribeKey(editKey({ kind: "node", id: 8 }, "label", "en"), () => other++);
    store.set(title("A", "x"));
    store.set(title("AB", "x"));
    expect([mine, other]).toEqual([2, 0]);
    store.clear();
    expect([mine, other]).toEqual([3, 0]);
  });
});

describe("a change made again after the survey was read again (review 3)", () => {
  const [a, b, c] = [rule(1), rule(2), rule(3)];
  it("finds a rule again by what it is, never by its place alone", () => {
    const before = withRules([a, b, c]);
    expect(rebaseChange([{ op: "deleteRule", id: integer.id, index: 1 }], before, withRules([b, c]))).toEqual([{ op: "deleteRule", id: integer.id, index: 0 }]);
    // The rule is gone, or there twice: not made again
    expect(rebaseChange([{ op: "deleteRule", id: integer.id, index: 1 }], before, withRules([a, c]))).toBeNull();
    expect(rebaseChange([{ op: "deleteRule", id: integer.id, index: 1 }], before, withRules([b, b]))).toBeNull();
    expect(ruleIndexOf([a, b, c], ruleAnchor(c))).toBe(2);
  });

  it("never makes a move again, nor a change of what is gone", () => {
    expect(rebaseChange([{ op: "moveQuestion", id: integer.id, before: 1303 }], basic, basic)).toBeNull();
    expect(rebaseChange([{ op: "movePage", name: "plot_tab" }], basic, basic)).toBeNull();
    expect(rebaseChange([{ op: "moveItem", list: "demo_codelist", code: "A" }], basic, basic)).toBeNull();
    expect(rebaseChange([{ op: "deleteQuestion", id: 99999 }], basic, basic)).toBeNull();
    expect(rebaseChange([{ op: "deleteItem", list: "demo_codelist", code: "nope" }], basic, basic)).toBeNull();
    expect(rebaseChange([{ op: "moveQuestion", id: integer.id, page: "tab_1312" }], basic, basic)).toEqual([{ op: "moveQuestion", id: integer.id, page: "tab_1312" }]);
    expect(rebaseChange([{ op: "setRequired", id: integer.id, required: true }], basic, basic)).toEqual([{ op: "setRequired", id: integer.id, required: true }]);
  });

  it("tells the same survey changed from another survey put in its place", () => {
    expect(sameSurvey(basic, withRules([a]))).toBe(true);
    const renamed = (q: DesignQuestion): DesignQuestion => ({ ...q, name: `${q.name}_x` });
    const other: SurveyDesign = {
      ...basic,
      pages: basic.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.kind === "question" ? renamed(i) : i)) })),
      fromPlotFile: basic.fromPlotFile.map(renamed),
      calculated: basic.calculated.map(renamed),
      hidden: basic.hidden.map(renamed),
    };
    expect(sameSurvey(basic, other)).toBe(false);
  });

  it("sends with a change only the languages its texts are in", () => {
    expect([...languagesUsed([{ op: "addPage", label: { sw: "Ukurasa" } }, { op: "addRule", id: 1, rule: { kind: "length", min: 1, max: null, flag: "error", when: null, message: { fr: "Trop court" } } as never }])]).toEqual(["sw", "fr"]);
    expect(languagesUsed([{ op: "deleteQuestion", id: 1 }]).size).toBe(0);
  });
});

describe("what the server would refuse, said before (review 3)", () => {
  it("counts the dialogs with something typed", () => {
    const drafts = new Drafts();
    let heard = 0;
    drafts.subscribe(() => heard++);
    drafts.set("a", true);
    drafts.set("a", true);
    drafts.set("b", true);
    drafts.set("a", false);
    expect([drafts.size(), heard]).toEqual([1, 3]);
  });

  it("offers a sub-list only after a choice whose list has answers under its answers", () => {
    const code = basic.pages[0].items.find((i) => i.name === "code_demo") as DesignQuestion;
    const flat = new Map(basic.lists.map((l) => [l.name, l]));
    const questions = new Map([[code.name, code]]);
    expect(subListParents([code], flat, questions)).toEqual([]);
    const deep = new Map(flat).set("demo_codelist", { ...flat.get("demo_codelist")!, items: [{ ...flat.get("demo_codelist")!.items[0], items: [{ code: "A1", label: {}, help: {}, items: [], usedBy: [] } as never] }] });
    expect(subListParents([code], deep, questions)).toEqual([code]);
    // A sub-list itself needs one level more
    const sub = { ...code, name: "sub", parentQuestion: code.name };
    expect(subListParents([sub], deep, new Map([[code.name, code], ["sub", sub]]))).toEqual([]);
    expect(listLevels(deep.get("demo_codelist")!.items)).toBe(2);
  });

  it("finds a page left with no name in any language", () => {
    const page = basic.pages[0];
    const empty = (language: string): PendingText => ({ target: { kind: "page", name: page.name }, part: "label", language, text: " ", current: page.label[language] ?? "" });
    const one: SurveyDesign = { ...basic, pages: basic.pages.map((p, i) => (i === 0 ? { ...p, label: { en: "Plot" } } : p)) };
    const pending = (...texts: PendingText[]) => new Map(texts.map((p) => [editKey(p.target, p.part, p.language), p]));
    expect(namesEmptied(pending(empty("en")), one)).toBe(1);
    expect(namesEmptied(pending(empty("en"), { ...empty("fr"), text: "Parcelle" }), one)).toBe(0);
    expect(namesEmptied(pending(empty("en")), { ...one, pages: one.pages.map((p, i) => (i === 0 ? { ...p, label: { en: "Plot", fr: "Parcelle" } } : p)) })).toBe(0);
  });
});
