// The columns of a plot file and the values in them: for dividing a file by a column
// (the division routes) and for filtering the answers by one (the Quality tab, Task 4).
import type { PlotFile } from './plots.js';

/** Most distinct values a column may have for them to be listed. */
export const MAX_LISTED_VALUES = 200;

/** Each plot's value in a column (of its first row), in plotIds order. */
export function columnValues(file: PlotFile, column: number): string[] {
  const valueOf = new Map<string, string>();
  for (const row of file.rows) {
    if (!valueOf.has(row.id)) {
      valueOf.set(row.id, row.fields[column] ?? '');
    }
  }
  return file.plotIds.map((id) => valueOf.get(id) ?? '');
}

export interface PlotColumn {
  index: number;
  /** The header's name, null when the file has no header. */
  name: string | null;
  distinctCount: number;
  /** Each value with its plots, by value (the empty value last); null for the id column and a column of over MAX_LISTED_VALUES values. */
  values: { value: string; count: number }[] | null;
}

/** Every column of a plot file, with its values when there are few. */
export function plotColumns(plotFile: PlotFile): PlotColumn[] {
  const columns: PlotColumn[] = [];
  for (let index = 0; index < plotFile.columnCount; index += 1) {
    const counts = new Map<string, number>();
    for (const value of columnValues(plotFile, index)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    // The id column is never listed: every plot has its own.
    const listed = index > 0 && counts.size <= MAX_LISTED_VALUES;
    columns.push({
      index,
      name: plotFile.header ? plotFile.header.fields[index] ?? '' : null,
      distinctCount: counts.size,
      values: listed
        ? [...counts.entries()]
            .map(([value, count]) => ({ value, count }))
            // By value, the empty value last.
            .sort((a, b) => (a.value === '') !== (b.value === '') ? (a.value === '' ? 1 : -1)
              : a.value.localeCompare(b.value, undefined, { numeric: true }))
        : null,
    });
  }
  return columns;
}

/** The plots (ids) whose value in `column` is `value`. */
export function plotsWithValue(plotFile: PlotFile, column: number, value: string): Set<string> {
  const values = columnValues(plotFile, column);
  const out = new Set<string>();
  plotFile.plotIds.forEach((id, i) => {
    if (values[i] === value) out.add(id);
  });
  return out;
}
