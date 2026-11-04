import type { RoundInfo } from './cep.js';
import type { FinalAnswer } from './quality.js';
import { copyUnitsByUser, recordRound, unitOfRecord, type RecordRound } from './rounds.js';
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

/**
 * The project's collected data as CSV, one row per non-deleted (recordKey,
 * operator): the fixed columns (with the plot, round and main / check / other
 * assessment of `roundOf`, the yes / no / recheck / blank of `finalOf`, and "yes" in `reference` for a
 * record of a reference plot, Task 14: never decided, its checks measure the collectors), then the sorted union of every record's summary
 * keys (a record without a key leaves that cell empty). RFC 4180: CRLF line ends,
 * fields quoted when they hold a comma, quote, CR or LF. Starts with a UTF-8 BOM
 * so Excel detects the encoding (plot names and answers are often non-ASCII).
 * A value that a spreadsheet would run as a formula gets a leading apostrophe.
 * The summary keys of `leaveOut` get no column (the coordinator's note, Task 16: not an answer).
 */
export function recordsCsv(
  records: RecordRow[],
  roundOf: RoundOf,
  finalOf: FinalOf = () => '',
  referenceOf: ReferenceOf = () => false,
  leaveOut: ReadonlySet<string> = new Set(),
): string {
  const rows = records
    .filter((r) => !r.deleted)
    .sort((a, b) => compare(a.recordKey, b.recordKey) || compare(a.operator, b.operator));
  const summaryKeys = [...new Set(rows.flatMap((r) => Object.keys(r.summary)))].filter((k) => !leaveOut.has(k)).sort(compare);

  const lines = [[...FIXED_COLUMNS, ...summaryKeys].map(csvField).join(',')];
  for (const r of rows) {
    const { plot, round, assessment } = roundOf(r);
    const fixed = [r.recordKey, plot, round, assessment, finalOf(r), referenceOf(r) ? 'yes' : '', r.operator, String(r.activelySaved), new Date(r.modifiedOn).toISOString()];
    const summary = summaryKeys.map((k) => r.summary[k] ?? '');
    lines.push([...fixed, ...summary].map(csvField).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvField(raw: string): string {
  // = + - @ start a formula in Excel and LibreOffice; tab and CR can hide one.
  // Plain numbers stay as they are: negative coordinates are common.
  const formula = /^[=+\-@\t\r]/.test(raw) && !/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw);
  const value = formula ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Plain code-point order: stable across locales and servers. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
