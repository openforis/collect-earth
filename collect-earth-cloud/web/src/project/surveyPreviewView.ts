// The survey's preview (docs/plans/2026-11-18-survey-designer.md, stage 6, "Preview" 1): the form as a person
// collecting meets it, reacting to the answers typed in it. The conditions and rules the builder can say (rows,
// ranges, lengths, totals) are evaluated here, as the server's impact does on the records (src/survey/impact.ts); an
// advanced one is not (its question counts as shown, its rule as passed), and calculated values are not calculated.

import type { ConditionPart, DesignCondition, DesignItem, DesignListItem, DesignQuestion, DesignRule, DesignTable, SurveyDesign } from "../api";

/** An answer as the preview holds it: a code, codes, "true"/"false", a number or a text as typed */
export type Answer = string | string[];

/** The answers typed: the plot's by question, and each table's by row (its list's code) then column */
export interface Answers {
  plot: Record<string, Answer>;
  rows: Record<string, Record<string, Record<string, Answer>>>;
}

export const noAnswers = (): Answers => ({ plot: {}, rows: {} });

/** Where a question is read from: a table's row (its own answers first), or the plot */
export interface Place {
  table?: DesignTable;
  row?: string;
}

const blank = (a: Answer | undefined) => a === undefined || (Array.isArray(a) ? a.length === 0 : a.trim() === "");

/** A question's answer, named from a place as Collect reads it: the row's own column first, then the plot's */
export function answerOf(answers: Answers, name: string, place: Place): Answer | undefined {
  if (place.table && place.row !== undefined && place.table.columns.some((c) => c.name === name)) {
    return answers.rows[place.table.name]?.[place.row]?.[name];
  }
  return answers.plot[name];
}

const number = (a: Answer | undefined) => (a === undefined || Array.isArray(a) || a.trim() === "" ? NaN : Number(a.trim().replace(",", ".")));

/** Whether a row of a condition holds */
export function holds(part: ConditionPart, a: Answer | undefined, type: DesignQuestion["type"] | undefined): boolean {
  if (part.test === "answered") return !blank(a);
  if (part.test === "notAnswered") return blank(a);
  if (type === "choice" || type === "choices") {
    const codes = a === undefined ? [] : Array.isArray(a) ? a : [a];
    const has = codes.includes(String(part.value));
    return part.test === "is" ? has : part.test === "isNot" ? !has : false;
  }
  if (type === "yesNo") {
    const same = !blank(a) && (a === "true") === part.value;
    return part.test === "is" ? same : part.test === "isNot" ? !same : false;
  }
  if (type === "integer" || type === "decimal") {
    const n = number(a);
    const v = Number(part.value);
    switch (part.test) {
      case "is": return n === v;
      case "isNot": return n !== v;
      case "lt": return n < v;
      case "lte": return n <= v;
      case "gt": return n > v;
      case "gte": return n >= v;
    }
    return false;
  }
  const same = !Array.isArray(a) && a === part.value;
  return part.test === "is" ? same : part.test === "isNot" ? !same : false;
}

/** Whether a condition holds; null for one the preview cannot evaluate (advanced) */
export function conditionHolds(
  condition: DesignCondition,
  answers: Answers,
  place: Place,
  typeOf: (name: string) => DesignQuestion["type"] | undefined,
): boolean | null {
  if (condition.kind === "never") return false;
  if (condition.kind === "advanced") return null;
  const results = condition.parts.map((p) => holds(p, answerOf(answers, p.question, place), typeOf(p.question)));
  return condition.kind === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** The words of the survey the preview needs: every question by name (a table's columns among them) */
export function typesOf(design: SurveyDesign): (name: string) => DesignQuestion["type"] | undefined {
  const types = new Map<string, DesignQuestion["type"]>();
  for (const q of [...design.fromPlotFile, ...design.calculated, ...design.hidden]) types.set(q.name, q.type);
  for (const p of design.pages) {
    for (const i of p.items) {
      if (i.kind === "table") for (const c of i.columns) types.set(c.name, c.type);
      else types.set(i.name, i.type);
    }
  }
  return (name) => types.get(name);
}

/** Whether an item is shown: its condition, when the preview can say (an advanced one shows it) */
export function isShown(item: DesignItem, answers: Answers, place: Place, typeOf: (name: string) => DesignQuestion["type"] | undefined): boolean {
  if (!item.shownWhen) return true;
  return conditionHolds(item.shownWhen, answers, item.kind === "table" ? {} : place, typeOf) !== false;
}

/** Whether a question shown must be answered now */
export function isRequired(q: DesignQuestion, answers: Answers, place: Place, typeOf: (name: string) => DesignQuestion["type"] | undefined): boolean {
  if (q.required === "always") return true;
  if (q.required === "never") return false;
  return conditionHolds(q.required.when, answers, place, typeOf) === true;
}

/** The answers a choice offers: its list's first level, or for a sub-list those under its parent question's answer */
export function optionsOf(q: DesignQuestion, items: readonly DesignListItem[], answers: Answers, place: Place): DesignListItem[] {
  if (!q.parentQuestion) return [...items];
  const parent = answerOf(answers, q.parentQuestion, place);
  const code = Array.isArray(parent) ? parent[0] : parent;
  if (!code) return [];
  const find = (list: readonly DesignListItem[]): DesignListItem | undefined => {
    for (const i of list) {
      if (i.code === code) return i;
      const inner = find(i.items);
      if (inner) return inner;
    }
    return undefined;
  };
  return find(items)?.items ?? [];
}

/**
 * The rules a question's answer breaks now: none while it is not answered (Collect checks only an answer), nor for a
 * rule whose condition does not hold; an advanced rule is not evaluated
 */
export function brokenRules(
  q: DesignQuestion,
  answers: Answers,
  place: Place,
  typeOf: (name: string) => DesignQuestion["type"] | undefined,
): DesignRule[] {
  const a = answerOf(answers, q.name, place);
  if (blank(a)) return [];
  return q.rules.filter((rule) => {
    if (rule.when && conditionHolds(rule.when, answers, place, typeOf) !== true) return false;
    switch (rule.kind) {
      case "range": {
        const n = number(a);
        if (Number.isNaN(n)) return false;
        const limit = (l: typeof rule.min): number | undefined => {
          if (!l) return undefined;
          if ("number" in l.bound) return l.bound.number;
          if ("question" in l.bound) {
            const v = number(answerOf(answers, l.bound.question, place));
            return Number.isNaN(v) ? undefined : v;
          }
          return undefined;
        };
        const lo = limit(rule.min);
        const hi = limit(rule.max);
        if (lo !== undefined && !(rule.min!.inclusive ? n >= lo : n > lo)) return true;
        if (hi !== undefined && !(rule.max!.inclusive ? n <= hi : n < hi)) return true;
        return false;
      }
      case "length": {
        const length = Array.isArray(a) ? 0 : a!.length;
        return (rule.min !== null && length < rule.min) || (rule.max !== null && length > rule.max);
      }
      case "total": {
        if (!place.table) return false;
        let sum = 0;
        for (const row of Object.values(answers.rows[place.table.name] ?? {})) {
          const v = number(row[q.name]);
          if (!Number.isNaN(v)) sum += v;
        }
        return rule.test === "atLeast" ? sum < rule.total : rule.test === "atMost" ? sum > rule.total : sum !== rule.total;
      }
      default:
        return false;
    }
  });
}

/** A table's total of a column, as the form shows it under the column */
export function columnTotal(table: DesignTable, column: string, answers: Answers): number {
  let sum = 0;
  for (const row of Object.values(answers.rows[table.name] ?? {})) {
    const v = number(row[column]);
    if (!Number.isNaN(v)) sum += v;
  }
  return sum;
}
