// One CSV writer for every download of the dashboard (the people table, daily activity,
// review decisions, differences): cells a spreadsheet would run as formulas are escaped, and
// the separators are those a spreadsheet in the person's language reads.

export interface CsvFormat {
  separator: string;
  decimal: string;
}

/**
 * How a spreadsheet in the person's language reads a CSV: in English a comma between
 * cells and a point in numbers; in Spanish, French and Portuguese (where the comma is the
 * decimal separator) a semicolon between cells and a comma in numbers.
 */
export function csvFormat(language: string): CsvFormat {
  return language.toLowerCase().startsWith("en") ? { separator: ",", decimal: "." } : { separator: ";", decimal: "," };
}

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting with = + - @,
 * a tab or a carriage return) gets a ' in front; cells with the separator, a quote or a
 * line break are quoted. Numbers are written with the decimal separator given.
 */
export function csvCell(value: string | number | null, format: CsvFormat = { separator: ",", decimal: "." }): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value).replace(".", format.decimal) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  const special = format.separator === ";" ? /[";\r\n]/ : /[",\r\n]/;
  return special.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole CSV in the person's language: a header row, then the rows, each line ended by CRLF. */
export function csvText(header: readonly string[], rows: readonly (readonly (string | number | null)[])[], language: string): string {
  const format = csvFormat(language);
  const line = (values: readonly (string | number | null)[]) => values.map((v) => csvCell(v, format)).join(format.separator);
  return `${[line(header), ...rows.map(line)].join("\r\n")}\r\n`;
}

/** The file a spreadsheet opens with its accents right: a byte order mark, then the text. */
export function csvBlob(text: string): Blob {
  return new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
}

/** "2026-11-01 14:05" in the browser's time zone, for a CSV. */
export function csvTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
