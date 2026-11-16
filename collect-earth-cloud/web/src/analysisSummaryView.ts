import type { AnalysisSummary } from "./api";

// A reviewer's analysis: the plots counted by one question or two, as the server counted them (GET …/analysis/summary).
// Pure: the table the page draws from the answer.

export interface SummaryTable {
  /** The second question's answers, in the order of their list; empty with one question. */
  columns: { code: string; label: string }[];
  rows: { code: string; label: string; plots: number; area: number | null; cells: number[] }[];
  plots: number;
  area: number | null;
}

type Labels = Record<string, string>;
const labelIn = (labels: Labels | undefined, language: string, languages: readonly string[], fallback: string): string =>
  labels?.[language] || labels?.[languages[0] ?? ""] || labels?.[""] || Object.values(labels ?? {}).find((l) => l !== "") || fallback;

/** A question's name in the reader's language. */
export function questionLabel(summary: Pick<AnalysisSummary, "questions" | "languages">, name: string, language: string): string {
  return labelIn(summary.questions.find((q) => q.name === name)?.labels, language, summary.languages, name);
}

/** The answers of a question that have plots, in the order of its list (yes before no), "not answered" last. */
function answersOf(summary: AnalysisSummary, name: string, present: ReadonlySet<string>, language: string, words: { yes: string; no: string; none: string }): { code: string; label: string }[] {
  const question = summary.questions.find((q) => q.name === name);
  const known: { code: string; label: string }[] =
    question?.type === "boolean"
      ? [
          { code: "true", label: words.yes },
          { code: "false", label: words.no },
        ]
      : (summary.lists[question?.list ?? ""] ?? []).map((i) => ({ code: i.code, label: labelIn(i.labels, language, summary.languages, i.code) }));
  const out = known.filter((a) => present.has(a.code));
  const listed = new Set(out.map((a) => a.code));
  for (const code of [...present].filter((c) => c !== "" && !listed.has(c)).sort()) out.push({ code, label: code });
  if (present.has("")) out.push({ code: "", label: words.none });
  return out;
}

export function summaryTable(summary: AnalysisSummary, language: string, words: { yes: string; no: string; none: string }): SummaryTable | null {
  if (summary.row === null) return null;
  const columns = summary.column === null ? [] : answersOf(summary, summary.column, new Set(summary.cells.map((c) => c.column ?? "")), language, words);
  const at = new Map(columns.map((c, i) => [c.code, i]));
  const rows = answersOf(summary, summary.row, new Set(summary.cells.map((c) => c.row)), language, words).map((a) => ({ ...a, plots: 0, area: summary.hasAreas ? 0 : (null as number | null), cells: columns.map(() => 0) }));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const cell of summary.cells) {
    const row = byCode.get(cell.row);
    if (!row) continue;
    row.plots += cell.plots;
    if (row.area !== null) row.area += cell.area ?? 0;
    const i = at.get(cell.column ?? "");
    if (i !== undefined) row.cells[i] += cell.plots;
  }
  return { columns, rows, plots: summary.plots, area: summary.hasAreas ? rows.reduce((sum, r) => sum + (r.area ?? 0), 0) : null };
}
