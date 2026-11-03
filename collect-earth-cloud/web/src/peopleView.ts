import type { PersonRow, PersonStatus } from "./api";
import { csvText } from "./csv";
import { formatNumber } from "./format";
import type { MessageKey, Translate } from "./i18n";

// The People tab's words and numbers, pure: the status chips, how late a last sync is,
// the table's sorting, filtering and CSV, the activity calendar's weeks and shades, and
// the speed estimate's words.

const DAY_MS = 86_400_000;

export type ChipColor = "default" | "success" | "warning" | "error" | "primary" | "info";

/** A status chip's words and colour. Quiet is amber from the project's quiet days on, red from twice that. */
export function statusChip(t: Translate, status: PersonStatus): { label: string; color: ChipColor } {
  switch (status.kind) {
    case "noPlots":
      return { label: t("peopleTable.statusNoPlots"), color: "default" };
    case "finished":
      return { label: t("peopleTable.statusFinished"), color: "success" };
    case "neverStarted":
      return { label: t("peopleTable.statusNeverStarted"), color: "info" };
    case "quiet": {
      const days = status.days ?? 0;
      return { label: t(days === 1 ? "peopleTable.statusQuietOne" : "peopleTable.statusQuiet", { n: days }), color: status.level === "red" ? "error" : "warning" };
    }
    case "working":
      return { label: t("peopleTable.statusWorking"), color: "primary" };
    case "disabled":
      return { label: t("peopleTable.statusDisabled"), color: "default" };
  }
}

/**
 * The warning next to a last sync: it follows the status, so it means the same as the
 * chip: quiet (neither a sync nor a plot download for the quiet days; red after twice
 * that). Finished people, people without plots or who never started get none.
 */
export function statusSyncLevel(status: PersonStatus): "amber" | "red" | null {
  return status.kind === "quiet" ? (status.level ?? "amber") : null;
}

/** "just now", "3 hours ago", "2 days ago" (how long ago a time was, in plain words). */
export function agoText(t: Translate, ms: number | null, now: number): string {
  if (ms === null) return t("peopleTable.never");
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 1) return t("peopleTable.agoNow");
  if (minutes < 60) return t(minutes === 1 ? "peopleTable.agoMinute" : "peopleTable.agoMinutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(hours === 1 ? "peopleTable.agoHour" : "peopleTable.agoHours", { n: hours });
  const days = Math.floor(hours / 24);
  return t(days === 1 ? "peopleTable.agoDay" : "peopleTable.agoDays", { n: days });
}

// --- sorting and filtering ----------------------------------------------------------

export type SortKey = "username" | "role" | "status" | "assigned" | "submitted" | "remaining" | "done" | "last7" | "pace" | "lastSync" | "lastSubmitted" | "agreement";

const STATUS_ORDER: Record<PersonStatus["kind"], number> = { quiet: 0, neverStarted: 1, disabled: 2, working: 3, finished: 4, noPlots: 5 };

function sortValue(row: PersonRow, key: SortKey): string | number | null {
  switch (key) {
    case "username":
      return row.username.toLowerCase();
    case "role":
      return row.role;
    case "status":
      // The most worrying first: red quiet, amber quiet (the longest first), never started…
      return STATUS_ORDER[row.status.kind] * 100_000 - (row.status.days ?? 0);
    case "assigned":
      return row.plots.assigned;
    case "submitted":
      return row.plots.submitted;
    case "remaining":
      return row.plots.remaining;
    case "done":
      return row.plots.done;
    case "last7":
      return row.submittedLast7;
    case "pace":
      return row.medianPerDay;
    case "lastSync":
      return row.lastSyncAt;
    case "lastSubmitted":
      return row.lastSubmittedAt;
    case "agreement":
      return row.agreement?.rate ?? null;
  }
}

/** The rows sorted by a column; empty values (never synced, no agreement yet) last either way; ties by name. */
export function sortPeople(rows: readonly PersonRow[], key: SortKey, direction: "asc" | "desc"): PersonRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return (va < vb ? -1 : 1) * sign;
    return a.username.localeCompare(b.username);
  });
}

export type StatusFilter = "all" | PersonStatus["kind"];

/** The rows whose name holds the text (any case) and, unless "all", with that status. */
export function filterPeople(rows: readonly PersonRow[], text: string, status: StatusFilter): PersonRow[] {
  const needle = text.trim().toLowerCase();
  return rows.filter((r) => (status === "all" || r.status.kind === status) && (!needle || r.username.toLowerCase().includes(needle)));
}

// --- CSV ------------------------------------------------------------------------------

export { csvCell, csvFormat, csvTime } from "./csv";

/** The people table as CSV in the person's language (a header row, then one row per person). */
export function peopleCsv(t: Translate, rows: readonly PersonRow[], formatTime: (ms: number) => string, language = "en"): string {
  const header: MessageKey[] = [
    "peopleTable.name",
    "peopleTable.role",
    "peopleTable.status",
    "peopleTable.assigned",
    "peopleTable.submitted",
    "peopleTable.started",
    "peopleTable.remaining",
    "peopleTable.donePercent",
    "peopleTable.checksAssigned",
    "peopleTable.checksSubmitted",
    "peopleTable.last7",
    "peopleTable.pace",
    "peopleTable.lastSync",
    "peopleTable.lastSubmitted",
    "peopleTable.agreementPercent",
    "peopleTable.agreementCompared",
  ];
  const percent = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
  return csvText(
    header.map((k) => t(k)),
    rows.map((r) => [
      r.username,
      t(`role.${r.role}`),
      statusChip(t, r.status).label,
      r.plots.assigned,
      r.plots.submitted,
      r.plots.started,
      r.plots.remaining,
      percent(r.plots.done),
      r.checks?.assigned ?? null,
      r.checks?.submitted ?? null,
      r.submittedLast7,
      r.medianPerDay,
      r.lastSyncAt === null ? null : formatTime(r.lastSyncAt),
      r.lastSubmittedAt === null ? null : formatTime(r.lastSubmittedAt),
      percent(r.agreement?.rate ?? null),
      r.agreement?.compared ?? null,
    ]),
    language,
  );
}

// --- the activity calendar ------------------------------------------------------------

export interface CalendarCell {
  date: string;
  plots: number;
  checks: number;
  count: number;
}

export interface CalendarWeeks {
  /** Columns of 7 days, Monday first; null for days outside the span. */
  weeks: (CalendarCell | null)[][];
  /** The busiest day's count (at least 1). */
  max: number;
  from: string;
  to: string;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** 0 = Monday … 6 = Sunday. */
const weekday = (date: string) => (new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay() + 6) % 7;

/**
 * The calendar from the first day with a submission (at most `maxWeeks` weeks back) to
 * today, as week columns. Without any submission: the last 4 weeks.
 */
export function calendarWeeks(days: readonly { date: string; plots: number; checks: number }[], today: string, maxWeeks = 53): CalendarWeeks {
  const earliest = addDays(today, -(maxWeeks * 7 - 1));
  const first = days.length > 0 ? days[0].date : addDays(today, -27);
  const from = first < earliest ? earliest : first;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = addDays(from, -weekday(from));
  const weeks: (CalendarCell | null)[][] = [];
  let max = 1;
  for (let day = start; day <= today; day = addDays(day, 7)) {
    const column: (CalendarCell | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(day, i);
      if (date < from || date > today) {
        column.push(null);
        continue;
      }
      const d = byDate.get(date);
      const cell = { date, plots: d?.plots ?? 0, checks: d?.checks ?? 0, count: (d?.plots ?? 0) + (d?.checks ?? 0) };
      if (cell.count > max) max = cell.count;
      column.push(cell);
    }
    weeks.push(column);
  }
  return { weeks, max, from, to: today };
}

/** A day's shade, 0 (nothing) to 4 (the busiest days), in even steps of the busiest day. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / Math.max(1, max)) * 4))) as 1 | 2 | 3 | 4;
}

// --- speed ------------------------------------------------------------------------------

/** "8 s", "1 min 30 s", "12 min". */
export function durationText(t: Translate, ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t("person.seconds", { n: seconds });
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 || minutes >= 10 ? t("person.minutes", { n: minutes }) : t("person.minutesSeconds", { m: minutes, s: rest });
}

/** A speed bin's words: "under 15 s", "15 s to 30 s", … */
export function bucketLabel(t: Translate, buckets: readonly { upToMs: number }[], index: number): string {
  const upTo = durationText(t, buckets[index].upToMs);
  if (index === 0) return t("person.under", { d: upTo });
  return t("person.between", { from: durationText(t, buckets[index - 1].upToMs), to: upTo });
}

/** "3 submissions came less than 20 s after the one before…": the project's own threshold (fastSeconds). */
export function veryFastText(t: Translate, speed: { veryFast: number; veryFastSeconds: number }, language: string): string {
  return t(speed.veryFast === 1 ? "person.veryFastOne" : "person.veryFastMany", {
    n: formatNumber(speed.veryFast, language),
    d: durationText(t, speed.veryFastSeconds * 1000),
  });
}

/** Plots a day, with one decimal when under 10. */
export function perDayText(value: number | null, language: string): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat(language, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  } catch {
    return String(Math.round(value * 10) / 10);
  }
}

/** What the remove dialog says removing someone leaves behind (removeMember drops their plots and copies). */
export function removalText(t: Translate, removal: { plots: number; copies: number } | null, language: string): string[] {
  if (!removal) return [];
  const out: string[] = [];
  const n = (v: number) => formatNumber(v, language);
  if (removal.plots > 0) out.push(t(removal.plots === 1 ? "person.removePlotsOne" : "person.removePlots", { n: n(removal.plots) }));
  if (removal.copies > 0) out.push(t(removal.copies === 1 ? "person.removeCopiesOne" : "person.removeCopies", { n: n(removal.copies) }));
  return out;
}
