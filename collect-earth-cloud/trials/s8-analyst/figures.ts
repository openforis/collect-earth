// Trial S8: a view's figures, as the pivot would show them, computed in DuckDB; and the comparison of the model's view
// with the hand-written one. Two views agree when they group by the same fields (rows and columns in any order) and
// give, for every expected measure, the same number in every cell. A view with an extra measure still agrees; one
// with a missing filter, a wrong measure or another field does not, whatever its title says.
import type { DuckDBConnection } from '@duckdb/node-api';
import type { ProposedFilter } from '../../src/ai/analysisViews.ts';

export interface ViewLike {
  rows: string[];
  columns: string[];
  measures: string[];
  filters: ProposedFilter[];
}

const ident = (id: string) => `"${id.replace(/"/g, '""')}"`;
const str = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** The SQL expression of a field of the plot table: the collection's month and week as the dashboard makes them. */
function field(id: string): string {
  if (id === '_saved_month') return `strftime(_saved_on, '%Y-%m')`;
  if (id === '_saved_week') return `strftime(_saved_on, '%G-W%V')`;
  return ident(id);
}

function condition(f: ProposedFilter): string {
  const c = field(f.column);
  switch (f.op) {
    case 'is':
      return `CAST(${c} AS VARCHAR) IN (${(f.codes ?? []).map(str).join(', ')})`;
    case 'isNot':
      return `(${c} IS NULL OR CAST(${c} AS VARCHAR) NOT IN (${(f.codes ?? []).map(str).join(', ')}))`;
    case 'yes':
      return `${c} = TRUE`;
    case 'no':
      return `${c} = FALSE`;
    case 'answered':
      return `${c} IS NOT NULL`;
    case 'notAnswered':
      return `${c} IS NULL`;
    case 'atLeast':
      return typeof f.value === 'number' ? `${c} >= ${f.value}` : `${c} >= DATE ${str(String(f.value))}`;
    case 'atMost':
      return typeof f.value === 'number' ? `${c} <= ${f.value}` : `${c} <= DATE ${str(String(f.value))}`;
  }
}

/**
 * A measure's SQL over the group: the shares as the pivot computes them ("% of the total" over every cell shown, "% of
 * the row above" within the first field's group).
 */
function measure(id: string, groups: string[]): string {
  const parent = groups.length > 1 ? `PARTITION BY ${groups[0]}` : '';
  const share = (x: string, over: string) => `100.0 * ${x} / NULLIF(SUM(${x}) OVER (${over}), 0)`;
  switch (id) {
    case 'plots':
    case 'rows':
      return 'COUNT(*)';
    case 'plotsPct':
    case 'rowsPct':
      return share('COUNT(*)', '');
    case 'plotsPctParent':
    case 'rowsPctParent':
      return share('COUNT(*)', parent);
    case 'area':
      return 'SUM(expansion_factor)';
    case 'areaPct':
      return share('SUM(expansion_factor)', '');
    case 'areaPctParent':
      return share('SUM(expansion_factor)', parent);
  }
  const [fn, col] = id.split(':');
  if (fn === 'avg') return `AVG(${ident(col)})`;
  if (fn === 'sum') return `SUM(${ident(col)})`;
  throw new Error(`unknown measure ${id}`);
}

/** The cells of a view: the group's values (by field id, so the order of rows and columns does not matter) and each measure. */
export type Cells = Map<string, Record<string, number | null>>;

export async function figures(conn: DuckDBConnection, view: ViewLike): Promise<{ cells: Cells; sql: string }> {
  const fields = [...view.rows, ...view.columns];
  const groups = fields.map(field);
  const select = [...fields.map((f, i) => `CAST(${groups[i]} AS VARCHAR) AS ${ident('g:' + f)}`), ...view.measures.map((m) => `${measure(m, groups)} AS ${ident('m:' + m)}`)];
  // As the page opens (src/analysisView.ts there): first assessments only, unless the view asks about the assessment
  const filters = view.filters.some((f) => f.column === '_assessment') ? view.filters : [...view.filters, { column: '_assessment', op: 'is' as const, codes: ['main'] }];
  const where = `WHERE ${filters.map(condition).join(' AND ')}`;
  const sql = `SELECT ${select.join(', ')} FROM plot ${where} GROUP BY ${groups.length ? groups.join(', ') : 'ALL'}`;
  const reader = await conn.runAndReadAll(sql);
  const cells: Cells = new Map();
  for (const row of reader.getRowObjectsJS()) {
    const key = [...fields].sort().map((f) => `${f}=${row['g:' + f] ?? '∅'}`).join('|');
    const values: Record<string, number | null> = {};
    for (const m of view.measures) {
      const v = row['m:' + m];
      values[m] = v === null || v === undefined ? null : Number(v);
    }
    cells.set(key, values);
  }
  return { cells, sql };
}

export type Verdict = 'same' | 'same figures' | 'wrong fields' | 'wrong measure' | 'wrong figures' | 'no answer';

/**
 * "same": the same fields, measures and filters as the hand-written view; "same figures": built otherwise (another
 * filter, an extra measure, rows and columns swapped) but every expected figure is right; else what differs.
 */
export async function compare(conn: DuckDBConnection, expected: ViewLike, actual: ViewLike | null): Promise<{ verdict: Verdict; detail: string }> {
  if (!actual) return { verdict: 'no answer', detail: 'the model gave no usable view' };
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (!sameSet([...expected.rows, ...expected.columns], [...actual.rows, ...actual.columns])) {
    return { verdict: 'wrong fields', detail: `expected ${[...expected.rows, ...expected.columns].join(' × ')}, got ${[...actual.rows, ...actual.columns].join(' × ')}` };
  }
  const missing = expected.measures.filter((m) => !actual.measures.includes(m));
  if (missing.length) {
    // A share "of the row above" with one field is the share of the total: the same figures
    const equivalent = missing.every((m) => {
      const alt = m.endsWith('PctParent') ? m.replace('PctParent', 'Pct') : m.endsWith('Pct') ? `${m}Parent` : null;
      return alt && actual.measures.includes(alt) && expected.rows.length + expected.columns.length === 1;
    });
    if (!equivalent) return { verdict: 'wrong measure', detail: `expected ${expected.measures.join(', ')}, got ${actual.measures.join(', ')}` };
  }
  const e = await figures(conn, expected);
  // the model's view with the expected measure names where it used an equivalent one
  const asked = { ...actual, measures: [...new Set([...actual.measures, ...expected.measures])] };
  const a = await figures(conn, asked);
  const bad: string[] = [];
  for (const [key, values] of e.cells) {
    const got = a.cells.get(key);
    for (const m of expected.measures) {
      const x = values[m];
      const y = got?.[m] ?? null;
      if (x === null && y === null) continue;
      if (x === null || y === null || Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x))) bad.push(`${key} ${m}: expected ${x}, got ${y}`);
    }
  }
  for (const key of a.cells.keys()) if (!e.cells.has(key)) bad.push(`${key}: a cell the expected view has not`);
  if (bad.length) return { verdict: 'wrong figures', detail: `${bad.length} cells differ, e.g. ${bad.slice(0, 2).join('; ')}` };
  const sameFilters = JSON.stringify([...expected.filters].map((f) => JSON.stringify(f)).sort()) === JSON.stringify([...actual.filters].map((f) => JSON.stringify(f)).sort());
  const exact = sameSet(expected.rows, actual.rows) && sameSet(expected.measures, actual.measures) && sameFilters;
  return { verdict: exact ? 'same' : 'same figures', detail: exact ? '' : `built differently: rows ${actual.rows.join(', ')}; columns ${actual.columns.join(', ') || '–'}; measures ${actual.measures.join(', ')}; filters ${actual.filters.map((f) => `${f.column} ${f.op}${f.codes ? ' ' + f.codes.join('/') : ''}${f.value !== undefined ? ' ' + f.value : ''}`).join('; ') || '–'}` };
}
