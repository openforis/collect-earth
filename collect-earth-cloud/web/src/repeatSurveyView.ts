// The view logic of a repeat survey (docs/plans/2026-11-11-repeat-survey.md): the earlier periods' answers of one plot as
// rows of a table, the plot's main characteristics (the form's header) first.
import type { AreaEstimate, ChangeAreas, PlotPeriod } from "./api";

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

/** A transition matrix as a table: the codes in the question's order (then any other), each cell's plots, the totals. */
export interface MatrixTable {
  codes: { code: string; label: string }[];
  /** plots by earlier code, then code now */
  cell: (from: string, to: string) => number;
  rowTotal: (from: string) => number;
  colTotal: (to: string) => number;
  total: number;
}

export function matrixTable(matrix: readonly { from: string; to: string; plots: number }[], options: readonly { code: string; label: string }[]): MatrixTable {
  const used = new Set(matrix.flatMap((m) => [m.from, m.to]));
  const codes = [
    ...options.filter((o) => used.has(o.code)),
    ...[...used].filter((c) => !options.some((o) => o.code === c)).sort().map((code) => ({ code, label: code })),
  ];
  const cells = new Map(matrix.map((m) => [`${m.from}\u0000${m.to}`, m.plots]));
  const cell = (from: string, to: string) => cells.get(`${from}\u0000${to}`) ?? 0;
  return {
    codes,
    cell,
    rowTotal: (from) => matrix.filter((m) => m.from === from).reduce((n, m) => n + m.plots, 0),
    colTotal: (to) => matrix.filter((m) => m.to === to).reduce((n, m) => n + m.plots, 0),
    total: matrix.reduce((n, m) => n + m.plots, 0),
  };
}

/** The plots to look at on the change card: the changes, the corrections and those whose header answer disagrees. */
export const plotsToShow = <R extends { outcome: string; mismatch: string | null }>(rows: readonly R[], which: "changed" | "corrected" | "mismatch"): R[] =>
  rows.filter((r) => (which === "mismatch" ? r.mismatch !== null : r.outcome === which));

/**
 * An area as the change card shows it: hectares when the area is known, else a percentage of the whole; with its 95%
 * confidence interval in the same unit, and the uncertainty (the interval as a percentage of the area).
 */
export interface AreaText {
  value: string;
  ci: string;
  uncertainty: string;
}

export function areaText(e: AreaEstimate, areas: Pick<ChangeAreas, "areaKnown" | "totalArea">, language: string, signed = false): AreaText {
  const { areaKnown, totalArea } = areas;
  const digits = areaKnown ? (Math.abs(e.area) >= 100 || e.area === 0 ? 0 : 1) : 1;
  const fmt = (v: number, sign = false) =>
    new Intl.NumberFormat(language, { maximumFractionDigits: digits, minimumFractionDigits: 0, signDisplay: sign ? "exceptZero" : "auto" }).format(v);
  const value = areaKnown ? e.area : e.share * 100;
  const ci = areaKnown ? e.ci : totalArea > 0 ? (e.ci / totalArea) * 100 : 0;
  return {
    value: `${fmt(value, signed)}${areaKnown ? " ha" : " %"}`,
    ci: `± ${fmt(ci)}${areaKnown ? " ha" : " %"}`,
    uncertainty: e.uncertainty === null ? "—" : `${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(e.uncertainty)} %`,
  };
}

/** The answers' areas in the question's order (then any other), with their names. */
export function classRows(areas: Pick<ChangeAreas, "classes">, options: readonly { code: string; label: string }[]): (ChangeAreas["classes"][number] & { label: string })[] {
  const order = new Map(options.map((o, i) => [o.code, i]));
  return [...areas.classes]
    .sort((a, b) => (order.get(a.code) ?? Infinity) - (order.get(b.code) ?? Infinity) || a.code.localeCompare(b.code))
    .map((c) => ({ ...c, label: options.find((o) => o.code === c.code)?.label ?? c.code }));
}

/** The strata whose uncertainty is not counted: fewer than 2 plots compared, but some (with none, their area is left out). */
export const thinStrata = (areas: Pick<ChangeAreas, "notEstimable">) => areas.notEstimable.filter((s) => s.plots > 0);
