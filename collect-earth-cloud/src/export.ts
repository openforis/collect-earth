import { recordId, type AnalysisColumn, type AnalysisModel } from './analysis.js';
import type { RoundInfo } from './cep.js';
import type { FinalAnswer } from './quality.js';
import { copyUnitsByUser, recordRound, unitOfRecord, type RecordRound } from './rounds.js';
import { QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR } from './surveyOutline.js';
import type { RecordRow } from './types.js';

const FIXED_COLUMNS = ['record_key', 'plot', 'round', 'assessment', 'final', 'reference', 'operator', 'actively_saved', 'modified_on'];

/** The plot, round and assessment of a record (see exportRoundOf). */
export type RoundOf = (r: RecordRow) => RecordRound;
/** The coordinator's final answer for a record (finalAnswers in quality.ts). */
export type FinalOf = (r: RecordRow) => FinalAnswer;
/** Whether a record is of a reference plot (Task 14): its round-2 records are measurements against the reference, not checks to decide. */
export type ReferenceOf = (r: RecordRow) => boolean;

/**
 * The plot and round of each record, as the division of plots sees them: the record's
 * unit is resolved among `units` (the plot ids of every plot file) with the units the
 * operator holds as copies, and its round comes from recordRound. `copyHolders` maps a
 * unit to the usernames holding it as a quality-check copy (copyHoldersOf over the
 * divided files' holdings, main and copies, so a person who holds the plot as main
 * in some file is not taken for its checker).
 */
export function exportRoundOf(
  info: RoundInfo | null,
  units: ReadonlySet<string>,
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>,
): RoundOf {
  const copyUnits = copyUnitsByUser(copyHolders);
  return (r) => recordRound(r, info, copyHolders, unitOfRecord(r.recordKey, units, info, copyUnits.get(r.operator)));
}

/** How a spreadsheet in a language reads a CSV, as the dashboard's other downloads (web/src/csv.ts csvFormat). */
export interface CsvFormat {
  separator: string;
  decimal: string;
}
export const csvFormatOf = (language: string): CsvFormat => (language.toLowerCase().startsWith('en') ? { separator: ',', decimal: '.' } : { separator: ';', decimal: ',' });

/** What a download adds to or keeps from the export (all optional: the export as it always was). */
export interface ExportOptions {
  /** Only these records get a row; the columns stay every record's, so the downloads of a project line up. */
  keep?: (r: RecordRow) => boolean;
  /** The labels of a summary key's answers (answerLabels), or undefined: no `<key>_label` column. */
  labelsOf?: (key: string) => ((value: string) => string) | undefined;
  /** expansion_factor and plot_weight of the record that counts for its plot, by recordId (factorsByRecord); absent: no such columns. */
  weights?: ReadonlyMap<string, { factor: number; weight: number }>;
  /** The CSV's separators: English's when not given. */
  format?: CsvFormat;
}

/**
 * The project's collected data as CSV, one row per non-deleted (recordKey,
 * operator): the fixed columns (with the plot, round and main / check / other
 * assessment of `roundOf`, the yes / no / recheck / blank of `finalOf`, and "yes" in `reference` for a
 * record of a reference plot, Task 14: never decided, its checks measure the collectors), then the sorted union of every record's summary
 * keys (a record without a key leaves that cell empty). RFC 4180: CRLF line ends,
 * fields quoted when they hold the separator, a quote, CR or LF. Starts with a UTF-8 BOM
 * so Excel detects the encoding (plot names and answers are often non-ASCII).
 * A value that a spreadsheet would run as a formula gets a leading apostrophe.
 * The summary keys of `leaveOut` get no column (the coordinator's note, Task 16: not an answer).
 * In `options.format`, the numbers of the survey (integer, real, coordinates) and the weights get its decimal mark.
 */
export function recordsCsv(
  records: RecordRow[],
  roundOf: RoundOf,
  finalOf: FinalOf = () => '',
  referenceOf: ReferenceOf = () => false,
  leaveOut: ReadonlySet<string> = new Set(),
  options: ExportOptions = {},
): string {
  const format = options.format ?? csvFormatOf('en');
  const { columns, rows } = recordsTable(records, roundOf, finalOf, referenceOf, leaveOut, options);
  const numeric = columns.map(isNumberColumn);
  const lines = [columns.map((c) => csvField(c, format.separator))];
  for (const row of rows) lines.push(row.map((v, i) => csvField(numeric[i] ? localNumber(v, format) : v, format.separator)));
  return `﻿${lines.map((fields) => fields.join(format.separator)).join('\r\n')}\r\n`;
}

const NUMBER = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const WEIGHT_COLUMNS = ['expansion_factor', 'plot_weight'];

/** A column of numbers: a weight, or a survey answer of type integer, real or coordinate (the type is the attribute's prefix). */
const isNumberColumn = (column: string) => WEIGHT_COLUMNS.includes(column) || /^(collect_)?(integer|real|coord)_/.test(column.slice(column.lastIndexOf('.') + 1));

/** A number with the format's decimal mark; a place's two ("lat,lon") split by the format's separator; anything else as it is. */
function localNumber(value: string, format: CsvFormat): string {
  const parts = value.split(',');
  return parts.every((p) => NUMBER.test(p)) ? parts.map((p) => p.replace('.', format.decimal)).join(format.separator) : value;
}

/**
 * The labels of the code answers by summary key (the survey's plot, its single and its multiple entities), in `language`
 * when the survey has it, else in its default language; a code without a label stays the code. Several values: their
 * labels joined as the codes are.
 */
export function answerLabels(model: AnalysisModel, language: string): (key: string) => ((value: string) => string) | undefined {
  const fallback = model.languages[0];
  const lang = model.languages.includes(language) ? language : fallback;
  const listsOf = (columns: readonly AnalysisColumn[]) => new Map(columns.flatMap((c) => (c.type === 'code' && c.list && model.lists[c.list] ? [[c.key, model.lists[c.list]] as const] : [])));
  const plot = listsOf(model.tables[0].columns);
  const entities = new Map(model.tables.slice(1).map((t) => [t.name, listsOf(t.columns)]));
  return (key) => {
    // a multiple entity's answer: collect_entity_<name>[<its key>].<attribute>
    const entity = /^collect_entity_(\w+)\[/.exec(key);
    const items = plot.get(key) ?? (entity ? entities.get(entity[1])?.get(key.slice(key.lastIndexOf('.') + 1)) : undefined);
    if (!items) return undefined;
    const labels = new Map(items.map((i) => [i.code, i.labels[lang] || i.labels[fallback] || i.code]));
    return (value) =>
      value
        .split(SUMMARY_VALUES_SEPARATOR)
        .map((v) => {
          const code = v.split(QUALIFIER_SEPARATOR)[0];
          return labels.get(code) ?? code;
        })
        .join(SUMMARY_VALUES_SEPARATOR);
  };
}

/** The export's columns and rows, raw (before recordsCsv quotes them): also the map exports' attributes. */
export interface RecordsTable {
  columns: string[];
  rows: string[][];
}

/** What recordsCsv writes, as columns and rows of raw values. */
export function recordsTable(
  records: RecordRow[],
  roundOf: RoundOf,
  finalOf: FinalOf = () => '',
  referenceOf: ReferenceOf = () => false,
  leaveOut: ReadonlySet<string> = new Set(),
  options: ExportOptions = {},
): RecordsTable {
  const all = records.filter((r) => !r.deleted);
  const kept = (options.keep ? all.filter(options.keep) : all).sort((a, b) => compare(a.recordKey, b.recordKey) || compare(a.operator, b.operator));
  const summaryKeys = [...new Set(all.flatMap((r) => Object.keys(r.summary)))].filter((k) => !leaveOut.has(k)).sort(compare);
  const labels = summaryKeys.map((k) => options.labelsOf?.(k));
  const { weights } = options;
  const rows = kept.map((r) => {
    const { plot, round, assessment } = roundOf(r);
    const fixed = [r.recordKey, plot, round, assessment, finalOf(r), referenceOf(r) ? 'yes' : '', r.operator, String(r.activelySaved), new Date(r.modifiedOn).toISOString()];
    const answers = summaryKeys.flatMap((k, i) => {
      const value = r.summary[k] ?? '';
      return labels[i] ? [value, value === '' ? '' : labels[i](value)] : [value];
    });
    // Only the record the analysis counts for its plot: a sum of the column counts each plot once.
    const weight = weights?.get(recordId(r.recordKey, r.operator));
    return [...fixed, ...answers, ...(weights ? (weight ? [String(weight.factor), String(weight.weight)] : ['', '']) : [])];
  });
  const answerColumns = summaryKeys.flatMap((k, i) => (labels[i] ? [k, `${k}_label`] : [k]));
  return { columns: [...FIXED_COLUMNS, ...answerColumns, ...(weights ? WEIGHT_COLUMNS : [])], rows };
}

export function csvField(raw: string, separator = ','): string {
  // = + - @ start a formula in Excel and LibreOffice; tab and CR can hide one.
  // Plain numbers stay as they are, with either decimal mark: negative coordinates are common.
  const formula = /^[=+\-@\t\r]/.test(raw) && !/^[-+]?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(raw);
  const value = formula ? `'${raw}` : raw;
  return /["\r\n]/.test(value) || value.includes(separator) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Plain code-point order: stable across locales and servers. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
