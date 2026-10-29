import type { RoundInfo } from './cep.js';
import { recordRound, unitOfRecord, type RecordRound } from './rounds.js';
import type { RecordRow } from './types.js';

const FIXED_COLUMNS = ['record_key', 'plot', 'round', 'assessment', 'operator', 'actively_saved', 'modified_on'];

/** The plot, round and assessment of a record (see exportRoundOf). */
export type RoundOf = (r: RecordRow) => RecordRound;

/**
 * The plot and round of each record, as the division of plots sees them: the record's
 * unit is resolved among `units` (the plot ids of every plot file) with the units the
 * operator holds as copies, and its round comes from recordRound. `copyHolders` maps a
 * unit to the usernames holding it as a quality-check copy (copyHoldersOf over the
 * divided files' overlap holdings).
 */
export function exportRoundOf(
  info: RoundInfo | null,
  units: ReadonlySet<string>,
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>,
): RoundOf {
  const copyUnits = new Map<string, Set<string>>();
  for (const [unit, users] of copyHolders) {
    for (const u of users) {
      let set = copyUnits.get(u);
      if (!set) {
        set = new Set();
        copyUnits.set(u, set);
      }
      set.add(unit);
    }
  }
  return (r) => recordRound(r, info, copyHolders, unitOfRecord(r.recordKey, units, info, copyUnits.get(r.operator)));
}

/**
 * The project's collected data as CSV, one row per non-deleted (recordKey,
 * operator): the fixed columns (with the plot, round and main / check / other
 * assessment of `roundOf`), then the sorted union of every record's summary
 * keys (a record without a key leaves that cell empty). RFC 4180: CRLF line ends,
 * fields quoted when they hold a comma, quote, CR or LF. Starts with a UTF-8 BOM
 * so Excel detects the encoding (plot names and answers are often non-ASCII).
 * A value that a spreadsheet would run as a formula gets a leading apostrophe.
 */
export function recordsCsv(records: RecordRow[], roundOf: RoundOf): string {
  const rows = records
    .filter((r) => !r.deleted)
    .sort((a, b) => compare(a.recordKey, b.recordKey) || compare(a.operator, b.operator));
  const summaryKeys = [...new Set(rows.flatMap((r) => Object.keys(r.summary)))].sort(compare);

  const lines = [[...FIXED_COLUMNS, ...summaryKeys].map(csvField).join(',')];
  for (const r of rows) {
    const { plot, round, assessment } = roundOf(r);
    const fixed = [r.recordKey, plot, round, assessment, r.operator, String(r.activelySaved), new Date(r.modifiedOn).toISOString()];
    const summary = summaryKeys.map((k) => r.summary[k] ?? '');
    lines.push([...fixed, ...summary].map(csvField).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

function csvField(raw: string): string {
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
