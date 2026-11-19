// The plots last saved with an earlier version of the survey (docs/plans/2026-11-18-survey-designer.md, "After the
// review"): Collect Earth 2.0 says which survey a record was made with (RecordEnvelope.surveyRevision); of a record
// that does not say (an older Collect Earth, an import), an answer to a question the survey no longer has tells it.
// A record of an older survey whose answers all still fit is not counted: they read as the survey reads them now.

import { isBlankAnswer } from '../quality.js';
import { attrValue, descendants, firstChild, readXml } from './xmlTree.js';

const NODE_TAGS = new Set(['entity', 'text', 'number', 'range', 'code', 'boolean', 'date', 'time', 'coordinate', 'taxon', 'file']);
/**
 * collect_<prefix><name> (a question of the plot), collect_entity_<table>[<row>].<prefix><name> (a column of a table),
 * the prefix as Collect Earth writes it (impact.ts prefixOf), the longest first
 */
const PREFIXES = ['integer_range_', 'real_range_', 'integer_', 'real_', 'coord_', 'text_', 'code_', 'boolean_', 'date_', 'time_', 'taxon_', 'file_', 'range_'];
const TABLE_KEY = /^collect_entity_([^[.]+)(?:\[[^\]]*\])?\.(.+)$/;

/** A question's name in a summary key, its prefix taken away; undefined for a key of no known kind */
function nameIn(key: string): string | undefined {
  const prefix = PREFIXES.find((p) => key.startsWith(p));
  return prefix ? key.slice(prefix.length) : undefined;
}

/** The names of the survey's questions and tables, at every level */
function namesOf(survey: Uint8Array): Set<string> {
  const doc = readXml(survey);
  const schema = firstChild(doc.root, 'schema');
  const names = new Set<string>();
  for (const e of schema ? descendants(schema) : []) {
    if (!NODE_TAGS.has(e.name)) continue;
    const name = attrValue(doc, e, 'name');
    if (name) names.add(name);
  }
  return names;
}

/** Whether a record answers a question (or a table) the survey no longer has */
export function answersGone(names: ReadonlySet<string>, summary: Readonly<Record<string, string | null>>): boolean {
  for (const [key, value] of Object.entries(summary)) {
    if (value === null || isBlankAnswer(value)) continue;
    const table = TABLE_KEY.exec(key);
    if (table) {
      const column = nameIn(table[2]);
      if (!names.has(table[1]) || (column !== undefined && !names.has(column))) return true;
      continue;
    }
    if (key.startsWith('collect_entity_') || !key.startsWith('collect_')) continue;
    const name = nameIn(key.slice('collect_'.length));
    if (name !== undefined && !names.has(name)) return true;
  }
  return false;
}

export interface OlderPlots {
  /** Plots with a record of an earlier survey, either way */
  plots: number;
  /** Of them, the ones Collect Earth said so of */
  byRevision: number;
}

/** The plots whose records were last saved with an earlier version of the survey */
export function olderSurveyPlots(
  survey: Uint8Array,
  revision: string,
  records: readonly { recordKey: string; operator: string; summary: Readonly<Record<string, string | null>> }[],
  revisions: ReadonlyMap<string, string>,
): OlderPlots {
  const names = namesOf(survey);
  const older = new Set<string>();
  const said = new Set<string>();
  for (const r of records) {
    const made = revisions.get(`${r.recordKey} ${r.operator}`);
    if (made !== undefined) {
      if (made !== revision) {
        older.add(r.recordKey);
        said.add(r.recordKey);
      }
    } else if (answersGone(names, r.summary)) {
      older.add(r.recordKey);
    }
  }
  return { plots: older.size, byRevision: said.size };
}
