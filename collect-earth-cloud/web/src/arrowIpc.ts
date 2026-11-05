// The rows of a cube (an Arrow table from DuckDB) as the IPC bytes Perspective takes. Kept apart from analysisEngine.ts,
// which loads DuckDB's and Perspective's wasm, so it can be tested on its own.
import { DataType, Table, tableToIPC, Utf8, vectorFromArray, type Vector } from "apache-arrow";

/**
 * A yes/no column with no answer in any row (a question nobody answered yet) as a text column of nulls: Arrow JS 17
 * writes an all-null Bool column without its values buffer, and Perspective's Arrow reader refuses the whole table
 * ("Buffer #1 too small in array of type bool"), so the analysis page showed nothing. Other columns are kept as they are.
 */
function readable(table: Table): Table {
  const columns: Record<string, Vector> = {};
  let changed = false;
  for (const field of table.schema.fields) {
    const column = table.getChild(field.name)!;
    if (DataType.isBool(field.type) && column.length > 0 && column.nullCount >= column.length) {
      columns[field.name] = vectorFromArray(new Array<string | null>(column.length).fill(null), new Utf8());
      changed = true;
    } else {
      columns[field.name] = column;
    }
  }
  return changed ? new Table(columns) : table;
}

/** The IPC stream of a table: an ArrayBuffer of its own, not a view on one. */
export function toIpc(table: Table): ArrayBuffer {
  const bytes = tableToIPC(readable(table), "stream");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
