import type { SamplingFileRule, SamplingRuleInput, SamplingView } from "./api";
import type { Translate } from "./i18n";

/**
 * The server's warning checkers_not_blind (GET/PUT /sampling): the reviewers and coordinators the
 * rule chooses can read the first assessments on the dashboard, so their checks may not be blind.
 */
export function notBlindText(t: Translate, usernames: readonly string[]): string {
  return t(usernames.length === 1 ? "checks.notBlindOne" : "checks.notBlind", { names: usernames.join(", ") });
}

/** The server's limits (src/sampling.ts). */
export const MAX_FIRST_N = 1000;
export const MAX_PERCENT = 100;
/** What a new rule suggests. */
export const SUGGESTED = 10;

export type FileUse = "project" | "off" | "own";

export interface FileForm {
  use: FileUse;
  /** Empty: off. */
  firstN: string;
  percent: string;
}

/** The Checks section's form, as typed. */
export interface ChecksForm {
  firstNOn: boolean;
  firstN: string;
  percentOn: boolean;
  percent: string;
  /** Every collector (the default: reviewers and coordinators only when chosen), or only `checkers`. */
  checkersAll: boolean;
  checkers: string[];
  files: Record<string, FileForm>;
}

/** A whole number from min to max, written with digits only (spaces around allowed); null otherwise. */
export function wholeNumber(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

const text = (n: number | null) => (n === null ? "" : String(n));

/** The form for the rule saved (or the suggested one when there is none). */
export function formOf(view: SamplingView): ChecksForm {
  const rule = view.rule;
  const files: Record<string, FileForm> = {};
  for (const f of view.files) {
    const own = rule?.files[f.csvFileId];
    files[f.csvFileId] = own?.use === "own" ? { use: "own", firstN: text(own.firstN), percent: text(own.percent) } : { use: own?.use === "off" ? "off" : "project", firstN: "", percent: "" };
  }
  return {
    firstNOn: rule?.firstN != null,
    firstN: String(rule?.firstN ?? SUGGESTED),
    percentOn: rule?.percent != null,
    percent: String(rule?.percent ?? SUGGESTED),
    checkersAll: rule?.checkers == null,
    checkers: rule?.checkers ?? [],
    files,
  };
}

/** What is wrong with the form: the field, and for a file its id. */
export type FormError = { field: "firstN" | "percent"; file?: string };

/**
 * The rule to save, or the first field that cannot be saved. A file with a rule of its own
 * takes the project's checkers; its fields left empty are off.
 */
export function ruleOf(form: ChecksForm): { rule: SamplingRuleInput } | { error: FormError } {
  const firstN = form.firstNOn ? wholeNumber(form.firstN, 1, MAX_FIRST_N) : null;
  if (form.firstNOn && firstN === null) return { error: { field: "firstN" } };
  const percent = form.percentOn ? wholeNumber(form.percent, 1, MAX_PERCENT) : null;
  if (form.percentOn && percent === null) return { error: { field: "percent" } };
  const checkers = form.checkersAll ? null : [...form.checkers];
  const files: Record<string, SamplingFileRule> = {};
  for (const [id, f] of Object.entries(form.files)) {
    if (f.use === "off") files[id] = { use: "off" };
    if (f.use !== "own") continue;
    const n = f.firstN.trim() === "" ? null : wholeNumber(f.firstN, 1, MAX_FIRST_N);
    if (f.firstN.trim() !== "" && n === null) return { error: { field: "firstN", file: id } };
    const p = f.percent.trim() === "" ? null : wholeNumber(f.percent, 1, MAX_PERCENT);
    if (f.percent.trim() !== "" && p === null) return { error: { field: "percent", file: id } };
    files[id] = { use: "own", checkers, firstN: n, percent: p };
  }
  return { rule: { checkers, firstN, percent, files } };
}

/**
 * The warnings of the form as typed, before it is saved (the server's noCheckers and
 * checkers_not_blind for the saved rule, src/sampling.ts checkersOf and notBlindCheckers):
 * - noCheckers: a part of the rule is on and nobody can receive checks (nobody ticked, or no
 *   active collector when every collector may check);
 * - notBlind: the reviewers and coordinators ticked, by username, sorted.
 * A file with a rule of its own takes the project's checkers (ruleOf).
 */
export function formWarnings(form: ChecksForm, members: SamplingView["members"]): { noCheckers: boolean; notBlind: string[] } {
  const chosen = form.checkersAll ? null : new Set(form.checkers);
  const active =
    form.firstNOn ||
    form.percentOn ||
    Object.values(form.files).some((f) => f.use === "own" && (f.firstN.trim() !== "" || f.percent.trim() !== ""));
  const eligible = members.filter((m) => !m.disabled && (chosen ? chosen.has(m.userId) : m.role === "operator"));
  const notBlind = chosen
    ? members
        .filter((m) => chosen.has(m.userId) && (m.role === "reviewer" || m.role === "admin"))
        .map((m) => m.username)
        .sort()
    : [];
  return { noCheckers: active && eligible.length === 0, notBlind };
}
