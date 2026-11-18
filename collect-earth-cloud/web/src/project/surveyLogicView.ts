// The survey designer's logic builder (docs/plans/2026-11-18-survey-designer.md, stage 4): conditions as rows of
// question, test and answer, and rules as limits, edited as text in the form's fields and turned into what the
// server writes Collect's expressions from (it checks them again). The same tests per kind of question as the
// server's (src/survey/logic.ts testsFor).

import type {
  ConditionPart,
  ConditionRows,
  DesignCondition,
  DesignListItem,
  DesignQuestion,
  DesignRule,
  DesignTable,
  NewRule,
  NewRuleLimit,
  QuestionType,
  SurveyDesign,
  TotalTest,
} from "../api";
import { allQuestions } from "./surveyDesignView";

export type ConditionTest = ConditionPart["test"];

/** The tests a row can make on a question of each kind */
export function testsFor(type: QuestionType): ConditionTest[] {
  switch (type) {
    case "choice":
    case "choices":
    case "yesNo":
    case "text":
    case "memo":
      return ["is", "isNot", "answered", "notAnswered"];
    case "integer":
    case "decimal":
      return ["is", "isNot", "lt", "lte", "gt", "gte", "answered", "notAnswered"];
    default:
      return ["answered", "notAnswered"];
  }
}

/** Whether a test compares with an answer (a value to give) */
export const needsValue = (test: ConditionTest) => test !== "answered" && test !== "notAnswered";

/**
 * The questions a condition of a node can name, as Collect reaches them: the columns of its own table first, then the
 * plot's questions; not the node itself (`self`), nor the fields Collect Earth fills in
 */
export function conditionQuestions(design: SurveyDesign, table: DesignTable | null, self: string | null): DesignQuestion[] {
  const columns = new Set(design.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === "table" ? i.columns : []))));
  const plot = allQuestions(design).filter((q) => !columns.has(q));
  return [...(table?.columns ?? []), ...plot].filter((q) => !q.fixed && q.name !== self);
}

/** A row as its fields hold it: the answer as typed or picked */
export interface RowDraft {
  question: string;
  test: ConditionTest;
  value: string;
}

export interface ConditionDraft {
  kind: "all" | "any";
  rows: RowDraft[];
}

const valueText = (v: ConditionPart["value"]) => (v === null ? "" : String(v));

/** The rows of a condition, to change them; null for one the rows cannot say (advanced, never) */
export function draftOf(condition: DesignCondition | null | undefined): ConditionDraft | null {
  if (!condition || (condition.kind !== "all" && condition.kind !== "any")) return null;
  return { kind: condition.kind, rows: condition.parts.map((p) => ({ question: p.question, test: p.test, value: valueText(p.value) })) };
}

/** A new row on a question: its first test, no answer yet */
export function newRow(q: DesignQuestion | undefined): RowDraft {
  if (!q) return { question: "", test: "answered", value: "" };
  const test = testsFor(q.type)[0];
  return { question: q.name, test, value: q.type === "yesNo" ? "true" : "" };
}

/** A number as typed, with a comma or a point; NaN when it is not one */
export function parseNumber(text: string): number {
  const t = text.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** The row the server takes, or null while it is not complete */
export function partOf(row: RowDraft, q: DesignQuestion | undefined): ConditionPart | null {
  if (!q || !testsFor(q.type).includes(row.test)) return null;
  if (!needsValue(row.test)) return { question: q.name, test: row.test, value: null };
  switch (q.type) {
    case "yesNo":
      return row.value === "true" || row.value === "false" ? { question: q.name, test: row.test, value: row.value === "true" } : null;
    case "integer":
    case "decimal": {
      const n = parseNumber(row.value);
      return Number.isNaN(n) ? null : { question: q.name, test: row.test, value: n };
    }
    default:
      return row.value === "" ? null : { question: q.name, test: row.test, value: row.value };
  }
}

/** The condition the server takes, or null while a row is not complete */
export function rowsOf(draft: ConditionDraft, questions: ReadonlyMap<string, DesignQuestion>): ConditionRows | null {
  if (draft.rows.length === 0) return null;
  const parts = draft.rows.map((r) => partOf(r, questions.get(r.question)));
  return parts.every((p): p is ConditionPart => p !== null) ? { kind: draft.kind, parts } : null;
}

/** Every answer of a list, at every level, in order */
export function listOptions(items: readonly DesignListItem[]): DesignListItem[] {
  return items.flatMap((i) => [i, ...listOptions(i.items)]);
}

export type RuleKind = "range" | "length" | "total" | "expression";

/** The rules the builder makes for a question: a number's range (and a table's total), a text's length */
export function ruleKinds(q: DesignQuestion, table: DesignTable | null): RuleKind[] {
  if (q.fixed || q.formulas || q.hidden || q.fromPlotFile) return [];
  // Any question's rule can be written as an expression (stage 7)
  if (q.type === "integer" || q.type === "decimal") return table && table.layout !== "group" ? ["range", "total", "expression"] : ["range", "expression"];
  if (q.type === "text" || q.type === "memo") return ["length", "expression"];
  return ["expression"];
}

/** Whether the builder can change a rule as it is (else it can only be deleted) */
export const builderRule = (rule: DesignRule) =>
  rule.kind === "length" || rule.kind === "total" || (rule.kind === "advanced" && rule.expression) || (rule.kind === "range" && [rule.min, rule.max].every((l) => !l || !("expression" in l.bound)));

export interface LimitDraft {
  mode: "none" | "number" | "question";
  number: string;
  question: string;
  inclusive: boolean;
}

/** A rule as its fields hold it */
export interface RuleDraft {
  kind: RuleKind;
  flag: "error" | "warning";
  message: string;
  onlyWhen: boolean;
  when: ConditionDraft;
  min: LimitDraft;
  max: LimitDraft;
  minChars: string;
  maxChars: string;
  totalTest: TotalTest;
  total: string;
  /** A rule written as an expression: the expression the answer must make true, and its condition written so */
  expressionText: string;
  whenText: string;
}

const noLimit: LimitDraft = { mode: "none", number: "", question: "", inclusive: true };

function limitDraft(limit: { bound: { number: number } | { question: string } | { expression: string }; inclusive: boolean } | null): LimitDraft {
  if (!limit) return noLimit;
  if ("number" in limit.bound) return { mode: "number", number: String(limit.bound.number), question: "", inclusive: limit.inclusive };
  if ("question" in limit.bound) return { mode: "question", number: "", question: limit.bound.question, inclusive: limit.inclusive };
  return noLimit;
}

/** The fields of a rule: a rule to change, or a new one of the first kind the question takes */
export function ruleDraftOf(rule: DesignRule | null, kinds: readonly RuleKind[], message: string): RuleDraft {
  const when = draftOf(rule?.when) ?? { kind: "all" as const, rows: [] };
  const base: RuleDraft = {
    kind: kinds[0] ?? "range",
    flag: rule?.flag ?? "error",
    message,
    onlyWhen: when.rows.length > 0,
    when,
    min: noLimit,
    max: noLimit,
    minChars: "",
    maxChars: "",
    totalTest: "atMost",
    total: "",
    expressionText: "",
    whenText: "",
  };
  if (!rule) return base;
  switch (rule.kind) {
    case "range":
      return { ...base, kind: "range", min: limitDraft(rule.min), max: limitDraft(rule.max) };
    case "length":
      return { ...base, kind: "length", minChars: rule.min === null ? "" : String(rule.min), maxChars: rule.max === null ? "" : String(rule.max) };
    case "total":
      return { ...base, kind: "total", totalTest: rule.test, total: String(rule.total) };
    case "advanced":
      return {
        ...base,
        kind: "expression",
        expressionText: rule.text,
        whenText: rule.when?.kind === "advanced" ? rule.when.text : "",
      };
    default:
      return base;
  }
}

/** A limit the server takes: null for none, undefined while it is not complete */
function limitOf(l: LimitDraft): NewRuleLimit | null | undefined {
  if (l.mode === "none") return null;
  if (l.mode === "question") return l.question ? { bound: { question: l.question }, inclusive: l.inclusive } : undefined;
  const n = parseNumber(l.number);
  return Number.isNaN(n) ? undefined : { bound: { number: n }, inclusive: l.inclusive };
}

/** A whole number of characters, null for none, undefined when it is not one */
function charsOf(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
}

/**
 * The rule the server takes, with no message yet (the dialog gives it), or null while it is not complete: a range or
 * a length needs a limit, a total its number, "only when" its rows
 */
export function ruleOf(draft: RuleDraft, questions: ReadonlyMap<string, DesignQuestion>): NewRule | null {
  let when: ConditionRows | null = null;
  if (draft.onlyWhen) {
    when = rowsOf(draft.when, questions);
    if (!when) return null;
  }
  const base = { flag: draft.flag, when, message: {} };
  switch (draft.kind) {
    case "range": {
      const min = limitOf(draft.min);
      const max = limitOf(draft.max);
      if (min === undefined || max === undefined || (min === null && max === null)) return null;
      return { ...base, kind: "range", min, max };
    }
    case "length": {
      const min = charsOf(draft.minChars);
      const max = charsOf(draft.maxChars);
      if (min === undefined || max === undefined || (min === null && max === null)) return null;
      return { ...base, kind: "length", min, max };
    }
    case "total": {
      const total = parseNumber(draft.total);
      return Number.isNaN(total) ? null : { ...base, kind: "total", test: draft.totalTest, total };
    }
    case "expression": {
      const text = draft.expressionText.trim();
      const whenText = draft.whenText.trim();
      return text === "" ? null : { ...base, kind: "expression", text, ...(whenText !== "" ? { whenText } : {}) };
    }
  }
}

/** The questions a range can compare with: the numbers a condition of the question could name */
export function numberQuestions(candidates: readonly DesignQuestion[]): DesignQuestion[] {
  return candidates.filter((q) => q.type === "integer" || q.type === "decimal");
}
