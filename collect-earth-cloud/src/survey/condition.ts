// The conditions of a survey read as the designer shows them (docs/plans/2026-11-18-survey-designer.md, "Show
// when"): rows of "question is / is not / is answered / is less than…", joined by all or any. Only what the rows
// say exactly is read as rows; anything else (nested groups, functions, paths into tables) stays the expression as
// written, shown as an advanced condition and never changed.

import type { ConditionPart, ConditionTest, DesignCondition } from '../wire/survey.js';

/** What the reader needs to know of a question a condition names: whether it is a yes/no one */
export type QuestionLookup = (name: string) => { yesNo: boolean } | undefined;

const NAME = '(?:parent\\(\\)/)?([a-z][a-z0-9_]*)';
const VALUE = `'([^']*)'|"([^"]*)"|(true|false)\\(\\)|(-?\\d+(?:\\.\\d+)?)`;
const COMPARISON = new RegExp(`^${NAME}\\s*(!=|<=|>=|=|<|>)\\s*(?:${VALUE})$`);
const BARE = new RegExp(`^${NAME}$`);
const FUNCTION = new RegExp(`^(boolean|not)\\(\\s*${NAME}\\s*\\)$`);
const TESTS: Record<string, ConditionTest> = { '=': 'is', '!=': 'isNot', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };

/** A condition as rows; an expression the rows cannot say exactly as advanced */
export function readCondition(expression: string, lookup: QuestionLookup): DesignCondition {
  const text = expression.trim();
  if (text === 'false()') return { kind: 'never' };
  const split = splitTop(text);
  if (split) {
    const parts: ConditionPart[] = [];
    for (const piece of split.pieces) {
      const part = readPart(piece, lookup);
      if (!part) return { kind: 'advanced', text };
      parts.push(part);
    }
    if (parts.length > 0) return { kind: split.joiner === 'or' ? 'any' : 'all', parts };
  }
  return { kind: 'advanced', text };
}

/** One row, or undefined when the piece is not one */
function readPart(piece: string, lookup: QuestionLookup): ConditionPart | undefined {
  let m = COMPARISON.exec(piece);
  if (m) {
    const [, question, op, single, double, bool, number] = m;
    const target = lookup(question);
    if (!target) return undefined;
    let value: string | number | boolean;
    if (bool !== undefined) value = bool === 'true';
    else if (number !== undefined) value = Number(number);
    else value = single ?? double;
    const test = TESTS[op];
    // A yes/no compared with yes or no, a code or a number compared with a value of its kind
    if (typeof value === 'boolean' && (!target.yesNo || (test !== 'is' && test !== 'isNot'))) return undefined;
    if (typeof value === 'string' && test !== 'is' && test !== 'isNot') return undefined;
    return { question, test, value };
  }
  m = BARE.exec(piece);
  if (m) {
    const target = lookup(m[1]);
    if (!target) return undefined;
    // A yes/no alone holds when it is yes; another question when it has an answer
    return target.yesNo ? { question: m[1], test: 'is', value: true } : { question: m[1], test: 'answered', value: null };
  }
  m = FUNCTION.exec(piece);
  if (m) {
    const target = lookup(m[2]);
    if (!target) return undefined;
    if (m[1] === 'boolean') return target.yesNo ? undefined : { question: m[2], test: 'answered', value: null };
    return target.yesNo ? { question: m[2], test: 'isNot', value: true } : { question: m[2], test: 'notAnswered', value: null };
  }
  return undefined;
}

/**
 * The pieces of an expression joined by one kind of `and` / `or` outside quotes and brackets, with the brackets
 * around the whole taken off; undefined when it mixes the two at the top
 */
function splitTop(text: string): { pieces: string[]; joiner: 'and' | 'or' | null } | undefined {
  let t = text;
  while (t.startsWith('(') && closingOf(t, 0) === t.length - 1) t = t.slice(1, -1).trim();
  const pieces: string[] = [];
  let joiner: 'and' | 'or' | null = null;
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && /\s/.test(c)) {
      const word = /^\s+(and|or)\s+/.exec(t.slice(i));
      if (word) {
        if (joiner && joiner !== word[1]) return undefined;
        joiner = word[1] as 'and' | 'or';
        pieces.push(t.slice(start, i).trim());
        i += word[0].length - 1;
        start = i + 1;
      }
    }
  }
  if (quote || depth !== 0) return undefined;
  pieces.push(t.slice(start).trim());
  return { pieces, joiner };
}

/** The index of the bracket closing the one at `open`, or -1 */
function closingOf(t: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < t.length; i++) {
    const c = t[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** The names an expression uses, of those given (a formula's questions) */
export function namesUsed(expression: string, names: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  // Outside quotes only
  const unquoted = expression.replace(/'[^']*'|"[^"]*"/g, ' ');
  for (const m of unquoted.matchAll(/(?<![\w$:-])([a-z][a-z0-9_]*)(?![\w(-])/g)) {
    if (names.has(m[1])) found.add(m[1]);
  }
  return [...found];
}
