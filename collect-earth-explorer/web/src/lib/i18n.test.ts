import { describe, it, expect } from "vitest";
import { DICTIONARIES, LANGS, lang, monthNames, pickLang, t, tn, type Key } from "./i18n";

const keys = (l: (typeof LANGS)[number]) => Object.keys(DICTIONARIES[l]).sort();
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  it.each(LANGS)("%s has exactly the English keys and no empty text", (l) => {
    expect(keys(l)).toEqual(keys("en"));
    for (const [key, text] of Object.entries(DICTIONARIES[l])) expect(text.trim(), key).not.toBe("");
  });

  it.each(LANGS)("%s keeps every {placeholder} of the English text", (l) => {
    for (const key of keys("en") as Key[]) expect(placeholders(DICTIONARIES[l][key]), `${l} ${key}`).toEqual(placeholders(DICTIONARIES.en[key]));
  });
});

describe("pickLang", () => {
  it("takes the first browser language among the five, by its primary subtag", () => {
    expect(pickLang(["pt-BR", "en"])).toBe("pt");
    expect(pickLang(["de", "tr-TR"])).toBe("tr");
    expect(pickLang(["FR_ca"])).toBe("fr");
    expect(pickLang(["es-419", "fr"])).toBe("es");
  });

  it("falls back to English", () => {
    expect(pickLang(["de"])).toBe("en");
    expect(pickLang([])).toBe("en");
    expect(pickLang([undefined])).toBe("en");
    expect(pickLang(undefined)).toBe("en");
  });

  it("is English in jsdom", () => expect(lang).toBe("en"));
});

describe("t", () => {
  it("fills the placeholders, in the language asked for", () => {
    expect(t("plot.title", { id: "P1" })).toBe("Plot P1");
    expect(t("plot.dates", { start: "2020-01-01", end: "2021-01-01" }, "es")).toBe("del 2020-01-01 al 2021-01-01");
  });

  it("chooses the plural form by the language's rule", () => {
    expect(tn("chart.unusual", 1)).toBe("1 unusually low observation (red)");
    expect(tn("chart.unusual", 3)).toBe("3 unusually low observations (red)");
    // French counts 0 as singular.
    expect(tn("chart.unusual", 0, "fr")).toBe("0 observation anormalement basse (en rouge)");
  });

  it("names the months in the language", () => {
    expect(monthNames("long")[0]).toBe("January");
    expect(monthNames("long", "es")[0]).toBe("enero");
    expect(monthNames("long", "tr")[11]).toBe("Aralık");
  });
});
