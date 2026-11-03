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
    // Reviewers (who also collect) see answers too: both texts say so.
    for (const text of [join, myWork]) expect(text).toContain(catalogue["role.reviewer"].toLowerCase().slice(0, 6));
  });

  // The desktop's own labels (collect-earth-app Messages*.properties), as its settings page shows them: the
  // Properties menu (CollectEarthWindow.15), the "Project" section (SettingsPage.section.project), "Refresh
  // assignments" (English in every language) and "Apply" (SettingsPage.apply).
  const desktop = {
    en: ["Properties → “Project”", "“Apply”"],
    es: ["Propiedades → «Proyecto»", "«Aplicar»"],
    fr: ["Propriétés → « Projet »", "« Appliquer »"],
    pt: ["Propriedades → “Projeto”", "“Aplicar”"],
  } as const;
  it.each(LANGUAGES)("%s names the desktop's real path to a new plot file", (language) => {
    const catalogue = CATALOGUES[language];
    for (const key of ["plots.assignSaved", "checks.explain", "person.sentBackFile", "divide.applied", "divide.moved", "reference.added", "reference.blind"] as const) {
      const text = catalogue[key];
      expect(text, `${language} ${key}`).toContain("Refresh assignments");
      for (const label of desktop[language]) expect(text, `${language} ${key}`).toContain(label);
    }
    expect(catalogue["reference.collectors"]).toContain("Refresh assignments");
    // No text names the Swing screens the settings page replaced, nor a plain "Refresh" in "the plot settings".
    for (const [key, text] of Object.entries(catalogue)) expect(text, `${language} ${key}`).not.toMatch(/Sample data|Datos de muestra|Points d'échantillonnage|Dados de amostra|Save & Apply|Assigned plot file:/);
    for (const [key, text] of Object.entries(catalogue)) expect(text, `${language} ${key}`).not.toMatch(/plot settings|ajustes de parcelas|configuración de parcelas|réglages des parcelles|configurações de parcelas/);
  });

  it.each(LANGUAGES)("%s: quiet means more than N days without a sync or a plot download", (language) => {
    const t = translator(language);
    const more = { en: "more than", es: "más de", fr: "plus de", pt: "mais de" }[language];
    for (const key of ["attention.quiet", "attention.quietOne", "attention.quietTitle", "progressSettings.quietDaysHelp"] as const) {
      expect(t(key, { count: 2, days: 3 }), `${language} ${key}`).toContain(more);
    }
    expect(t("attention.quiet", { count: 2, days: 3 })).not.toMatch(/(^|s)(or more|o más|ou plus|ou mais)/);
  });

  it("one term per language: parcelle, Avance, Andamento, usted, pesquisa, courriel", () => {
    const values = (language: keyof typeof CATALOGUES) => Object.values(CATALOGUES[language]).join("\n");
    expect(values("fr")).not.toMatch(/placette/i);
    expect(values("fr")).not.toMatch(/e-mail/i);
    expect(values("es")).not.toMatch(/pestaña Progreso/);
    expect(values("pt")).not.toMatch(/Progresso/);
    expect(values("pt")).not.toMatch(/questionário/);
    // Spanish uses "usted": no "tu", "tus", "tú" nor the imperatives the review found.
    expect(values("es")).not.toMatch(/(^|[^\p{L}])(tu|tus|tú|Abre|vuelve a descargar)(?![\p{L}])/u);
    // The desktop's menu has three dots.
    for (const language of LANGUAGES) expect(values(language)).not.toContain("Join cloud project…");
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
