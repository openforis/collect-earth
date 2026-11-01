import type { AttentionItem, AttentionKind, Forecast, ProgressDay, ProgressSettings } from "./api";
import { formatNumber } from "./format";
import type { MessageKey, Translate } from "./i18n";
import type { ProjectTab } from "./router";

// The Progress tab's words and numbers, pure: the forecast sentences, "Updated 20 s
// ago", the attention cards' texts and links, the chart's geometry and the settings form.

/** The tab reloads this often while the page is visible. */
export const REFRESH_MS = 60_000;

/** The browser's IANA time zone (the server counts days in it); UTC when it cannot be told. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "Updated just now", "Updated 20 s ago", "Updated 3 min ago". */
export function updatedText(t: Translate, loadedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - loadedAt) / 1000));
  if (seconds < 5) return t("progress.updatedNow");
  if (seconds < 60) return t("progress.updatedSeconds", { n: seconds });
  return t("progress.updatedMinutes", { n: Math.floor(seconds / 60) });
}

/** A calendar day (YYYY-MM-DD) in the person's language: "10 Nov 2026". */
export function dayText(date: string, language: string, style: "medium" | "short" = "medium"): string {
  const ms = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(ms)) return date;
  try {
    return style === "medium"
      ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(ms)
      : new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: "UTC" }).format(ms);
  } catch {
    return date;
  }
}

/** A share in whole percent, "–" when there is nothing to share. */
export function percentText(part: number, whole: number, language: string): string {
  if (whole <= 0) return "–";
  try {
    return new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(part / whole);
  } catch {
    return `${Math.round((part / whole) * 100)} %`;
  }
}

/** 0..100 for a bar. */
export function barValue(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;
}

/** Plots a day, with one decimal under 10 ("0.4", "8.6", "85"). */
export function paceText(pace: number, language: string): string {
  try {
    return new Intl.NumberFormat(language, { maximumFractionDigits: pace < 10 ? 1 : 0 }).format(pace);
  } catch {
    return String(Math.round(pace * 10) / 10);
  }
}

/**
 * The forecast in plain sentences: "At the pace of the last 14 days (about 85 plots a
 * day), the 1,020 plots left take about 12 days: around 10 Nov 2026." and, with a
 * deadline, "That is 4 days after the deadline, 6 Nov 2026." "To finish by the
 * deadline, about 110 plots a day are needed."
 */
export function forecastSentences(t: Translate, f: Forecast, language: string): string[] {
  const n = (v: number) => formatNumber(v, language);
  const deadline = f.deadline ? dayText(f.deadline, language) : null;
  const out: string[] = [];
  if (f.target === 0) {
    out.push(t("progress.forecastNoTarget"));
    return out;
  }
  if (f.remaining === 0) {
    out.push(t("progress.forecastDone", { target: n(f.target) }));
    return out;
  }
  if (f.daysLeft === null || f.endDate === null) {
    out.push(t("progress.forecastNoPace", { days: f.paceDays }));
  } else {
    const params = { days: f.paceDays, pace: paceText(f.pacePerDay, language), remaining: n(f.remaining), left: n(f.daysLeft), date: dayText(f.endDate, language) };
    out.push(t(f.daysLeft === 1 ? "progress.forecastPaceOneDay" : "progress.forecastPace", params));
  }
  if (deadline !== null && f.daysToDeadline !== null) {
    if (f.daysToDeadline < 0) {
      out.push(t("progress.forecastPassed", { deadline }));
      return out;
    }
    if (f.daysOver !== null) {
      if (f.daysOver > 0) out.push(t(f.daysOver === 1 ? "progress.forecastLateOne" : "progress.forecastLate", { n: n(f.daysOver), deadline }));
      else out.push(t("progress.forecastOnTime", { deadline }));
    }
    if (f.neededPerDay !== null && (f.daysOver === null || f.daysOver > 0)) {
      out.push(t("progress.forecastNeeded", { n: n(f.neededPerDay) }));
    }
  }
  return out;
}

/** Where each card's problem is fixed. */
export const ATTENTION_TAB: Record<AttentionKind, ProjectTab> = {
  quiet: "people",
  neverDownloaded: "people",
  notAssigned: "plots",
  oldUnsentWork: "people",
  differencesWaiting: "quality",
  storage: "setup",
  oldProjectFile: "people",
  oldCollectEarth: "people",
};

const GO: Record<ProjectTab, MessageKey> = {
  progress: "tab.progress",
  setup: "progress.goSetup",
  file: "tab.file",
  people: "progress.goPeople",
  plots: "progress.goPlots",
  data: "tab.data",
  quality: "progress.goQuality",
  settings: "tab.settings",
};

export function attentionAction(t: Translate, kind: AttentionKind): { tab: ProjectTab; label: string } {
  const tab = ATTENTION_TAB[kind];
  return { tab, label: t(GO[tab]) };
}

const DAY_MS = 86_400_000;

/** A card's title and sentence(s). The storage card's sentence is the storage warning of the Setup tab. */
export function attentionText(t: Translate, item: AttentionItem, language: string): { title: string; text: string[] } {
  const count = formatNumber(item.count, language);
  const one = item.count === 1;
  switch (item.kind) {
    case "quiet": {
      const days = item.quietDays ?? 3;
      if (days === 1) return { title: t("attention.quietTitleDay"), text: [t(one ? "attention.quietOneDay" : "attention.quietDay", { count })] };
      return { title: t("attention.quietTitle", { days }), text: [t(one ? "attention.quietOne" : "attention.quiet", { count, days })] };
    }
    case "neverDownloaded":
      return { title: t("attention.neverTitle"), text: [t(one ? "attention.neverOne" : "attention.never", { count })] };
    case "notAssigned":
      return { title: t("attention.notAssignedTitle"), text: [t(one ? "attention.notAssignedOne" : "attention.notAssigned", { count })] };
    case "oldUnsentWork":
      return { title: t("attention.lateTitle"), text: [t(one ? "attention.lateOne" : "attention.late", { count })] };
    case "differencesWaiting":
      return { title: t("attention.differencesTitle"), text: [t(one ? "attention.differencesOne" : "attention.differences", { count })] };
    case "storage":
      return {
        title: t(item.level === "over" ? "attention.storageOverTitle" : "attention.storageTitle"),
        text: [t(item.level === "over" ? "storage.over" : "storage.nearlyFull")],
      };
    case "oldProjectFile":
      return { title: t("attention.oldFileTitle"), text: [t(one ? "attention.oldFileOne" : "attention.oldFile", { count })] };
    case "oldCollectEarth": {
      const text: string[] = [];
      if (item.count > 0) text.push(t(one ? "attention.oldCeOne" : "attention.oldCe", { count }));
      if (item.unknownVersion > 0) {
        text.push(t(item.unknownVersion === 1 ? "attention.unknownCeOne" : "attention.unknownCe", { count: formatNumber(item.unknownVersion, language) }));
      }
      return { title: t(item.count > 0 ? "attention.oldCeTitle" : "attention.unknownCeTitle"), text };
    }
  }
}

/** What is said next to a person in a card: their last sync (or, never synced, when they got their plots), how late their work arrives. */
export function personDetail(t: Translate, item: AttentionItem, person: AttentionItem["people"][number], language: string, formatDate: (ms: number) => string): string | null {
  if (item.kind === "quiet" && person.lastSyncAt !== null) return t("attention.lastSync", { date: formatDate(person.lastSyncAt) });
  if (item.kind === "quiet" && person.lastPlotsDownloadAt !== null) return t("attention.lastDownload", { date: formatDate(person.lastPlotsDownloadAt) });
  if (item.kind === "oldUnsentWork" && person.medianDelayMs !== null) {
    return t("attention.daysLate", { n: formatNumber(Math.round((person.medianDelayMs / DAY_MS) * 10) / 10, language) });
  }
  return null;
}

// --- the chart --------------------------------------------------------------------

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface DayPoint extends ProgressDay {
  x: number;
  y: number;
}

export interface ProgressChart {
  points: DayPoint[];
  /** The cumulative line ("" with no days). */
  path: string;
  /** The same line closed down to the baseline, for a light fill. */
  area: string;
  /** Horizontal gridlines: the value each marks and its y. */
  ticks: { value: number; y: number }[];
  /** The target's y, when a target is drawn and fits the scale. */
  targetY: number | null;
}

/** A round step for about `count` gridlines up to `max`: 1, 2, 5 × 10^n. */
export function niceStep(max: number, count = 4): number {
  if (max <= 0) return 1;
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  return Math.max(1, step);
}

/**
 * The chart's geometry: days from left to right, the cumulative plots from 0 at the
 * bottom. The scale reaches the target when one is given (so the gap to it shows), and
 * always the highest value, rounded up to a gridline.
 */
export function progressChart(days: readonly ProgressDay[], box: ChartBox, target: number | null): ProgressChart {
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const highest = Math.max(1, ...days.map((d) => d.cumulative), target ?? 0);
  const step = niceStep(highest);
  const top = Math.ceil(highest / step) * step;
  const yOf = (v: number) => box.top + (1 - v / top) * plotHeight;
  const points = days.map((d, i) => ({
    ...d,
    x: days.length === 1 ? box.left + plotWidth / 2 : box.left + (i * plotWidth) / (days.length - 1),
    y: yOf(d.cumulative),
  }));
  const r = (n: number) => Math.round(n * 10) / 10;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)},${r(p.y)}`).join(" ");
  const base = r(box.top + plotHeight);
  const area = points.length > 0 ? `${path} L${r(points[points.length - 1].x)},${base} L${r(points[0].x)},${base} Z` : "";
  const ticks: { value: number; y: number }[] = [];
  for (let v = 0; v <= top; v += step) ticks.push({ value: v, y: yOf(v) });
  return { points, path, area, ticks, targetY: target !== null && target > 0 ? yOf(target) : null };
}

// --- the settings form --------------------------------------------------------------

export interface ProgressDraft {
  deadline: string;
  targetPlots: string;
  quietDays: string;
  /** The date box holds a date typed only in part (it then gives ""): not an empty deadline. */
  deadlineUnfinished: boolean;
}

export type ProgressProblems = Partial<Record<keyof ProgressDraft, MessageKey>>;

export function progressDraftOf(s: ProgressSettings): ProgressDraft {
  return { deadline: s.deadline ?? "", targetPlots: s.targetPlots === null ? "" : String(s.targetPlots), quietDays: String(s.quietDays), deadlineUnfinished: false };
}

const MAX_TARGET = 10_000_000;

/** A real calendar day written YYYY-MM-DD (what a date box gives). */
export function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

/** The settings to save, or the problems to show by each box (the server checks the same). */
export function readProgressDraft(d: ProgressDraft): { settings: ProgressSettings; problems: ProgressProblems } {
  const problems: ProgressProblems = {};
  const deadline = d.deadline.trim();
  if (d.deadlineUnfinished || (deadline && !isDate(deadline))) {
    problems.deadline = "progressSettings.badDeadline";
  }
  // Digits, with separators only between groups of three ("1,200", "1.200", "1 200"): "12.5" is no whole number.
  const typed = d.targetPlots.trim();
  const target = /^\d{1,3}([\s.,'\u2019\u00a0\u202f]\d{3})+$/.test(typed) ? typed.replace(/\D/g, "") : typed;
  let targetPlots: number | null = null;
  if (target) {
    targetPlots = /^\d+$/.test(target) ? Number(target) : NaN;
    if (!(targetPlots >= 1 && targetPlots <= MAX_TARGET)) problems.targetPlots = "progressSettings.badTarget";
  }
  const quiet = d.quietDays.trim();
  const quietDays = /^\d+$/.test(quiet) ? Number(quiet) : NaN;
  if (!(quietDays >= 1 && quietDays <= 365)) problems.quietDays = "progressSettings.badQuiet";
  return { problems, settings: { deadline: problems.deadline ? null : deadline || null, targetPlots: problems.targetPlots ? null : targetPlots, quietDays: problems.quietDays ? 3 : quietDays } };
}
