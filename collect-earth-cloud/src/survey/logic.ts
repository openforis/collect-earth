// The survey designer's logic (docs/plans/2026-11-18-survey-designer.md, stage 4, "Three layers" 1): conditions and
// rules are made from rows in the dashboard, and the server writes Collect's expressions from them, after checking
// each row: the question exists and can be reached from where the expression is evaluated, the test suits its kind
// of answer, a code is one of its list, a range is not empty. What it writes reads back as the same rows
// (condition.ts, design.ts), and the survey check (check.ts) then judges the expression as Collect does.

import type { ConditionPart, ConditionRows, NewRule, NewRuleLimit, QuestionType, TotalTest } from '../wire/survey.js';
import { SurveyEditError } from './errors.js';
import { attrValue, childElements, descendants, firstChild, textValue, type XmlDocument, type XmlElement } from './xmlTree.js';

/** The kinds of node that are answered (an entity is a table or group of them) */
export const ATTRIBUTE_TAGS = new Set(['text', 'number', 'range', 'code', 'boolean', 'date', 'time', 'coordinate', 'taxon', 'file']);

/** The most rows a condition built here has */
export const MAX_ROWS = 20;

/** A question's kind, as the designer names it; Collect reads a number without a type as a decimal one */
export function questionType(doc: XmlDocument, e: XmlElement): QuestionType {
  switch (e.name) {
    case 'code':
      return attrValue(doc, e, 'multiple') === 'true' ? 'choices' : 'choice';
    case 'boolean':
      return 'yesNo';
    case 'number':
      return attrValue(doc, e, 'type') === 'integer' ? 'integer' : 'decimal';
    case 'text':
      return attrValue(doc, e, 'type') === 'memo' ? 'memo' : 'text';
    case 'taxon':
      return 'species';
    default:
      return e.name as QuestionType;
  }
}

/** The tests a row can make on a question of each kind */
export function testsFor(type: QuestionType): ConditionPart['test'][] {
  switch (type) {
    case 'choice':
    case 'choices':
    case 'yesNo':
    case 'text':
    case 'memo':
      return ['is', 'isNot', 'answered', 'notAnswered'];
    case 'integer':
    case 'decimal':
      return ['is', 'isNot', 'lt', 'lte', 'gt', 'gte', 'answered', 'notAnswered'];
    default:
      return ['answered', 'notAnswered'];
  }
}

/** Where the survey's logic looks: the plot, and the lists by name */
export interface LogicScope {
  doc: XmlDocument;
  plot: XmlElement;
  list(name: string): XmlElement | undefined;
}

/**
 * A question named by an expression of `node`, and how the expression names it. Collect evaluates a node's
 * expressions from the entity holding it: its own entity's questions by name, the plot's from a table's row through
 * parent(). A question inside another table cannot be named without saying which row, so it is refused.
 */
export function reference(scope: LogicScope, node: XmlElement, name: unknown): { element: XmlElement; text: string } {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) throw new SurveyEditError('A row names no question.');
  const context = node.parent ?? scope.plot;
  const find = (entity: XmlElement) => childElements(entity).find((c) => ATTRIBUTE_TAGS.has(c.name) && attrValue(scope.doc, c, 'name') === name);
  const own = find(context);
  if (own) return { element: own, text: name };
  if (context !== scope.plot) {
    const onPlot = find(scope.plot);
    if (onPlot) return { element: onPlot, text: `parent()/${name}` };
  }
  for (const e of descendants(scope.plot)) {
    if (ATTRIBUTE_TAGS.has(e.name) && attrValue(scope.doc, e, 'name') === name) {
      throw new SurveyEditError(`${name} is in a table: here a condition can use the questions of the plot${context !== scope.plot ? ' and of the same row' : ''}.`);
    }
  }
  throw new SurveyEditError(`There is no question ${name}.`);
}

/** Every code of a list, at every level */
export function listCodes(doc: XmlDocument, list: XmlElement): Set<string> {
  const codes = new Set<string>();
  for (const e of descendants(list)) {
    if (e.name !== 'item') continue;
    const code = firstChild(e, 'code');
    if (code) codes.add(textValue(doc, code).trim());
  }
  return codes;
}

/** A number as Collect's expressions write it: digits, a point, no exponent */
export function numberText(value: unknown): string {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new SurveyEditError(`${String(value)} is not a number a rule can use.`);
  return text;
}

/** A text in quotes; one with both kinds of quote cannot be written */
function quoted(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new SurveyEditError('A value cannot have both kinds of quote.');
}

const COMPARE: Record<string, string> = { is: '=', isNot: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' };

/** One row as an expression, after checking it suits its question */
function partExpression(scope: LogicScope, node: XmlElement, part: ConditionPart, self: boolean): string {
  if (!part || typeof part !== 'object') throw new SurveyEditError('A row of a condition is missing.');
  const { element, text: ref } = reference(scope, node, part.question);
  if (!self && element === node) throw new SurveyEditError('A question cannot be shown or required depending on its own answer.');
  const type = questionType(scope.doc, element);
  if (!testsFor(type).includes(part.test)) throw new SurveyEditError(`${part.question} cannot be tested that way.`);
  if (part.test === 'answered') return `not(idm:blank(${ref}))`;
  if (part.test === 'notAnswered') return `idm:blank(${ref})`;
  const v = part.value;
  switch (type) {
    case 'yesNo':
      if (typeof v !== 'boolean') throw new SurveyEditError(`${part.question} is answered yes or no.`);
      return `${ref} ${COMPARE[part.test]} ${v ? 'true()' : 'false()'}`;
    case 'choice':
    case 'choices': {
      if (typeof v !== 'string') throw new SurveyEditError(`${part.question} is answered from its list.`);
      const listName = attrValue(scope.doc, element, 'list') ?? '';
      const list = scope.list(listName);
      if (!list || !listCodes(scope.doc, list).has(v)) throw new SurveyEditError(`The list of ${part.question} has no code ${v}.`);
      // Several answers: "is" holds when one of them is the code, "is not" when none is
      if (type === 'choices' && part.test === 'isNot') return `not(${ref} = ${quoted(v)})`;
      return `${ref} ${COMPARE[part.test]} ${quoted(v)}`;
    }
    case 'integer':
    case 'decimal':
      return `${ref} ${COMPARE[part.test]} ${numberText(v)}`;
    default:
      if (typeof v !== 'string' || v === '') throw new SurveyEditError(`A text is needed to compare ${part.question} with.`);
      if (v.length > 200) throw new SurveyEditError('A value to compare with has at most 200 characters.');
      return `${ref} ${COMPARE[part.test]} ${quoted(v)}`;
  }
}

/**
 * A condition of `node` from its rows: when it is shown or required (`self` false: not on its own answer), or when one
 * of its rules applies (`self` true)
 */
export function conditionExpression(scope: LogicScope, node: XmlElement, rows: ConditionRows, self: boolean): string {
  if (!rows || (rows.kind !== 'all' && rows.kind !== 'any') || !Array.isArray(rows.parts)) throw new SurveyEditError('A condition is all or any of its rows.');
  if (rows.parts.length === 0) throw new SurveyEditError('A condition needs a row.');
  if (rows.parts.length > MAX_ROWS) throw new SurveyEditError(`A condition has at most ${MAX_ROWS} rows.`);
  return rows.parts.map((p) => partExpression(scope, node, p, self)).join(rows.kind === 'all' ? ' and ' : ' or ');
}

const TOTAL_OPS: Record<TotalTest, string> = { atLeast: '>=', atMost: '<=', exactly: '=' };

/**
 * A rule as Collect's check element: its tag and its attributes (but its messages). A range is a compare (Collect
 * writes the default message itself); a length and a column's total a check with an expression.
 */
export function ruleCheck(scope: LogicScope, node: XmlElement, rule: NewRule): { tag: 'compare' | 'check'; attrs: Array<[string, string]> } {
  if (!rule || typeof rule !== 'object') throw new SurveyEditError('A rule is missing.');
  if (rule.flag !== 'error' && rule.flag !== 'warning') throw new SurveyEditError('A rule is an error or a warning.');
  const type = questionType(scope.doc, node);
  const name = attrValue(scope.doc, node, 'name') ?? '';
  const attrs: Array<[string, string]> = [['flag', rule.flag === 'warning' ? 'warn' : 'error']];
  if (rule.when !== null && rule.when !== undefined) attrs.push(['if', conditionExpression(scope, node, rule.when, true)]);
  const isNumber = type === 'integer' || type === 'decimal';
  switch (rule.kind) {
    case 'range': {
      if (!isNumber) throw new SurveyEditError('A range is for a number.');
      const limit = (l: NewRuleLimit | null | undefined, side: 'g' | 'l'): [string, string] | null => {
        if (l === null || l === undefined) return null;
        let text: string;
        if (l.bound && 'number' in l.bound) text = numberText(l.bound.number);
        else if (l.bound && 'question' in l.bound) {
          const ref = reference(scope, node, l.bound.question);
          if (ref.element === node) throw new SurveyEditError('A question is not compared with itself.');
          const other = questionType(scope.doc, ref.element);
          if (other !== 'integer' && other !== 'decimal') throw new SurveyEditError(`${l.bound.question} is not a number.`);
          text = ref.text;
        } else throw new SurveyEditError('A limit is a number or a question.');
        return [`${side}t${l.inclusive ? 'e' : ''}`, text];
      };
      const min = limit(rule.min, 'g');
      const max = limit(rule.max, 'l');
      if (!min && !max) throw new SurveyEditError('A range needs a lowest or a highest value.');
      if (rule.min && rule.max && 'number' in rule.min.bound && 'number' in rule.max.bound) {
        const lo = rule.min.bound.number;
        const hi = rule.max.bound.number;
        if (lo > hi || (lo === hi && !(rule.min.inclusive && rule.max.inclusive))) throw new SurveyEditError('No answer fits the range: the lowest value is above the highest.');
      }
      if (min) attrs.push(min);
      if (max) attrs.push(max);
      return { tag: 'compare', attrs };
    }
    case 'length': {
      if (type !== 'text' && type !== 'memo') throw new SurveyEditError('A length is for a text.');
      const whole = (n: unknown) => {
        if (n === null || n === undefined) return null;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) throw new SurveyEditError('A length is a whole number of characters.');
        return n;
      };
      const min = whole(rule.min);
      const max = whole(rule.max);
      if (min === null && max === null) throw new SurveyEditError('A length needs a fewest or a most characters.');
      if (min !== null && max !== null && min > max) throw new SurveyEditError('No answer fits: the fewest characters is above the most.');
      const pieces: string[] = [];
      if (min !== null) pieces.push(`string-length($this) >= ${min}`);
      if (max !== null) pieces.push(`string-length($this) <= ${max}`);
      attrs.push(['expr', pieces.join(' and ')]);
      return { tag: 'check', attrs };
    }
    case 'total': {
      const table = node.parent;
      if (!isNumber || !table || table === scope.plot || table.name !== 'entity' || table.parent !== scope.plot || attrValue(scope.doc, table, 'multiple') !== 'true') {
        throw new SurveyEditError('A total is for a number column of a table.');
      }
      const op = TOTAL_OPS[rule.test];
      if (!op) throw new SurveyEditError('A total is at least, at most or exactly a number.');
      attrs.push(['expr', `sum(parent()/${attrValue(scope.doc, table, 'name')}/${name}) ${op} ${numberText(rule.total)}`]);
      return { tag: 'check', attrs };
    }
    default:
      throw new SurveyEditError('The designer makes ranges, lengths and totals; other rules are written in Collect\'s Survey Designer.');
  }
}

/** A check's expression read as a length or a total rule, as ruleCheck writes them; undefined for anything else */
export function readCheckRule(
  expression: string,
  own: { name: string; table: string | null },
): { kind: 'length'; min: number | null; max: number | null } | { kind: 'total'; test: TotalTest; total: number } | undefined {
  const text = expression.replace(/\s+/g, ' ').trim();
  const total = /^sum\(parent\(\)\/([a-z][a-z0-9_]*)\/([a-z][a-z0-9_]*)\) ?(>=|<=|=) ?(-?\d+(?:\.\d+)?)$/.exec(text);
  if (total) {
    if (total[1] !== own.table || total[2] !== own.name) return undefined;
    const test: TotalTest = total[3] === '>=' ? 'atLeast' : total[3] === '<=' ? 'atMost' : 'exactly';
    return { kind: 'total', test, total: Number(total[4]) };
  }
  let min: number | null = null;
  let max: number | null = null;
  const pieces = text.split(' and ');
  if (pieces.length > 2) return undefined;
  for (const piece of pieces) {
    const m = /^string-length\(\$this\) ?(>=|>|<=|<) ?(\d+)$/.exec(piece.trim());
    if (!m) return undefined;
    const n = Number(m[2]);
    if (m[1] === '>=' || m[1] === '>') {
      if (min !== null) return undefined;
      min = m[1] === '>' ? n + 1 : n;
    } else {
      if (max !== null) return undefined;
      max = m[1] === '<' ? n - 1 : n;
    }
  }
  return { kind: 'length', min, max };
}
