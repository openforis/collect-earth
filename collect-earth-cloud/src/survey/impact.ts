// What a change of the survey designer does to the plots already collected (docs/plans/2026-11-18-survey-designer.md,
// "Changing a survey that is in use", and stage 4's "Tried on the data already collected"): counted from the records'
// summaries, where the desktop gives each answer under a key of its question ("collect_code_land_use",
// "collect_entity_land_cover[trees].integer_percentage"). The dashboard shows it before saving, and asks to confirm
// what touches answers already given. The conditions and rules made by the designer's builder are evaluated here on
// those answers; an advanced condition is not (a question under one counts as shown).

import { isBlankAnswer } from '../quality.js';
import { QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR } from '../surveyOutline.js';
import type { ConditionPart, ConditionRows, NewRule, SurveyEffect, SurveyImpactAnswer, SurveyOperation } from '../wire/survey.js';
import { readCondition } from './condition.js';
import { ATTRIBUTE_TAGS, questionType } from './logic.js';
import { attrValue, childElements, descendants, readXml, type XmlDocument, type XmlElement } from './xmlTree.js';

const NODE_TAGS = new Set(['entity', ...ATTRIBUTE_TAGS]);
/** The plots a rule's effect names */
const EXAMPLES = 20;

/** A record as the impact reads it: its plot and its answers */
export interface ImpactRecord {
  recordKey: string;
  summary: Record<string, string>;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The prefix of a question's summary key, as the desktop's handlers give it (surveyOutline.ts prefixOf) */
function prefixOf(doc: XmlDocument, e: XmlElement): string {
  const integer = attrValue(doc, e, 'type') === 'integer';
  switch (e.name) {
    case 'coordinate':
      return 'coord_';
    case 'number':
      return integer ? 'integer_' : 'real_';
    case 'range':
      return integer ? 'integer_range_' : 'real_range_';
    default:
      return `${e.name}_`;
  }
}

/** The codes of an answer ("F", "F===C", "other::Eucalyptus") */
const codesOf = (text: string) =>
  text
    .split(SUMMARY_VALUES_SEPARATOR)
    .map((v) => v.split(QUALIFIER_SEPARATOR)[0].trim())
    .filter((v) => v !== '' && v !== 'null');

/** A survey's questions as the summaries name them */
class Survey {
  readonly doc: XmlDocument;
  readonly plot: XmlElement;
  readonly byId = new Map<number, XmlElement>();

  constructor(bytes: Uint8Array) {
    this.doc = readXml(bytes);
    let plot: XmlElement | undefined;
    for (const e of descendants(this.doc.root)) {
      if (!NODE_TAGS.has(e.name)) continue;
      if (!plot && e.name === 'entity') plot = e;
      const id = Number(attrValue(this.doc, e, 'id'));
      if (Number.isFinite(id)) this.byId.set(id, e);
    }
    this.plot = plot ?? this.doc.root;
  }

  name(e: XmlElement): string {
    return attrValue(this.doc, e, 'name') ?? '';
  }

  /** The table (or group) a question is in; null on the plot */
  tableOf(e: XmlElement): XmlElement | null {
    return e.parent && e.parent !== this.plot && e.parent.name === 'entity' ? e.parent : null;
  }

  /** The summary keys of a question: of the plot, or of each row of its table */
  keyPattern(e: XmlElement): RegExp {
    const table = this.tableOf(e);
    const own = `${escape(prefixOf(this.doc, e))}${escape(this.name(e))}`;
    if (table) return new RegExp(`^collect_entity_${escape(this.name(table))}(\\[[^\\]]*\\])?\\.${own}$`);
    return new RegExp(`^collect_${own}$`);
  }

  /** A question's answer in a record, on the plot or in a row ("" when none) */
  answer(r: ImpactRecord, e: XmlElement, row: string | null): string {
    const table = this.tableOf(e);
    const own = `${prefixOf(this.doc, e)}${this.name(e)}`;
    if (!table) return r.summary[`collect_${own}`] ?? '';
    const base = `collect_entity_${this.name(table)}`;
    return r.summary[row === null ? `${base}.${own}` : `${base}[${row}].${own}`] ?? '';
  }

  /** The rows of a table a record has answers in: null for a group (one row, no index) */
  rows(r: ImpactRecord, table: XmlElement): Array<string | null> {
    if (attrValue(this.doc, table, 'multiple') !== 'true') return [null];
    const prefix = `collect_entity_${this.name(table)}[`;
    const found = new Set<string>();
    for (const k of Object.keys(r.summary)) {
      if (k.startsWith(prefix)) found.add(k.slice(prefix.length, k.indexOf(']', prefix.length)));
    }
    return [...found];
  }

  /** A question named from a node's place, as Collect resolves it: its own entity's first, then the plot's */
  named(from: XmlElement, name: string): XmlElement | undefined {
    const context = from.parent ?? this.plot;
    const find = (entity: XmlElement) => childElements(entity).find((c) => ATTRIBUTE_TAGS.has(c.name) && this.name(c) === name);
    return find(context) ?? (context !== this.plot ? find(this.plot) : undefined);
  }

  /** Whether a row of a condition holds for a record (and row) */
  holds(r: ImpactRecord, from: XmlElement, row: string | null, part: ConditionPart): boolean {
    const q = this.named(from, part.question);
    if (!q) return false;
    const text = this.answer(r, q, this.tableOf(q) ? row : null);
    const blank = isBlankAnswer(text);
    if (part.test === 'answered') return !blank;
    if (part.test === 'notAnswered') return blank;
    const type = questionType(this.doc, q);
    if (type === 'choice' || type === 'choices') {
      const has = codesOf(text).includes(String(part.value));
      return part.test === 'is' ? has : part.test === 'isNot' ? !has : false;
    }
    if (type === 'yesNo') {
      const same = !blank && (text.trim() === 'true') === part.value;
      return part.test === 'is' ? same : part.test === 'isNot' ? !same : false;
    }
    if (type === 'integer' || type === 'decimal') {
      const n = blank ? NaN : Number(text);
      const v = Number(part.value);
      switch (part.test) {
        case 'is': return n === v;
        case 'isNot': return n !== v;
        case 'lt': return n < v;
        case 'lte': return n <= v;
        case 'gt': return n > v;
        case 'gte': return n >= v;
      }
      return false;
    }
    const same = text === part.value;
    return part.test === 'is' ? same : part.test === 'isNot' ? !same : false;
  }

  conditionHolds(r: ImpactRecord, from: XmlElement, row: string | null, rows: ConditionRows): boolean {
    const results = rows.parts.map((p) => this.holds(r, from, row, p));
    return rows.kind === 'all' ? results.every(Boolean) : results.some(Boolean);
  }

  /** Whether a question (or table) is shown for a record: its condition, and its table's, when they are rows */
  shown(r: ImpactRecord, e: XmlElement, row: string | null, replace?: { node: XmlElement; when: ConditionRows | null }): boolean {
    for (let x: XmlElement | null = e; x && x !== this.plot; x = x.parent) {
      let rows: ConditionRows | null;
      if (replace && x === replace.node) rows = replace.when;
      else {
        const relevant = attrValue(this.doc, x, 'relevant')?.trim();
        if (!relevant) continue;
        const read = readCondition(relevant, (n) => {
          const q = this.named(x!, n);
          return q ? { yesNo: q.name === 'boolean' } : undefined;
        });
        if (read.kind === 'never') return false;
        // An advanced condition is not evaluated here: the question counts as shown
        if (read.kind === 'advanced') continue;
        rows = read;
      }
      if (rows && !this.conditionHolds(r, x, x === e ? row : null, rows)) return false;
    }
    return true;
  }

  /** Whether a rule from the builder lets an answer through; undefined when it does not apply */
  passes(r: ImpactRecord, e: XmlElement, row: string | null, rule: NewRule): boolean | undefined {
    const text = this.answer(r, e, row);
    if (isBlankAnswer(text)) return undefined;
    if (rule.when && !this.conditionHolds(r, e, row, rule.when)) return undefined;
    switch (rule.kind) {
      case 'range': {
        const n = Number(text);
        if (!Number.isFinite(n)) return undefined;
        const limit = (l: typeof rule.min): number | undefined => {
          if (!l) return undefined;
          if ('number' in l.bound) return l.bound.number;
          const other = this.named(e, l.bound.question);
          const t = other ? this.answer(r, other, this.tableOf(other) ? row : null) : '';
          return isBlankAnswer(t) ? undefined : Number(t);
        };
        const lo = limit(rule.min);
        const hi = limit(rule.max);
        if (lo !== undefined && !(rule.min!.inclusive ? n >= lo : n > lo)) return false;
        if (hi !== undefined && !(rule.max!.inclusive ? n <= hi : n < hi)) return false;
        return true;
      }
      case 'length':
        return (rule.min === null || text.length >= rule.min) && (rule.max === null || text.length <= rule.max);
      case 'total': {
        const table = this.tableOf(e);
        if (!table) return undefined;
        let sum = 0;
        for (const k of this.rows(r, table)) {
          const v = Number(this.answer(r, e, k));
          if (Number.isFinite(v)) sum += v;
        }
        return rule.test === 'atLeast' ? sum >= rule.total : rule.test === 'atMost' ? sum <= rule.total : sum === rule.total;
      }
    }
  }
}

/**
 * How the operations touch the records: none for words, moves and new lists. `after` is the survey with the
 * operations made, where the conditions and rules are evaluated; the deletions are looked up in the survey before.
 */
export function surveyImpact(
  survey: Uint8Array,
  operations: readonly SurveyOperation[],
  records: readonly ImpactRecord[],
  after: Uint8Array = survey,
): SurveyImpactAnswer {
  const before = new Survey(survey);
  const next = after === survey ? before : new Survey(after);
  const plots = new Set(records.map((r) => r.recordKey)).size;
  /** The plots with an answer under one of the keys, as a test of it says */
  const count = (pattern: RegExp, test: (value: string) => boolean) => {
    const found = new Set<string>();
    for (const r of records) {
      for (const [key, value] of Object.entries(r.summary)) {
        if (pattern.test(key) && test(value)) {
          found.add(r.recordKey);
          break;
        }
      }
    }
    return found.size;
  };
  /** The places a question is answered in a record: the plot, or each row of its table */
  const places = (s: Survey, r: ImpactRecord, e: XmlElement): Array<string | null> => {
    const table = s.tableOf(e);
    return table ? s.rows(r, table) : [null];
  };
  const effects: SurveyEffect[] = [];
  const added = operations.filter((o) => o.op === 'addQuestion').length;
  if (added > 0 && plots > 0) effects.push({ kind: 'newQuestions', count: added });
  for (const op of operations) {
    if (op.op === 'deleteQuestion') {
      const node = before.byId.get(op.id);
      if (!node || node.name === 'entity') continue;
      const answered = count(before.keyPattern(node), (v) => !isBlankAnswer(v));
      if (answered > 0) effects.push({ kind: 'questionDeleted', question: before.name(node), answered });
    } else if (op.op === 'deleteItem') {
      const found = new Set<string>();
      for (const node of before.byId.values()) {
        if (node.name === 'code' && attrValue(before.doc, node, 'list') === op.list) {
          const pattern = before.keyPattern(node);
          for (const r of records) {
            if (Object.entries(r.summary).some(([k, v]) => pattern.test(k) && codesOf(v).includes(op.code))) found.add(r.recordKey);
          }
        }
        // A table with a row per answer of the list: the row's answers
        if (node.name === 'entity' && node !== before.plot) {
          const key = childElements(node).find((c) => c.name === 'code' && attrValue(before.doc, c, 'key') === 'true' && attrValue(before.doc, c, 'list') === op.list);
          if (key) {
            const rows = new RegExp(`^collect_entity_${escape(before.name(node))}\\[${escape(op.code)}\\]\\.`);
            for (const r of records) if (Object.entries(r.summary).some(([k, v]) => rows.test(k) && !isBlankAnswer(v))) found.add(r.recordKey);
          }
        }
      }
      if (found.size > 0) effects.push({ kind: 'itemDeleted', list: op.list, code: op.code, chosen: found.size });
    } else if (op.op === 'setRequired' && op.required !== false) {
      const node = next.byId.get(op.id);
      const was = before.byId.get(op.id);
      if (!node || node.name === 'entity' || (was && attrValue(before.doc, was, 'required') === 'true')) continue;
      // A table's empty answers are not in the summaries: only the plot's questions are counted
      if (next.tableOf(node)) continue;
      let unanswered = 0;
      for (const r of new Map(records.map((x) => [x.recordKey, x])).values()) {
        if (!isBlankAnswer(next.answer(r, node, null))) continue;
        if (!next.shown(r, node, null)) continue;
        if (op.required !== true && !next.conditionHolds(r, node, null, op.required)) continue;
        unanswered++;
      }
      if (unanswered > 0) effects.push({ kind: 'nowRequired', question: next.name(node), unanswered });
    } else if (op.op === 'setShownWhen' && op.when !== null) {
      const node = next.byId.get(op.id);
      if (!node) continue;
      const questions = node.name === 'entity' ? childElements(node).filter((c) => ATTRIBUTE_TAGS.has(c.name)) : [node];
      const hidden = new Set<string>();
      for (const r of records) {
        for (const q of questions) {
          if (places(next, r, q).some((row) => !isBlankAnswer(next.answer(r, q, row)) && !next.shown(r, node, node.name === 'entity' ? null : row, { node, when: op.when }))) {
            hidden.add(r.recordKey);
          }
        }
      }
      if (hidden.size > 0) effects.push({ kind: 'hiddenAnswers', question: next.name(node), answered: hidden.size });
    } else if ((op.op === 'addRule' || op.op === 'setRule') && plots > 0) {
      const node = next.byId.get(op.id);
      if (!node) continue;
      const checked = new Set<string>();
      const flagged = new Set<string>();
      const examples: string[] = [];
      for (const r of records) {
        for (const row of places(next, r, node)) {
          if (!next.shown(r, node, row)) continue;
          const pass = next.passes(r, node, row, op.rule);
          if (pass === undefined) continue;
          checked.add(r.recordKey);
          if (!pass && !flagged.has(r.recordKey)) {
            flagged.add(r.recordKey);
            if (examples.length < EXAMPLES) examples.push(r.recordKey);
          }
        }
      }
      effects.push({ kind: 'ruleFlags', question: next.name(node), flagged: flagged.size, checked: checked.size, examples });
    }
  }
  return { plots, effects };
}
