// What a change of the survey designer does to the plots already collected (docs/plans/2026-11-18-survey-designer.md,
// "Changing a survey that is in use"): counted from the records' summaries, where the desktop gives each answer under a
// key of its question ("collect_code_land_use", "collect_entity_land_cover[trees].integer_percentage"). The dashboard
// shows it before saving, and asks to confirm what touches answers already given.

import { isBlankAnswer } from '../quality.js';
import { QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR } from '../surveyOutline.js';
import type { SurveyEffect, SurveyImpactAnswer, SurveyOperation } from '../wire/survey.js';
import { attrValue, descendants, readXml, type XmlDocument, type XmlElement } from './xmlTree.js';

const NODE_TAGS = new Set(['entity', 'text', 'number', 'range', 'code', 'boolean', 'date', 'time', 'coordinate', 'taxon', 'file']);

/** A record as the impact reads it: its plot and its answers */
export interface ImpactRecord {
  recordKey: string;
  summary: Record<string, string>;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The summary keys of a question: of the plot, or of each row of its table */
function keyPattern(doc: XmlDocument, node: XmlElement): RegExp {
  const name = escape(attrValue(doc, node, 'name') ?? '');
  const parent = node.parent;
  const inTable = parent && parent.name === 'entity' && parent.parent?.name === 'entity';
  if (inTable) return new RegExp(`^collect_entity_${escape(attrValue(doc, parent, 'name') ?? '')}\\[[^\\]]*\\]\\.[a-z]+_${name}$`);
  return new RegExp(`^collect_[a-z]+_${name}$`);
}

/** The codes of an answer ("F", "F===C", "other::Eucalyptus") */
const codesOf = (text: string) =>
  text
    .split(SUMMARY_VALUES_SEPARATOR)
    .map((v) => v.split(QUALIFIER_SEPARATOR)[0].trim())
    .filter((v) => v !== '' && v !== 'null');

/** How the operations touch the records: none for words, moves and new lists */
export function surveyImpact(survey: Uint8Array, operations: readonly SurveyOperation[], records: readonly ImpactRecord[]): SurveyImpactAnswer {
  const doc = readXml(survey);
  const plots = new Set(records.map((r) => r.recordKey)).size;
  const nodes = new Map<number, XmlElement>();
  for (const e of descendants(doc.root)) {
    if (NODE_TAGS.has(e.name)) {
      const id = Number(attrValue(doc, e, 'id'));
      if (Number.isFinite(id)) nodes.set(id, e);
    }
  }
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
  const effects: SurveyEffect[] = [];
  const added = operations.filter((o) => o.op === 'addQuestion').length;
  if (added > 0 && plots > 0) effects.push({ kind: 'newQuestions', count: added });
  for (const op of operations) {
    if (op.op === 'deleteQuestion') {
      const node = nodes.get(op.id);
      if (!node || node.name === 'entity') continue;
      const answered = count(keyPattern(doc, node), (v) => !isBlankAnswer(v));
      if (answered > 0) effects.push({ kind: 'questionDeleted', question: attrValue(doc, node, 'name') ?? '', answered });
    } else if (op.op === 'deleteItem') {
      let chosen = 0;
      const found = new Set<string>();
      for (const node of nodes.values()) {
        if (node.name === 'code' && attrValue(doc, node, 'list') === op.list) {
          const pattern = keyPattern(doc, node);
          for (const r of records) {
            if (Object.entries(r.summary).some(([k, v]) => pattern.test(k) && codesOf(v).includes(op.code))) found.add(r.recordKey);
          }
        }
        // A table with a row per answer of the list: the row's answers
        if (node.name === 'entity' && node.parent?.name === 'entity') {
          const key = [...node.children].find((c) => c.kind === 'element' && c.name === 'code' && attrValue(doc, c, 'key') === 'true' && attrValue(doc, c, 'list') === op.list);
          if (key) {
            const rows = new RegExp(`^collect_entity_${escape(attrValue(doc, node, 'name') ?? '')}\\[${escape(op.code)}\\]\\.`);
            for (const r of records) if (Object.entries(r.summary).some(([k, v]) => rows.test(k) && !isBlankAnswer(v))) found.add(r.recordKey);
          }
        }
      }
      chosen = found.size;
      if (chosen > 0) effects.push({ kind: 'itemDeleted', list: op.list, code: op.code, chosen });
    } else if (op.op === 'setRequired' && op.required) {
      const node = nodes.get(op.id);
      if (!node || node.name === 'entity' || attrValue(doc, node, 'required') === 'true') continue;
      // A table's empty answers are not in the summaries: only the plot's questions are counted
      if (node.parent?.parent?.name === 'entity') continue;
      const pattern = keyPattern(doc, node);
      const answered = count(pattern, (v) => !isBlankAnswer(v));
      const unanswered = plots - answered;
      if (unanswered > 0) effects.push({ kind: 'nowRequired', question: attrValue(doc, node, 'name') ?? '', unanswered });
    }
  }
  return { plots, effects };
}
