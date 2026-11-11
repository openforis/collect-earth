// The view logic of a repeat survey (docs/plans/2026-11-11-repeat-survey.md): the earlier periods' answers of one plot as
// rows of a table, the plot's main characteristics (the form's header) first.
import type { PlotPeriod } from "./api";

export interface PeriodRow {
  key: string;
  /** one of the questions the form's header shows */
  header: boolean;
  /** the answer in each period, in the periods' order; null when none */
  values: (string | null)[];
}

/**
 * The rows of a plot's earlier answers: the header's questions first, in its order (even unanswered), then every other
 * question answered in some period, in the order they come. Empty answers count as none.
 */
export function periodRows(periods: readonly PlotPeriod[], headerQuestions: readonly string[]): PeriodRow[] {
  const valueOf = (p: PlotPeriod, key: string) => (p.answers[key] !== undefined && p.answers[key] !== "" ? p.answers[key] : null);
  const rows: PeriodRow[] = headerQuestions.map((key) => ({ key, header: true, values: periods.map((p) => valueOf(p, key)) }));
  const seen = new Set(headerQuestions);
  for (const p of periods) {
    for (const key of Object.keys(p.answers)) {
      if (seen.has(key) || valueOf(p, key) === null) continue;
      seen.add(key);
      rows.push({ key, header: false, values: periods.map((q) => valueOf(q, key)) });
    }
  }
  return rows;
}

/** The new project's name: the earlier one's with the new period instead of the earlier one when it names it. */
export function repeatName(name: string, earlierLabel: string, label: string): string {
  const trimmed = name.trim();
  if (earlierLabel && trimmed.includes(earlierLabel)) return trimmed.split(earlierLabel).join(label).slice(0, 200);
  return `${trimmed} ${label}`.trim().slice(0, 200);
}
