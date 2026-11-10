// A CEO survey planned as a Collect survey (docs/plans/2026-11-09-ceo-bridge.md, B1): one attribute per CEO question,
// in CEO's order (the cards, each followed by its child questions), with its Collect name, its choice list, the
// relevance that shows it under its parent, and whether an answer is needed. idml.ts writes the plan as a survey;
// rules.ts adds the checks.
//
// Every answer is one per plot (the plan's first translation): CEO's samples are not asked one by one.
import type { CeoProject, CeoQuestion } from './project.js';
import { Report } from './report.js';

export interface PlannedItem {
  code: string;
  label: string;
  /** the CEO answer it comes from */
  answerId: string;
}

export interface PlannedAttribute {
  /** the CEO question it comes from */
  ceoId: string;
  name: string;
  label: string;
  description: string | null;
  kind: 'code' | 'number' | 'text';
  /** how a code question is laid out: CEO's dropdown stays one, buttons and radio buttons are buttons */
  layout: 'buttons' | 'dropdown' | null;
  items: PlannedItem[];
  /** a code question whose codes are the numbers CEO offered (dataType number), which the sum rules add */
  numericCodes: boolean;
  required: boolean;
  /** Collect relevance (XPath), null when always shown */
  relevant: string | null;
}

export interface PlannedColumn {
  /** the attribute's name */
  name: string;
  /** the plot file's column it is read from */
  column: string;
}

export interface SurveyPlan {
  attributes: PlannedAttribute[];
  byCeoId: Map<string, PlannedAttribute>;
  /** the plot file's extra columns, read into the record (collectearth:fromcsv) */
  columns: PlannedColumn[];
}

/** Names Collect Earth gives attributes itself, which a question may not take. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'plot', 'id', 'round', 'location', 'operator', 'actively_saved', 'actively_saved_on', 'plot_file',
  'elevation', 'slope', 'aspect',
]);

/** Longest attribute name made from a question's text. */
const MAX_NAME = 40;
/** Longest code made from an answer's text. */
const MAX_CODE = 30;

/** Lower case ASCII letters, digits and "_", from any text ("Área de bosque (%)" -> "area_de_bosque") */
export function slug(text: string, max: number): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/g, '');
}

/**
 * A field name Collect Earth can read back: none ends in "_" and a number, which its form handling takes for the index
 * of a repeated value and cuts off (BalloonInputFieldsUtils.removeArraySuffix: "…_2000_2010" was looked for as
 * "…_2000", and no plot could be saved). A range at the end is joined with "to" ("periodo_2000to2010"), a single number
 * with its word ("type2017").
 */
export function readableName(name: string): string {
  return name.replace(/_(\d+)_(\d+)$/, '_$1to$2').replace(/_(\d+)$/, '$1');
}

/** b, c ... z, ba, bb ...: the suffix of the n-th use of a name (2 is b) */
function letters(n: number): string {
  let out = '';
  for (let k = n - 1; k > 0; k = Math.floor(k / 26)) out = String.fromCharCode(97 + (k % 26)) + out;
  return out;
}

/** A name not taken yet: `base`, else `base_b`, `base_c`... (kept within `max`; letters, as a number would end it) */
function unique(base: string, taken: Set<string>, max: number): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) {
    const suffix = `_${letters(n)}`;
    name = base.slice(0, max - suffix.length).replace(/_+$/g, '') + suffix;
  }
  taken.add(name);
  return name;
}

/** A Collect attribute name: starts with a letter, then letters, digits and "_" */
function attributeName(q: CeoQuestion, taken: Set<string>): string {
  let base = slug(q.questionLabel ?? q.question, MAX_NAME);
  if (base === '') base = `question_${slug(q.id, 10) || 'x'}`;
  if (!/^[a-z]/.test(base)) base = `q_${base}`.slice(0, MAX_NAME).replace(/_+$/g, '');
  base = readableName(base);
  if (RESERVED_NAMES.has(base)) base = `q_${base}`;
  return unique(base, taken, MAX_NAME);
}

/** A number as a code: "080" and "80.0" are 80; null when the text is no number */
function numberCode(text: string): string | null {
  const t = text.trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return String(Number(t));
}

/**
 * The questions in CEO's order: the top ones by card (then id), each followed by its children (by id), depth first.
 * A question whose parent is not in the survey is put at the top; one in a loop of parents is left out.
 */
function inOrder(project: CeoProject, report: Report): { question: CeoQuestion; parent: CeoQuestion | null }[] {
  const byId = new Map(project.questions.map((q) => [q.id, q]));
  const children = new Map<string, CeoQuestion[]>();
  const tops: CeoQuestion[] = [];
  for (const q of project.questions) {
    if (q.parentQuestionId !== null && byId.has(q.parentQuestionId) && q.parentQuestionId !== q.id) {
      const list = children.get(q.parentQuestionId) ?? [];
      list.push(q);
      children.set(q.parentQuestionId, list);
    } else {
      if (q.parentQuestionId !== null) {
        report.add('question', q.question, 'changed', `Its parent question (${q.parentQuestionId}) is not in the survey: it is asked for every plot.`);
      }
      tops.push(q);
    }
  }
  tops.sort((a, b) => (a.cardOrder ?? Infinity) - (b.cardOrder ?? Infinity) || 0);
  const out: { question: CeoQuestion; parent: CeoQuestion | null }[] = [];
  const seen = new Set<string>();
  const visit = (q: CeoQuestion, parent: CeoQuestion | null) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    out.push({ question: q, parent });
    for (const child of children.get(q.id) ?? []) visit(child, q);
  };
  for (const q of tops) visit(q, null);
  for (const q of project.questions) {
    if (!seen.has(q.id)) {
      report.add('question', q.question, 'skipped', 'Its parent questions form a loop (each shown by the other): it could never be shown.');
    }
  }
  return out;
}

/** CEO's survey planned as Collect attributes; what changed or was left out goes to `report`. */
export function planSurvey(project: CeoProject, report: Report, options: { columns?: readonly string[] } = {}): SurveyPlan {
  const taken = new Set<string>(RESERVED_NAMES);
  // The plot file's extra columns first: they keep their own names where they can
  const columns: PlannedColumn[] = [];
  for (const column of options.columns ?? []) {
    let base = slug(column, MAX_NAME) || 'column';
    if (!/^[a-z]/.test(base)) base = `c_${base}`;
    columns.push({ name: unique(readableName(base), taken, MAX_NAME), column });
  }

  const attributes: PlannedAttribute[] = [];
  const byCeoId = new Map<string, PlannedAttribute>();
  let colours = 0;
  for (const { question: q, parent } of inOrder(project, report)) {
    const subject = q.question || `Question ${q.id}`;
    if (q.hideQuestion) {
      report.add('question', subject, 'skipped', 'Hidden in CEO: not asked.');
      continue;
    }
    const parentAttribute = parent ? byCeoId.get(parent.id) : undefined;
    if (parent && !parentAttribute) {
      report.add('question', subject, 'skipped', 'Its parent question was left out, so it could never be shown.');
      continue;
    }
    const notes: string[] = [];

    // When it is shown: under its parent's answers, and only when the parent itself is shown
    let relevant: string | null = null;
    if (parentAttribute) {
      let condition: string;
      if (q.parentAnswerIds.length === 0) {
        condition = `not(idm:blank(${parentAttribute.name}))`;
      } else {
        const codes = q.parentAnswerIds
          .map((aid) => parentAttribute.items.find((i) => i.answerId === aid)?.code)
          .filter((c): c is string => c !== undefined);
        if (codes.length === 0) {
          report.add('question', subject, 'skipped', 'The answers of its parent question that show it are hidden or gone in CEO: it could never be shown.');
          continue;
        }
        if (codes.length < q.parentAnswerIds.length) notes.push('some of the parent answers that showed it are hidden in CEO and no longer show it');
        condition = codes.length === 1 ? `${parentAttribute.name} = '${codes[0]}'` : `(${codes.map((c) => `${parentAttribute.name} = '${c}'`).join(' or ')})`;
      }
      relevant = parentAttribute.relevant ? `(${parentAttribute.relevant}) and ${condition}` : condition;
    }

    const name = attributeName(q, taken);
    const required = q.required === false ? false : q.componentType === 'input' ? q.answers[0]?.required !== false : true;
    let attribute: PlannedAttribute;
    if (q.componentType === 'input') {
      const placeholder = q.answers[0]?.answer.trim() ?? '';
      attribute = {
        ceoId: q.id, name, label: subject, description: placeholder === '' ? null : `In CEO: "${placeholder}"`,
        kind: q.dataType === 'number' ? 'number' : 'text', layout: null, items: [], numericCodes: false, required, relevant,
      };
      if (q.dataType === 'boolean') notes.push('a yes/no typed as text is a text answer');
    } else {
      const shown = q.answers.filter((a) => !a.hide);
      if (shown.length === 0) {
        report.add('question', subject, 'skipped', 'It has no answers to choose from.');
        continue;
      }
      if (shown.length < q.answers.length) notes.push(`${q.answers.length - shown.length} hidden answer(s) left out`);
      const codes = new Set<string>();
      let numericCodes = q.dataType === 'number';
      const items: PlannedItem[] = shown.map((a) => {
        let code: string | null = null;
        if (q.dataType === 'number') {
          code = numberCode(a.answer);
          if (code === null || codes.has(code)) numericCodes = false;
        }
        if (code === null || codes.has(code)) code = slug(a.answer, MAX_CODE) || `a${slug(a.id, 10)}`;
        code = unique(code, codes, MAX_CODE);
        return { code, label: a.answer.trim() || code, answerId: a.id };
      });
      if (q.dataType === 'number' && !numericCodes) notes.push('its answers are not all different numbers, so rules adding them up cannot use it');
      colours += shown.filter((a) => a.color !== null).length;
      attribute = {
        ceoId: q.id, name, label: subject, description: null, kind: 'code',
        layout: q.componentType === 'dropdown' ? 'dropdown' : 'buttons', items, numericCodes, required, relevant,
      };
    }
    attributes.push(attribute);
    byCeoId.set(q.id, attribute);
    report.add('question', subject, notes.length ? 'changed' : 'imported', notes.length ? `As "${name}": ${notes.join('; ')}.` : `As "${name}".`);
  }
  if (colours > 0) {
    report.add('project', 'Answer colours', 'info', "CEO's colour of each answer is not kept: Collect Earth colours the plots by their status.");
  }
  return { attributes, byCeoId, columns };
}
