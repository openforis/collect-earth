import { describe, expect, it } from "vitest";
import { CATALOGUES, translator, type MessageKey } from "./i18n";

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("translations", () => {
  it("every language keeps the English placeholders", () => {
    for (const [language, catalogue] of Object.entries(CATALOGUES)) {
      for (const [key, english] of Object.entries(CATALOGUES.en)) {
        expect(placeholders(catalogue[key as MessageKey]), `${language} ${key}`).toBe(placeholders(english));
      }
    }
  });
  it("fills placeholders and falls back to English for other languages", () => {
    expect(translator("es")("progress", { saved: 3, total: 10, pct: 30 })).toBe("3 de 10 completadas (30%)");
    expect(translator("lo")("plots")).toBe("Plots");
    expect(translator("fr")("form.title", { id: "A-1" })).toBe("Parcelle A-1");
  });
});
