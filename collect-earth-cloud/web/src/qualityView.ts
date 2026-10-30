// Pure helpers of the Quality tab: rates as text, the margins list, the week chart's
// geometry, the Google Earth link, the differences grouped by plot, local changes and
// when to ask for newer figures.

import type { DataProblemKind, Difference, GuidanceNote, QualityData, QualityDecision, QuestionAgreement, Rate, WeekAgreement } from "./api";
import type { MessageKey, Translate } from "./i18n";

/** Below this many checks a rate is not given (the server's MIN_PLOTS). */
export const MIN_CHECKS = 20;
/** The margin of a number question no one has set one for (the server's DEFAULT_MARGIN). */
export const DEFAULT_MARGIN = 10;

/** A share (0..1) as a whole percentage in the person's language: "82 %", "82%". */
export function formatRate(rate: number, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(rate);
  } catch {
    return `${Math.round(rate * 100)} %`;
  }
}

/** "82 % agree (41 of 50 checks)", or "Too few checks to judge (12 of 20)". */
export function rateText(t: Translate, rate: Rate, language: string): string {
  if (rate.rate === null) return t("quality.tooFew", { count: rate.compared, min: MIN_CHECKS });
  return t("quality.agree", { pct: formatRate(rate.rate, language), agreeing: rate.agreeing, count: rate.compared });
}

/** The bar's length in percent, or null when there is no rate to show. */
export function barPercent(rate: Rate): number | null {
  return rate.rate === null ? null : Math.max(0, Math.min(100, rate.rate * 100));
}

/** The question of a key, as the figures label it (the key itself when the figures do not list it). */
export function labelMap(questions: readonly QuestionAgreement[]): (key: string) => string {
  const labels = new Map(questions.map((q) => [q.key, q.label]));
  return (key) => labels.get(key) ?? key;
}

const INDEXED_ENTITY = /^(collect_entity_[^[.]+)\[(\d+)\]\./;

/**
 * The key a margin is saved under, as the server keys it: an indexed entity's question
 * with its index as [*] (collect_entity_tree[3].real_height -> collect_entity_tree[*].real_height).
 */
export function marginKey(key: string): string {
  return key.replace(INDEXED_ENTITY, "$1[*].");
}

export interface MarginRow {
  /** The margin key (with [*] for an indexed entity's question). */
  key: string;
  /** The question's label, without the entity's number for an indexed one. */
  label: string;
  /** For an indexed entity's question, the entity's label ("Tree"): one margin covers all of them. */
  entity: string | null;
  /** The margin now, in percent. */
  value: number;
}

/**
 * One row per number question margin: the ten trees of the same answer share one, shown
 * once (on its first question). The value is the saved one, else the one the figures used,
 * else the default.
 */
export function marginRows(questions: readonly QuestionAgreement[], margins: Readonly<Record<string, number>>): MarginRow[] {
  const rows: MarginRow[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    if (q.kind !== "number") continue;
    const key = marginKey(q.key);
    if (seen.has(key)) continue;
    seen.add(key);
    const index = INDEXED_ENTITY.exec(q.key)?.[2];
    let label = q.label;
    let entity: string | null = null;
    if (index !== undefined) {
      // The outline labels an indexed entity's question "<entity> <n>: <question>".
      const marker = ` ${index}: `;
      const at = q.label.indexOf(marker);
      if (at >= 0) {
        entity = q.label.slice(0, at);
        label = `${entity}: ${q.label.slice(at + marker.length)}`;
      } else {
        entity = q.label;
      }
    }
    rows.push({ key, label, entity, value: margins[key] ?? q.margin ?? DEFAULT_MARGIN });
  }
  return rows;
}

/**
 * The margins to send when saving: the saved ones with those edited on screen over
 * them. The server replaces the whole set, and the screen lists only the questions
 * compared so far, so a margin saved for another question must be sent too.
 */
export function marginsToSave(saved: Readonly<Record<string, number>>, edited: Readonly<Record<string, number>>): Record<string, number> {
  return { ...saved, ...edited };
}

/** A margin typed by the coordinator: a number from 0 to 100 (a decimal comma is fine), or null. */
export function parseMargin(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 0 && n <= 100 ? n : null;
}

/** "2026-W43" -> { year: "2026", week: "43" } (as is when it is not that shape). */
export function splitWeek(week: string): { year: string; week: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  return m ? { year: m[1], week: String(Number(m[2])) } : { year: "", week };
}

/**
 * A week's share as text: every week gets one, even under MIN_CHECKS, then marked
 * "(few checks)": "82% agree (41 of 50 checks)", "100% agree (4 of 4 checks) (few checks)".
 */
export function weekRateText(t: Translate, w: { compared: number; agreeing: number }, language: string): string {
  const text = rateText(t, { compared: w.compared, agreeing: w.agreeing, rate: w.compared > 0 ? w.agreeing / w.compared : null }, language);
  return w.compared > 0 && w.compared < MIN_CHECKS ? `${text} ${t("quality.fewChecks")}` : text;
}

/** A week and its share: "Week 44, 2026: 82% agree (41 of 50 checks)". */
export function weekText(t: Translate, w: { week: string; compared: number; agreeing: number }, language: string): string {
  return `${t("quality.week", splitWeek(w.week))}: ${weekRateText(t, w, language)}`;
}

export interface WeekPoint {
  week: string;
  compared: number;
  agreeing: number;
  /** agreeing / compared, 0..1. */
  rate: number;
  /** Fewer than MIN_CHECKS checks: the share can swing a lot (drawn hollow, its lines dashed). */
  few: boolean;
  x: number;
  y: number;
}

export interface WeekChart {
  points: WeekPoint[];
  /** The SVG path of the solid lines: between two weeks of MIN_CHECKS checks or more ("" for none). */
  path: string;
  /** The SVG path of the dashed lines: those touching a week of fewer checks ("" for none). */
  fewPath: string;
  /** Horizontal gridlines: the share each marks and its y. */
  ticks: { value: number; y: number }[];
}

/**
 * The week chart's geometry: the weeks with checks in week order, x spread across the
 * plot area (one week in the middle), y from 0 % at the bottom to 100 % at the top.
 */
export function weekChart(
  weeks: readonly WeekAgreement[],
  box: { width: number; height: number; left: number; right: number; top: number; bottom: number },
): WeekChart {
  const sorted = weeks.filter((w) => w.compared > 0).sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const yOf = (value: number) => box.top + (1 - value) * plotHeight;
  const points = sorted.map((w, i) => {
    const rate = w.agreeing / w.compared;
    const x = sorted.length === 1 ? box.left + plotWidth / 2 : box.left + (i * plotWidth) / (sorted.length - 1);
    return { week: w.week, compared: w.compared, agreeing: w.agreeing, rate, few: w.compared < MIN_CHECKS, x, y: yOf(rate) };
  });
  const round = (n: number) => Math.round(n * 10) / 10;
  const solid: string[] = [];
  const dashed: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    (a.few || b.few ? dashed : solid).push(`M${round(a.x)},${round(a.y)} L${round(b.x)},${round(b.y)}`);
  }
  const ticks = [0, 0.5, 1].map((value) => ({ value, y: yOf(value) }));
  return { points, path: solid.join(" "), fewPath: dashed.join(" "), ticks };
}

/** Opens a place in Google Earth on the web (six decimals: about 10 cm). */
export function googleEarthUrl(lat: number, lon: number): string {
  return `https://earth.google.com/web/search/${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Whether "Write a note" can name this pair: a blank answer in a note means "any answer". */
export function canWriteNote(first: string, check: string): boolean {
  return first !== "" && check !== "";
}

/** The decisions with the plot's one replaced (or taken away, with null). */
export function withDecision(decisions: readonly QualityDecision[], plot: string, decision: QualityDecision | null): QualityDecision[] {
  const others = decisions.filter((d) => d.plot !== plot);
  return decision ? [...others, decision] : others;
}

/** The notes with a saved one in place of its earlier version, in the server's order: by question, then the pair. */
export function withNote(notes: readonly GuidanceNote[], saved: GuidanceNote): GuidanceNote[] {
  const order = (n: GuidanceNote) => [n.questionKey, n.firstValue ?? "", n.checkValue ?? ""].join("\u0000");
  return [...notes.filter((n) => n.id !== saved.id), saved].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

/**
 * For a load that started before a change made on this page: the loaded figures, with
 * the decisions, notes and margins as changed here (the load may have read them before).
 */
export function keepLocalChanges(fresh: QualityData, prev: QualityData): QualityData {
  return { ...fresh, decisions: prev.decisions, notes: prev.notes, margins: prev.margins };
}

/** How long to wait before asking again while the figures stay stale: 5, 10, 20 s, then every 60 s. */
export const STALE_BACKOFF_MS = [5_000, 10_000, 20_000, 60_000] as const;
/** The Retry-After of a "busy" answer. */
export const BUSY_RETRY_MS = 10_000;

/**
 * When to ask for the figures again, or null not to. Stale figures (newer ones are being
 * worked out) and busy answers are asked again, backing off with each `round` (the answers
 * in a row that were not fresh). Never while the page is hidden (it asks again when shown),
 * nor after any other error (the person retries).
 */
export function pollDelay(state: { stale: boolean; busy: boolean; failed: boolean; hidden: boolean; round: number }): number | null {
  if (state.hidden || state.failed || !(state.stale || state.busy)) return null;
  const backoff = STALE_BACKOFF_MS[Math.min(state.round, STALE_BACKOFF_MS.length - 1)];
  return state.busy ? Math.max(BUSY_RETRY_MS, backoff) : backoff;
}

/** The checks of each plot together (a plot checked twice has two), in the figures' plot order. */
export function groupDifferences(differences: readonly Difference[]): { plot: string; checks: Difference[] }[] {
  const groups = new Map<string, Difference[]>();
  for (const d of differences) {
    const list = groups.get(d.plot);
    if (list) list.push(d);
    else groups.set(d.plot, [d]);
  }
  return [...groups].map(([plot, checks]) => ({ plot, checks }));
}

const PROBLEM_KEYS: Record<DataProblemKind, MessageKey> = {
  no_plot: "quality.problem.no_plot",
  unknown_round: "quality.problem.unknown_round",
  two_main: "quality.problem.two_main",
  extra_key_parts: "quality.problem.extra_key_parts",
};

/** The sentence for a kind of data problem (a general one for a kind this dashboard does not know). */
export function problemMessageKey(kind: string): MessageKey {
  return PROBLEM_KEYS[kind as DataProblemKind] ?? "quality.problem.other";
}
