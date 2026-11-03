import { describe, expect, it } from "vitest";
import { CATALOGUES, LANGUAGES, pickLanguage, translator, type MessageKey } from "./i18n";

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("translations", () => {
  const english = Object.keys(CATALOGUES.en).sort();

  it.each(LANGUAGES)("%s has exactly the English keys, none empty", (language) => {
    const catalogue = CATALOGUES[language];
    expect(Object.keys(catalogue).sort()).toEqual(english);
    for (const key of english) expect(catalogue[key as MessageKey].trim(), `${language} ${key}`).not.toBe("");
  });

  it.each(LANGUAGES)("%s keeps the English placeholders", (language) => {
    for (const [key, text] of Object.entries(CATALOGUES.en)) {
      expect(placeholders(CATALOGUES[language][key as MessageKey]), `${language} ${key}`).toBe(placeholders(text));
    }
  });

  it.each(LANGUAGES)("%s tells collectors what coordinators see, on the join page and My work alike", (language) => {
    const catalogue = CATALOGUES[language];
    const join = catalogue["join.coordinatorsSee"];
    const myWork = catalogue["myWork.coordinatorsSee"];
    // The join page names the My work page as the dashboard calls it.
    expect(join).toContain(`"${catalogue["myWork.link"]}"`);
    // Both start with the same sentence about what coordinators see.
    const first = (text: string) => text.slice(0, text.indexOf(".") + 1);
    expect(first(join).length).toBeGreaterThan(20);
    expect(first(myWork)).toBe(first(join));
  });

  it("fills placeholders and falls back to English", () => {
    expect(translator("es")("overview.stepsDone", { done: 2, total: 5 })).toBe("2 de 5 pasos hechos");
    expect(translator("de")("nav.logout")).toBe("Log out");
    expect(translator("fr")("account.loggedInAs", { name: "ana" })).toBe("Connecté en tant que ana");
    expect(translator("pt")("people.inviteRow", { role: "Coletor", used: 1 })).toBe("Coletor · usado por 1 de {max}");
  });
});

describe("pickLanguage", () => {
  it("prefers the language chosen before", () => {
    expect(pickLanguage("pt", ["fr-FR"])).toBe("pt");
  });
  it("uses the first supported browser language", () => {
    expect(pickLanguage(null, ["de-DE", "es-419", "fr"])).toBe("es");
    expect(pickLanguage("xx", ["FR-ca"])).toBe("fr");
  });
  it("falls back to English", () => {
    expect(pickLanguage(null, ["de", "ja"])).toBe("en");
    expect(pickLanguage(null, [])).toBe("en");
  });
});
