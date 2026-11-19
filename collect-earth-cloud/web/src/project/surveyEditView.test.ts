import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surveyDesign } from "../../../src/survey/design";
import { changedTexts, editKey, PendingTexts, surveyTexts, textOf, withPendingTexts, isItemCode, isLanguageCode, itemsFromLines, moveTarget, operationsOf, pageMoveTarget, slugName, uniqueName, withText, type PendingText } from "./surveyEditView";

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
