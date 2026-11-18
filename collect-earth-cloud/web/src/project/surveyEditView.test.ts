import { describe, expect, it } from "vitest";
import { changedTexts, editKey, isLanguageCode, operationsOf, withText, type PendingText } from "./surveyEditView";

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
