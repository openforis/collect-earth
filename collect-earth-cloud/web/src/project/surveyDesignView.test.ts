import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surveyDesign } from "../../../src/survey/design";
import { translator } from "../i18n";
import { conditionWords, firstLanguage, questionLabel, requiredWords, ruleWords, textIn, untranslated, words } from "./surveyDesignView";

const template = (name: string) =>
  surveyDesign(readFileSync(new URL(`../../../test/fixtures/templates/collect_earth${name}.idm.xml`, import.meta.url)));
const basic = template("");
const ipcc = template("_ipcc");
const en = words(basic, "en", translator("en"));
const question = (name: string) => en.questions.get(name)!;

describe("the survey in words", () => {
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
    expect(ruleWords(en, question("short_text_demo").rules[0])).toBe("Rule: string-length($this) > 5");
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
