import { describe, expect, it } from "vitest";
import { changedTexts, editKey, isItemCode, isLanguageCode, itemsFromLines, moveTarget, operationsOf, pageMoveTarget, slugName, uniqueName, withText, type PendingText } from "./surveyEditView";

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
