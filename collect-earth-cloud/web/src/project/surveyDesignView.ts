// The survey as the designer shows it, in words (docs/plans/2026-11-18-survey-designer.md, stage 1): a condition
// written with the questions' labels and the answers' labels in the language chosen ("shown when Land use is
// Forest"), rules as limits, the texts not translated yet.

import type { ConditionPart, DesignCondition, DesignItem, DesignList, DesignListItem, DesignQuestion, DesignRule, DesignTable, Localized, QuestionType, RuleBound, SurveyDesign } from "../api";
import type { MessageKey, Translate } from "../i18n";

/** A text in the language chosen, else in the survey's default language, else in any it has */
export function textIn(text: Localized, language: string, languages: readonly string[]): string {
  return text[language] || text[languages[0]] || Object.values(text).find((v) => v !== "") || "";
}

/** Everything a page lists, the tables' columns among it */
export function allQuestions(design: SurveyDesign): DesignQuestion[] {
  const fromItems = (items: DesignItem[]) => items.flatMap((i) => (i.kind === "table" ? i.columns : [i]));
  return [...design.pages.flatMap((p) => fromItems(p.items)), ...design.fromPlotFile, ...design.calculated, ...design.hidden];
}

/** What the words need: the survey, the language, its questions and lists by name */
export interface Words {
  design: SurveyDesign;
  language: string;
  t: Translate;
  questions: Map<string, DesignQuestion>;
  lists: Map<string, DesignList>;
}

export function words(design: SurveyDesign, language: string, t: Translate): Words {
  const columns = new Set(design.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === "table" ? i.columns : []))));
  const plots = allQuestions(design).filter((q) => !columns.has(q));
  return {
    design,
    language,
    t,
    // A plot's question after (so over) a table's column of the same name, as the server reads a condition outside tables
    questions: new Map([...columns, ...plots].map((q) => [q.name, q])),
    lists: new Map(design.lists.map((l) => [l.name, l])),
  };
}

/** The words inside a table: a name is the table's own column before any other question of that name */
export function tableWords(w: Words, table: DesignTable): Words {
  return { ...w, questions: new Map([...w.questions, ...table.columns.map((c) => [c.name, c] as const)]) };
}

const local = (w: Words, text: Localized) => textIn(text, w.language, w.design.languages);

/** A question's label, else its internal name */
export function questionLabel(w: Words, name: string): string {
  const q = w.questions.get(name);
  return (q && local(w, q.label)) || name;
}

function findItem(items: DesignListItem[], code: string): DesignListItem | undefined {
  for (const i of items) {
    if (i.code === code) return i;
    const inner = findItem(i.items, code);
    if (inner) return inner;
  }
  return undefined;
}

/** An answer's label: a code as its list's item says it, yes or no, a number */
function valueWords(w: Words, question: string, value: string | number | boolean | null): string {
  if (typeof value === "boolean") return w.t(value ? "survey.yes" : "survey.no");
  if (typeof value === "number") return String(value);
  if (value === null) return "";
  const listName = w.questions.get(question)?.list;
  const item = listName ? findItem(w.lists.get(listName)?.items ?? [], value) : undefined;
  return item ? `“${local(w, item.label) || value}”` : `“${value}”`;
}

export const TEST_KEYS: Record<ConditionPart["test"], MessageKey> = {
  is: "survey.test.is",
  isNot: "survey.test.isNot",
  lt: "survey.test.lt",
  lte: "survey.test.lte",
  gt: "survey.test.gt",
  gte: "survey.test.gte",
  answered: "survey.test.answered",
  notAnswered: "survey.test.notAnswered",
};

/** A condition in words: "Land use is “Forest” and Burnt is yes"; an advanced one as written */
export function conditionWords(w: Words, condition: DesignCondition): string {
  if (condition.kind === "never") return w.t("survey.never");
  if (condition.kind === "advanced") return w.t("survey.advanced", { text: condition.text });
  return condition.parts
    .map((p) => w.t(TEST_KEYS[p.test], { question: questionLabel(w, p.question), value: valueWords(w, p.question, p.value) }))
    .join(w.t(condition.kind === "any" ? "survey.or" : "survey.and"));
}

function boundWords(w: Words, bound: RuleBound): string {
  if ("number" in bound) return String(bound.number);
  if ("question" in bound) return w.t("survey.rule.question", { question: questionLabel(w, bound.question) });
  return bound.expression;
}

/** A rule in words: "The answer must be more than 5 and less than 20, when…" */
export function ruleWords(w: Words, rule: DesignRule): string {
  let text: string;
  if (rule.kind === "range") {
    const limits: string[] = [];
    if (rule.min) limits.push(w.t(rule.min.inclusive ? "survey.rule.gte" : "survey.rule.gt", { value: boundWords(w, rule.min.bound) }));
    if (rule.max) limits.push(w.t(rule.max.inclusive ? "survey.rule.lte" : "survey.rule.lt", { value: boundWords(w, rule.max.bound) }));
    text = w.t(rule.flag === "warning" ? "survey.rule.should" : "survey.rule.must", { limits: limits.join(w.t("survey.and")) });
  } else if (rule.kind === "length") {
    const limits: string[] = [];
    if (rule.min !== null) limits.push(w.t("survey.rule.gte", { value: w.t("survey.rule.chars", { value: rule.min }) }));
    if (rule.max !== null) limits.push(w.t("survey.rule.lte", { value: w.t("survey.rule.chars", { value: rule.max }) }));
    text = w.t(rule.flag === "warning" ? "survey.rule.lengthShould" : "survey.rule.length", { limits: limits.join(w.t("survey.and")) });
  } else if (rule.kind === "total") {
    const value = String(rule.total);
    const total = w.t(rule.test === "atLeast" ? "survey.rule.gte" : rule.test === "atMost" ? "survey.rule.lte" : "survey.rule.exactly", { value });
    text = w.t(rule.flag === "warning" ? "survey.rule.totalShould" : "survey.rule.total", { total });
  } else {
    text = w.t("survey.rule.advanced", { text: rule.text });
  }
  return rule.when ? w.t("survey.rule.when", { rule: text, condition: conditionWords(w, rule.when) }) : text;
}

/** "Required", "Required when…", or null */
export function requiredWords(w: Words, q: DesignQuestion): string | null {
  if (q.required === "always") return w.t("survey.required");
  if (q.required === "never") return null;
  return w.t("survey.requiredWhen", { condition: conditionWords(w, q.required.when) });
}

export const TYPE_KEYS: Record<QuestionType, MessageKey> = {
  choice: "survey.type.choice",
  choices: "survey.type.choices",
  yesNo: "survey.type.yesNo",
  integer: "survey.type.integer",
  decimal: "survey.type.decimal",
  text: "survey.type.text",
  memo: "survey.type.memo",
  date: "survey.type.date",
  time: "survey.type.time",
  range: "survey.type.range",
  coordinate: "survey.type.coordinate",
  species: "survey.type.species",
  file: "survey.type.file",
};

/** The texts that have no translation into a language: labels, help texts, list items, rule messages */
export function untranslated(design: SurveyDesign, language: string): number {
  let missing = 0;
  const count = (text: Localized) => {
    if (Object.values(text).some((v) => v !== "") && !text[language]) missing++;
  };
  for (const p of design.pages) {
    count(p.label);
    for (const i of p.items) if (i.kind === "table") count(i.label);
  }
  for (const q of allQuestions(design)) {
    if (q.hidden || q.formulas) continue; // nobody reads them in the form
    count(q.label);
    count(q.help);
    for (const r of q.rules) count(r.message);
  }
  const items = (list: DesignListItem[]) => {
    for (const i of list) {
      count(i.label);
      items(i.items);
    }
  };
  for (const l of design.lists) if (l.usedBy.some((n) => !(design.calculated.some((c) => c.name === n)))) items(l.items);
  return missing;
}

/** The language to show first: the dashboard's when the survey has it, else the survey's own */
export function firstLanguage(design: SurveyDesign, uiLanguage: string): string {
  return design.languages.includes(uiLanguage) ? uiLanguage : design.languages[0];
}
