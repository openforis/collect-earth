import type { ActivityPage, DailyRow, DecisionRow, DifferenceRow, LogItem, LogKind } from "./api";
import { csvText } from "./csv";
import { formatNumber } from "./format";
import type { MessageKey, Translate } from "./i18n";
import type { AnswerOptions } from "./api";

// The Activity tab's words, pure: a sentence for each row of the log, the filters' names,
// the weeks of the weekly summary (in the browser's time zone) and the downloads' CSV.

/** The log's kinds, as the filter names them. */
export const LOG_KIND_LABELS: Record<LogKind, MessageKey> = {
  all: "activity.kind.all",
  records: "activity.kind.records",
  submitted: "activity.kind.submitted",
  resubmitted: "activity.kind.resubmitted",
  draft: "activity.kind.draft",
  unsubmitted: "activity.kind.unsubmitted",
  deleted: "activity.kind.deleted",
  coordinators: "activity.kind.coordinators",
  decisions: "activity.kind.decisions",
  people: "activity.kind.people",
  files: "activity.kind.files",
  settings: "activity.kind.settings",
  downloads: "activity.kind.downloads",
};

/** Kinds that are Collect Earth's saves (shown under one heading in the menu), the others the coordinators'. */
export const RECORD_LOG_KINDS: readonly LogKind[] = ["records", "submitted", "resubmitted", "draft", "unsubmitted", "deleted"];
export const COORDINATOR_LOG_KINDS: readonly LogKind[] = ["coordinators", "decisions", "people", "files", "settings", "downloads"];

const RECORD_KEYS = {
  created: "activity.record.created",
  updated: "activity.record.updated",
  submitted: "activity.record.submitted",
  resubmitted: "activity.record.resubmitted",
  unsubmitted: "activity.record.unsubmitted",
  deleted: "activity.record.deleted",
} as const satisfies Record<string, MessageKey>;

/** The same for a quality check (its own sentences: in es, fr and pt a check and a plot differ in gender). */
const CHECK_KEYS = {
  created: "activity.check.created",
  updated: "activity.check.updated",
  submitted: "activity.check.submitted",
  resubmitted: "activity.check.resubmitted",
  unsubmitted: "activity.check.unsubmitted",
  deleted: "activity.check.deleted",
} as const satisfies Record<string, MessageKey>;

const DECISION_KEYS = {
  first: "quality.decision.first",
  check: "quality.decision.check",
  recheck: "quality.decision.recheck",
} as const satisfies Record<string, MessageKey>;

const SETTING_KEYS: Record<string, MessageKey> = {
  quality: "activity.setting.quality",
  round: "activity.setting.round",
  ai: "activity.setting.ai",
  name: "activity.setting.name",
  progress: "activity.setting.progress",
  sampling: "activity.setting.sampling",
};

const EXPORT_KEYS: Record<string, MessageKey> = {
  people: "activity.export.people",
  daily: "activity.export.daily",
  decisions: "activity.export.decisions",
  differences: "activity.export.differences",
  "collect-backup": "activity.export.collectBackup",
};

/** Who did it: their name, "(no longer in the project)" after it, or someone without a name. */
function who(t: Translate, name: string | null): string {
  return name ?? t("activity.someone");
}

/** A person named in an entry's details, by their name now. */
function personOf(t: Translate, page: Pick<ActivityPage, "people">, id: unknown): string {
  if (typeof id !== "string") return t("activity.someone");
  const p = page.people[id];
  if (!p || p.name === null) return t("activity.removedPerson");
  return p.removed ? t("activity.removedNamed", { name: p.name }) : p.name;
}

function fileOf(t: Translate, page: Pick<ActivityPage, "files">, id: unknown): string {
  const name = typeof id === "string" ? page.files[id] : undefined;
  return name ?? t("activity.removedFile");
}

const num = (v: unknown, language: string) => formatNumber(typeof v === "number" ? v : Number(v) || 0, language);

/** What a row of the log says, without its time: "maria submitted plot 17". */
export function logSentence(t: Translate, item: LogItem, page: Pick<ActivityPage, "people" | "files">, language: string): string {
  if (item.type === "record") {
    // Coordinators see which records are checks (the log is theirs only).
    if (item.assessment === "check") return t(CHECK_KEYS[item.change], { person: item.person, plot: item.name });
    const plot = item.assessment === "other" ? t("activity.roundOf", { plot: item.name, round: item.round }) : item.name;
    return t(RECORD_KEYS[item.change], { person: item.person, plot });
  }
  const d = item.details;
  const actor = who(t, item.person);
  const plot = item.plotName ?? (typeof d.plot === "string" ? d.plot : "");
  switch (item.action) {
    case "invite.created":
      if (typeof d.forUserId === "string") return t("activity.audit.inviteFor", { actor, person: personOf(t, page, d.forUserId) });
      return t("activity.audit.invite", { actor, role: typeof d.role === "string" ? t(`role.${d.role === "admin" || d.role === "reviewer" ? d.role : "operator"}`) : t("role.operator") });
    case "invite.revoked":
      return t("activity.audit.inviteRevoked", { actor });
    case "member.removed":
      return t("activity.audit.removed", { actor, person: personOf(t, page, d.userId) });
    case "member.role":
      return t("activity.audit.role", { actor, person: personOf(t, page, d.userId), role: t(`role.${d.role === "admin" || d.role === "reviewer" ? d.role : "operator"}`) });
    case "cep.replaced":
      return t("activity.audit.cep", { actor });
    case "survey.replaced":
      return t("activity.audit.survey", { actor });
    case "csv.uploaded":
      return t("activity.audit.csv", { actor, file: fileOf(t, page, d.csvFileId), count: num(d.plots, language) });
    case "assignments.set":
      return t("activity.audit.assignments", { actor });
    case "division.applied":
      if (d.mode === "whole") return t("activity.audit.whole", { actor, file: fileOf(t, page, d.csvFileId) });
      return t("activity.audit.divided", { actor, file: fileOf(t, page, d.csvFileId), count: num(d.people, language) });
    case "plots.moved":
      return t("activity.audit.moved", { actor, count: num(d.moved, language), file: fileOf(t, page, d.csvFileId), from: personOf(t, page, d.fromUserId), to: personOf(t, page, d.toUserId) });
    case "decision.set":
      return t("activity.audit.decided", { actor, plot, decision: t(DECISION_KEYS[d.decision === "first" || d.decision === "check" ? d.decision : "recheck"]) });
    case "decision.deleted":
      return t("activity.audit.undone", { actor, plot });
    case "decision.bulk":
      return t("activity.audit.bulk", { actor, count: num(d.count, language), decision: t(DECISION_KEYS[d.decision === "first" || d.decision === "check" ? d.decision : "recheck"]) });
    case "settings.changed":
      if (d.setting === "ai") return t(d.enabled === true ? "activity.audit.aiOn" : "activity.audit.aiOff", { actor });
      return t("activity.audit.settings", { actor, what: t(SETTING_KEYS[String(d.setting)] ?? "activity.setting.other") });
    case "sampling.drawn":
      if (d.automatic === true) return t("activity.audit.sampledAuto", { count: num(d.drawn, language) });
      return t("activity.audit.sampled", { actor, count: num(d.drawn, language) });
    case "reference.changed":
      if (Number(d.removed) > 0 && !(Number(d.added) > 0)) return t("activity.audit.referenceRemoved", { actor, count: num(d.removed, language) });
      return t("activity.audit.referenceAdded", { actor, count: num(d.added, language), file: fileOf(t, page, d.csvFileId) });
    case "export.downloaded":
      if (typeof d.kind === "string" && EXPORT_KEYS[d.kind]) {
        return t(d.completed === false ? "activity.audit.downloadStopped" : "activity.audit.download", { actor, what: t(EXPORT_KEYS[d.kind]) });
      }
      return t("activity.audit.downloadData", { actor, count: num(d.records, language) });
    default:
      return t("activity.audit.other", { actor, action: item.action });
  }
}

// --- weeks, in the browser's time zone ------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar day written YYYY-MM-DD, in the browser's time zone. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The ISO week (YYYY-Www) of a calendar day: the week's Thursday gives the year. */
export function isoWeekOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = Date.UTC(y, m - 1, d);
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  const thursday = new Date(day + (3 - weekday) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return `${year}-W${pad(week)}`;
}

/** The Monday of an ISO week. */
export function weekMonday(week: string): string {
  const year = Number(week.slice(0, 4));
  const n = Number(week.slice(6, 8));
  const jan4 = Date.UTC(year, 0, 4);
  const weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  return new Date(jan4 + (-weekday + (n - 1) * 7) * 86_400_000).toISOString().slice(0, 10);
}

/** The week `n` weeks after (before, when negative) the one given. */
export function shiftWeek(week: string, n: number): string {
  const monday = Date.parse(`${weekMonday(week)}T00:00:00Z`) + n * 7 * 86_400_000;
  return isoWeekOf(new Date(monday).toISOString().slice(0, 10));
}

export function isIsoWeek(text: string | null | undefined): text is string {
  if (!text || !/^\d{4}-W\d{2}$/.test(text)) return false;
  const n = Number(text.slice(6, 8));
  return n >= 1 && n <= 53 && isoWeekOf(weekMonday(text)) === text;
}

/** The start of a calendar day in the browser's time zone (ms), for the log's date filter. */
export function dayStartMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** The start of the day after (the filter's end, not included). */
export function dayAfterMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d + 1).getTime();
}

// --- the downloads ----------------------------------------------------------------------------

/** Daily activity: per day and person, plots and checks first submitted and the other saves. */
export function dailyCsv(t: Translate, rows: readonly DailyRow[], language: string): string {
  const header: MessageKey[] = [
    "activity.csv.date",
    "activity.csv.person",
    "activity.csv.plots",
    "activity.csv.checks",
    "activity.csv.submittedAgain",
    "activity.csv.drafts",
    "activity.csv.reopened",
    "activity.csv.deleted",
  ];
  return csvText(
    header.map((k) => t(k)),
    rows.map((r) => [r.date, r.person, r.plots, r.checks, r.submittedAgain, r.drafts, r.reopened, r.deleted]),
    language,
  );
}

/** Review decisions: one row per decided plot, the newest first. */
export function decisionsCsv(t: Translate, rows: readonly DecisionRow[], formatTime: (ms: number) => string, language: string): string {
  const header: MessageKey[] = ["activity.csv.plot", "activity.csv.decision", "activity.csv.comment", "activity.csv.decidedBy", "activity.csv.decidedAt", "activity.csv.byAssessor", "activity.csv.bulk"];
  const yesNo = (v: boolean | null) => (v === null ? null : t(v ? "activity.csv.yes" : "activity.csv.no"));
  return csvText(
    header.map((k) => t(k)),
    rows.map((r) => [r.name, t(DECISION_KEYS[r.decision]), r.comment, r.decidedBy, formatTime(r.decidedAt), yesNo(r.byAssessor), yesNo(r.bulk)]),
    language,
  );
}

/** An answer as the survey labels it, with its code when it has a label ("Forest (F)"); several stay as given. */
export function answerLabel(options: AnswerOptions, key: string, value: string): string {
  const label = options[key]?.find((o) => o.code === value)?.label;
  return label && label !== value ? `${label} (${value})` : value;
}

/** Differences: one row per question that differs between a first assessment and its check. */
export function differencesCsv(
  t: Translate,
  data: { rows: readonly DifferenceRow[]; labels: Record<string, string>; options: AnswerOptions; numbers: readonly string[] },
  language: string,
): string {
  const numbers = new Set(data.numbers);
  // A number question's answer is written as a number (with the language's decimal), not as text.
  const answer = (key: string, value: string): string | number =>
    numbers.has(key) && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : answerLabel(data.options, key, value);
  const header: MessageKey[] = [
    "activity.csv.plot",
    "activity.csv.first",
    "activity.csv.check",
    "activity.csv.question",
    "activity.csv.firstAnswer",
    "activity.csv.checkAnswer",
    "activity.csv.decision",
  ];
  return csvText(
    header.map((k) => t(k)),
    data.rows.map((r) => [
      r.name,
      r.first,
      r.check,
      r.key === null ? t(r.status === "gone" ? "activity.csv.gone" : "activity.csv.changed") : (data.labels[r.key] ?? r.key),
      r.key === null || r.firstAnswer === null ? null : answer(r.key, r.firstAnswer),
      r.key === null || r.checkAnswer === null ? null : answer(r.key, r.checkAnswer),
      r.decision === null ? null : t(DECISION_KEYS[r.decision]),
    ]),
    language,
  );
}
