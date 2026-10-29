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
  /** Each field's bytes are [fieldStarts[i], fieldEnds[i]): quotes and spaces included, separators not. */
  fieldStarts: number[];
  fieldEnds: number[];
  /** The plot id (assignment unit): the first keyCount fields joined by ",". */
  id: string;
}

export interface PlotFile {
  data: Buffer;
  bom: boolean;
  separator: string;
  /** The first line break of the file: used after a last row that had none. */
  lineEnding: '\r\n' | '\n' | '\r';
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
function readRow(
  buf: Buffer,
  pos: number,
  sep: number,
): { fields: string[]; fieldStarts: number[]; fieldEnds: number[]; end: number; next: number } {
  const n = buf.length;
  const fields: string[] = [];
  const fieldStarts: number[] = [];
  const fieldEnds: number[] = [];
  let i = pos;
  for (;;) {
    fieldStarts.push(i);
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
    fieldEnds.push(i);
    if (i >= n) {
      return { fields, fieldStarts, fieldEnds, end: n, next: n };
    }
    if (buf[i] === sep) {
      i += 1;
      continue;
    }
    const end = i;
    i += buf[i] === CR && i + 1 < n && buf[i + 1] === LF ? 2 : 1;
    return { fields, fieldStarts, fieldEnds, end, next: i };
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

/**
 * Reads a plot file. `keyCount` is how many of the first columns are the plot's key
 * (fileKeyCount of the project's RoundInfo): they make the plot id, joined by ",",
 * the way Collect Earth joins the key values of a record.
 */
export function parsePlotFile(data: Buffer, keyCount = 1): PlotFile {
  const idFields = Math.max(1, Math.floor(keyCount));
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

  let lineEnding: '\r\n' | '\n' | '\r' | null = null;
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
      lineEnding = data[r.end] === CR ? (data[r.end + 1] === LF ? '\r\n' : '\r') : '\n';
    }
    if (r.fields.every((f) => f.length === 0) && isBlankRow(data, start, r.end, sep)) {
      continue;
    }
    const id = idFields === 1 ? r.fields[0] ?? '' : r.fields.slice(0, idFields).join(',');
    const row: PlotRow = {
      start,
      end: r.end,
      next: r.next,
      fields: r.fields,
      fieldStarts: r.fieldStarts,
      fieldEnds: r.fieldEnds,
      id,
    };
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
 * The round column of a served plot file.
 * - insert: a new column after the first (the round the server added to an id-only
 *   survey); the header, if any, gets "round".
 * - replace: the value of column `index` (a survey with its own round), the header left
 *   as it is. A row whose value does not change keeps its bytes.
 */
export type RoundColumn =
  | { kind: 'insert'; value: (plotId: string) => string }
  | { kind: 'replace'; index: number; value: (plotId: string, current: string) => string };

/** A field's text as written in the file: quoted when it holds the separator, a quote or a line break. */
function fieldText(value: string, separator: string): string {
  if (value.includes(separator) || /["\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * One person's file: the BOM and header row of the original (if any), then the rows
 * of the given plots (every plot with null) in file order, each with its exact bytes
 * and line break, and the round column when one is given. Linear in the file size:
 * the value of each distinct round text is encoded once, and the rows are copied
 * into one buffer of the final size.
 */
export function buildPlotFile(file: PlotFile, plotKeys: ReadonlySet<string> | null, round?: RoundColumn): Buffer {
  const data = file.data;
  const lineEnding = Buffer.from(file.lineEnding, 'ascii');
  const rows = plotKeys === null ? file.rows : file.rows.filter((row) => plotKeys.has(row.id));
  const all = file.header ? [file.header, ...rows] : rows;
  const encoded = new Map<string, Buffer>();
  const encode = (text: string): Buffer => {
    let buf = encoded.get(text);
    if (!buf) {
      buf = Buffer.from(text, 'utf8');
      encoded.set(text, buf);
    }
    return buf;
  };
  // Per row: the bytes put in (or null), and where in the row they go, [cutStart, cutEnd)
  // of the original being left out.
  const inserts: (Buffer | null)[] = new Array(all.length).fill(null);
  const cutStarts = new Int32Array(all.length);
  const cutEnds = new Int32Array(all.length);
  let size = file.bom ? BOM.length : 0;
  for (let i = 0; i < all.length; i += 1) {
    const row = all[i];
    size += row.next - row.start;
    if (row.next === row.end && i < all.length - 1) {
      size += lineEnding.length;
    }
    if (!round) {
      continue;
    }
    const isHeader = row === file.header;
    if (round.kind === 'insert') {
      const value = isHeader ? 'round' : round.value(row.id);
      inserts[i] = encode(file.separator + fieldText(value, file.separator));
      cutStarts[i] = cutEnds[i] = row.fieldEnds[0];
    } else {
      if (isHeader || round.index < 0 || round.index >= row.fields.length) {
        continue;
      }
      const current = row.fields[round.index];
      const value = round.value(row.id, current);
      if (value === current) {
        continue;
      }
      inserts[i] = encode(fieldText(value, file.separator));
      cutStarts[i] = row.fieldStarts[round.index];
      cutEnds[i] = row.fieldEnds[round.index];
    }
    size += inserts[i]!.length - (cutEnds[i] - cutStarts[i]);
  }
  const out = Buffer.allocUnsafe(size);
  let at = 0;
  if (file.bom) {
    at += BOM.copy(out, at);
  }
  for (let i = 0; i < all.length; i += 1) {
    const row = all[i];
    const insert = inserts[i];
    if (insert) {
      at += data.copy(out, at, row.start, cutStarts[i]);
      at += insert.copy(out, at);
      at += data.copy(out, at, cutEnds[i], row.next);
    } else {
      at += data.copy(out, at, row.start, row.next);
    }
    // A row without a line break (the original's last) gets one if more follow.
    if (row.next === row.end && i < all.length - 1) {
      at += lineEnding.copy(out, at);
    }
  }
  // allocUnsafe: a size computed wrong would serve leftover memory.
  if (at !== size) {
    throw new Error(`buildPlotFile: wrote ${at} bytes of ${size}`);
  }
  return out;
}
