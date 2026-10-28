import type { RecordRow } from './types.js';

const FIXED_COLUMNS = ['record_key', 'operator', 'actively_saved', 'modified_on'];

/**
 * The project's collected data as CSV, one row per non-deleted (recordKey,
 * operator): the fixed columns, then the sorted union of every record's summary
 * keys (a record without a key leaves that cell empty). RFC 4180: CRLF line ends,
 * fields quoted when they hold a comma, quote, CR or LF. Starts with a UTF-8 BOM
 * so Excel detects the encoding (plot names and answers are often non-ASCII).
 */
export function recordsCsv(records: RecordRow[]): string {
  const rows = records
    .filter((r) => !r.deleted)
    .sort((a, b) => compare(a.recordKey, b.recordKey) || compare(a.operator, b.operator));
  const summaryKeys = [...new Set(rows.flatMap((r) => Object.keys(r.summary)))].sort(compare);

  const lines = [[...FIXED_COLUMNS, ...summaryKeys].map(csvField).join(',')];
  for (const r of rows) {
    const fixed = [r.recordKey, r.operator, String(r.activelySaved), new Date(r.modifiedOn).toISOString()];
    const summary = summaryKeys.map((k) => r.summary[k] ?? '');
    lines.push([...fixed, ...summary].map(csvField).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Plain code-point order: stable across locales and servers. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
