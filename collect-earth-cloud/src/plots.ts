/**
 * Reads a plot file the way Collect Earth does, and builds one person's own file
 * from it (the header row, if any, plus only their plots).
 *
 * Parsing works on the bytes: the separators, quotes and line breaks are ASCII,
 * which never occur inside a UTF-8 (or Latin-1) multi-byte character, so every row
 * keeps its exact bytes in a built file whatever the file's encoding.
 */

const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Tried in this order, as CsvReaderUtils.detectCsvReader does. */
export const SEPARATORS = [',', ';', '\t', '|'] as const;
/** CsvReaderUtils.PLOT_FILE_MINIMUM_COLUMNS. */
const MINIMUM_COLUMNS = 3;

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

export interface PlotRow {
  /** Byte offsets: the row's text is [start, end); [start, next) includes its line break. */
  start: number;
  end: number;
  next: number;
  /** Unquoted field values, trimmed. */
  fields: string[];
  /** The plot id: the first field. */
  id: string;
}

export interface PlotFile {
  data: Buffer;
  bom: boolean;
  separator: string;
  /** The first line break of the file: used after a last row that had none. */
  lineEnding: '\r\n' | '\n';
  header: PlotRow | null;
  /** The data rows, in file order (empty lines left out). */
  rows: PlotRow[];
  /** The unique plot ids in file order; rows sharing an id are one plot. */
  plotIds: string[];
  /** Widest row, in fields (header included). */
  columnCount: number;
}

/**
 * Reads one row from pos. Quotes work as in opencsv: a quote opens or closes a
 * quoted part anywhere in a field, and `""` inside one is a literal quote.
 */
function readRow(buf: Buffer, pos: number, sep: number): { fields: string[]; end: number; next: number } {
  const n = buf.length;
  const fields: string[] = [];
  let i = pos;
  for (;;) {
    let value = '';
    let segStart = i;
    let inQuotes = false;
    while (i < n) {
      const b = buf[i];
      if (b === QUOTE) {
        if (inQuotes && i + 1 < n && buf[i + 1] === QUOTE) {
          value += buf.toString('utf8', segStart, i + 1);
          i += 2;
        } else {
          value += buf.toString('utf8', segStart, i);
          inQuotes = !inQuotes;
          i += 1;
        }
        segStart = i;
        continue;
      }
      if (!inQuotes && (b === sep || b === LF || b === CR)) {
        break;
      }
      i += 1;
    }
    value += buf.toString('utf8', segStart, i);
    fields.push(value.trim());
    if (i >= n) {
      return { fields, end: n, next: n };
    }
    if (buf[i] === sep) {
      i += 1;
      continue;
    }
    const end = i;
    i += buf[i] === CR && i + 1 < n && buf[i + 1] === LF ? 2 : 1;
    return { fields, end, next: i };
  }
}

/** The end of the physical line starting at pos, and the start of the next one. */
function lineAt(buf: Buffer, pos: number): { end: number; next: number } {
  let i = pos;
  while (i < buf.length && buf[i] !== LF && buf[i] !== CR) {
    i += 1;
  }
  if (i >= buf.length) {
    return { end: i, next: i };
  }
  return { end: i, next: buf[i] === CR && buf[i + 1] === LF ? i + 2 : i + 1 };
}

function isBlank(buf: Buffer, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    const b = buf[i];
    if (b !== 0x20 && b !== 0x09) {
      return false;
    }
  }
  return true;
}

export function isNumber(value: string): boolean {
  return NUMBER_RE.test(value.trim());
}

export function parsePlotFile(data: Buffer): PlotFile {
  const bom = data.length >= 3 && data.subarray(0, 3).equals(BOM);
  let pos = bom ? 3 : 0;

  // Skip leading empty lines; the separator is detected on the first real one.
  while (pos < data.length) {
    const line = lineAt(data, pos);
    if (!isBlank(data, pos, line.end)) {
      break;
    }
    pos = line.next;
  }
  let separator: string = SEPARATORS[0];
  for (const candidate of SEPARATORS) {
    if (readRow(data, pos, candidate.charCodeAt(0)).fields.length >= MINIMUM_COLUMNS) {
      separator = candidate;
      break;
    }
  }
  const sep = separator.charCodeAt(0);

  let lineEnding: '\r\n' | '\n' | null = null;
  let header: PlotRow | null = null;
  const rows: PlotRow[] = [];
  const seen = new Set<string>();
  const plotIds: string[] = [];
  let columnCount = 0;
  let first = true;
  while (pos < data.length) {
    const start = pos;
    const r = readRow(data, pos, sep);
    pos = r.next > start ? r.next : data.length;
    if (lineEnding === null && r.next > r.end) {
      lineEnding = data[r.end] === CR && data[r.end + 1] === LF ? '\r\n' : '\n';
    }
    if (r.fields.every((f) => f.length === 0) && isBlankRow(data, start, r.end, sep)) {
      continue;
    }
    const row: PlotRow = { start, end: r.end, next: r.next, fields: r.fields, id: r.fields[0] ?? '' };
    columnCount = Math.max(columnCount, r.fields.length);
    // A header has no number in it; data rows always hold numeric coordinates.
    if (first && !r.fields.some(isNumber)) {
      header = row;
      first = false;
      continue;
    }
    first = false;
    rows.push(row);
    if (!seen.has(row.id)) {
      seen.add(row.id);
      plotIds.push(row.id);
    }
  }
  return { data, bom, separator, lineEnding: lineEnding ?? '\n', header, rows, plotIds, columnCount };
}

/** An empty line, or one of only separators and spaces (",,,"). */
function isBlankRow(buf: Buffer, start: number, end: number, sep: number): boolean {
  for (let i = start; i < end; i += 1) {
    const b = buf[i];
    if (b !== 0x20 && b !== 0x09 && b !== sep) {
      return false;
    }
  }
  return true;
}

/**
 * One person's file: the BOM and header row of the original (if any), then the rows
 * of the given plots in file order, each with its exact bytes and line break. Linear
 * in the file size.
 */
export function buildPlotFile(file: PlotFile, plotKeys: ReadonlySet<string>): Buffer {
  const parts: Buffer[] = [];
  if (file.bom) {
    parts.push(BOM);
  }
  const lineEnding = Buffer.from(file.lineEnding, 'ascii');
  const rows = file.rows.filter((row) => plotKeys.has(row.id));
  const all = file.header ? [file.header, ...rows] : rows;
  all.forEach((row, i) => {
    parts.push(file.data.subarray(row.start, row.next));
    // A row without a line break (the original's last) gets one if more follow.
    if (row.next === row.end && i < all.length - 1) {
      parts.push(lineEnding);
    }
  });
  return Buffer.concat(parts);
}

/**
 * The plot a record belongs to. The client's record key is the survey's key values
 * joined by ",", the plot id first: so the key is the id, or starts with "id,".
 */
export function plotOfRecordKey(recordKey: string, plotIds: ReadonlySet<string>): string | null {
  if (plotIds.has(recordKey)) {
    return recordKey;
  }
  for (let i = recordKey.indexOf(','); i >= 0; i = recordKey.indexOf(',', i + 1)) {
    const prefix = recordKey.slice(0, i);
    if (plotIds.has(prefix)) {
      return prefix;
    }
  }
  return null;
}
