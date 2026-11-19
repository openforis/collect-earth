import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surveyDesign } from "../../../src/survey/design";
import type { DesignTable, SurveyCheckCode } from "../api";
import { CATALOGUES, LANGUAGES, translator, type MessageKey } from "../i18n";
import { checkWords, conditionWords, firstLanguage, refusalWords, languageNames, questionLabel, questionUsers, usersOfQuestion, usersOfTable, requiredWords, ruleWords, tableWords, textIn, untranslated, words } from "./surveyDesignView";

const template = (name: string) =>
  surveyDesign(readFileSync(new URL(`../../../templates/collect_earth${name}.idm.xml`, import.meta.url)));
const basic = template("");
const ipcc = template("_ipcc");
const en = words(basic, "en", translator("en"));
const question = (name: string) => en.questions.get(name)!;

describe("the survey in words", () => {
  it("names a table's own column before another question of the same name", () => {
    const mp = words(template("_multipurpose"), "en", translator("en"));
    const change = mp.design.pages.flatMap((p) => p.items).find((i) => i.name === "change") as DesignTable;
    expect(questionLabel(mp, "canopy_cover")).toBe("Canopy cover");
    expect(questionLabel(tableWords(mp, change), "canopy_cover")).toBe("Canopy cover before");
  });

  it("takes a text in the language chosen, else the survey's first", () => {
    expect(textIn({ en: "Plot", es: "Parcela" }, "es", ["en", "es"])).toBe("Parcela");
    expect(textIn({ en: "Plot" }, "fr", ["en", "fr"])).toBe("Plot");
    expect(textIn({ es: "Parcela" }, "fr", ["en", "fr"])).toBe("Parcela");
    expect(textIn({}, "fr", ["en"])).toBe("");
  });

  it("writes a condition with the questions' and answers' labels", () => {
    expect(conditionWords(en, question("memo_text_demo").shownWhen!)).toBe("Demo Yes/No question (shows comments if YES) is yes");
    expect(requiredWords(en, question("demo_date"))).toBe("Required when Demo Code attribute - Multiple options (Required) is “Second Option B”");
    expect(requiredWords(en, question("code_demo"))).toBe("Required");
    expect(requiredWords(en, question("short_text_demo"))).toBeNull();
    const es = words(basic, "es", translator("es"));
    expect(requiredWords(es, question("demo_date"))).toBe("Obligatoria cuando Demo - Atributo de código - Múltiples opciones (obligatorio) es “Segunda Opción B”");
  });

  it("writes rules as limits, and the others as written", () => {
    expect(ruleWords(en, question("integer_demo").rules[0])).toBe("The answer must be more than 5 and less than 20");
    expect(ruleWords(en, question("short_text_demo").rules[0])).toBe("The answer must have at least 6 characters");
    expect(ruleWords(en, { flag: "warning", message: {}, when: null, kind: "total", test: "atMost", total: 100 })).toBe("The column should add up to at most 100 (a warning)");
    expect(ruleWords(en, { flag: "error", message: {}, when: null, kind: "advanced", text: "a != b", expression: true })).toBe("Rule: a != b");
    const w = words(ipcc, "en", translator("en"));
    const year = w.questions.get("second_lu_conversion_year")!;
    expect(ruleWords(w, year.rules[0])).toBe(
      `The answer must be more than 1980 and less than the answer to “${questionLabel(w, "land_use_subcategory_year_of_change")}”, when ${questionLabel(w, "land_use_category_has_changed")} is yes`,
    );
  });

  it("writes an advanced condition as it is, and never as never", () => {
    expect(conditionWords(en, { kind: "advanced", text: "starts-with(x, 'P')" })).toBe("an advanced condition (starts-with(x, 'P'))");
    expect(conditionWords(en, { kind: "never" })).toBe("never");
    expect(conditionWords(en, { kind: "any", parts: [{ question: "code_demo", test: "isNot", value: "A" }, { question: "integer_demo", test: "gte", value: 3 }] })).toBe(
      "Demo Code attribute - Multiple options (Required) is not “First Option A” or Demo - integer number (required | >5 and <20) is at least 3",
    );
  });

  it("counts what is not translated into a language", () => {
    expect(untranslated(basic, "en")).toBe(0);
    expect(untranslated(basic, "xx")).toBeGreaterThan(20);
    const one = untranslated(basic, "es");
    expect(one).toBeGreaterThanOrEqual(0);
    expect(one).toBeLessThan(untranslated(basic, "xx"));
  });

  it("starts in the dashboard's language when the survey has it", () => {
    expect(firstLanguage(basic, "fr")).toBe("fr");
    expect(firstLanguage(basic, "tr")).toBe("en");
  });
});

describe("the survey check's problems", () => {
  // Every code the server's check gives (src/survey/check.ts): a code added there without words here fails the typecheck
  const CODES = {
    syntax: true, unknownFunction: true, argumentCount: true, unknownQuestion: true, unknownField: true, insideField: true,
    insideQuestion: true, aboveThePlot: true, unknownVariable: true, noPlot: true, rootName: true, missingField: true,
    fieldKind: true, noKey: true, tooManyKeys: true, listTwice: true, codeTwice: true, questionTwice: true, badName: true,
    nameSuffix: true, longName: true, nestedTable: true, unknownList: true,
  } satisfies Record<SurveyCheckCode, true>;

  it("are worded in every language, with their values", () => {
    for (const language of LANGUAGES) {
      for (const code of Object.keys(CODES)) {
        const key = `surveyCheck.${code}` as MessageKey;
        expect(CATALOGUES[language][key], `${language} ${key}`).toBeTruthy();
      }
    }
    expect(translator("es")("surveyCheck.unknownQuestion", { name: "lu", in: "plot" })).toBe("No hay ninguna pregunta lu en plot.");
  });
});

describe("what keeps a question or table from being deleted", () => {
  it("lists the questions whose conditions, rules or formulas name it", () => {
    const users = questionUsers(ipcc);
    const all = ipcc.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === "table" ? [i, ...i.columns] : [i])));
    const byName = (name: string) => all.find((i) => i.name === name)!;
    expect(users.get("plot_distribution")).toEqual(expect.arrayContaining(["land_use", "land_use_whole_plot"]));
    // An advanced condition's words count too
    expect(users.get("land_use_subcategory")).toContain("land_use_subdivision_year_of_change");
    const forest = byName("forest_dynamics");
    expect(forest.kind === "question" && usersOfQuestion(users, forest)).toEqual(expect.arrayContaining(["previous_tree_cover", "degradation_year"]));
    // A question nothing names can go
    const last = byName("increase_year");
    expect(last.kind === "question" && usersOfQuestion(users, last)).toEqual([]);
  });

  it("leaves out what a table's own columns name", () => {
    const users = questionUsers(ipcc);
    const table = ipcc.pages.flatMap((p) => p.items).find((i): i is DesignTable => i.kind === "table" && i.name === "land_use")!;
    expect(usersOfTable(users, table).some((n) => table.columns.some((c) => c.name === n))).toBe(false);
  });

  it("reads a formula's names, not the functions it calls", () => {
    const users = questionUsers(basic);
    for (const c of basic.calculated) for (const n of c.uses) expect(users.get(n)).toContain(c.name);
    expect(users.has("idm:lookup")).toBe(false);
  });
});

describe("a language's name", () => {
  it("is said in the dashboard's language, a code it does not know as it is", () => {
    expect(languageNames("en")("es")).toBe("Spanish");
    expect(languageNames("fr")("pt_BR")).toMatch(/portugais/i);
    expect(languageNames("en")("not a code")).toBe("not a code");
  });
});

describe("the server's refusals and the check's syntax, in the dashboard's language", () => {
  const es = translator("es");
  const fr = translator("fr");
  it("words a refusal from its code and values; none for one without a code", () => {
    expect(refusalWords(es, "gone", { what: "question", name: "trees" })).toContain("La pregunta trees ya no está");
    expect(refusalWords(fr, "nameTaken", { what: "list", name: "colours" })).toContain("liste de réponses nommée colours");
    expect(refusalWords(es, "inUse", { name: "A", users: "q1, q2" })).toBe("A se usa en q1, q2: cambie eso primero.");
    expect(refusalWords(es, "tooMany")).toContain("Demasiados cambios");
    expect(refusalWords(es, "gone", { what: "elephant", name: "x" })).toBeNull();
    expect(refusalWords(es, undefined)).toBeNull();
    expect(refusalWords(es, "somethingNew")).toBeNull();
  });

  it("words why an expression cannot be read, and where", () => {
    expect(checkWords(es, "syntax", { detail: "A text in quotes is not closed (at 5).", reason: "unclosedQuote", at: "5", token: "" })).toBe(
      "La expresión no se puede leer: Un texto entre comillas no está cerrado (en el carácter 5)",
    );
    expect(checkWords(fr, "syntax", { detail: "x", reason: "missing", at: "", token: ")" })).toBe("L'expression ne peut pas être lue : « ) » manque (à la fin)");
    // From an older server: its English detail as it is
    expect(checkWords(es, "syntax", { detail: "Something odd" })).toBe("La expresión no se puede leer: Something odd");
    expect(refusalWords(es, "expression", { problem: "syntax", reason: "empty", at: "", token: "", detail: "x" })).toBe("La expresión no se puede leer: La expresión está vacía (al final)");
  });

  it("has every reason and refusal in every language", () => {
    for (const language of LANGUAGES) {
      const catalogue = CATALOGUES[language] as Record<string, string>;
      for (const key of Object.keys(CATALOGUES.en).filter((k) => k.startsWith("survey.refusal.") || k.startsWith("surveyCheck.why.") || k.startsWith("surveyCheck.where."))) {
        expect(catalogue[key], `${language} ${key}`).toBeTruthy();
      }
    }
  });
});
