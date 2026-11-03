// The Quality tab's "Plots worth a look" (Task 5): the sentences of the flags, built from
// the server's figures. Pure, so it is tested on its own. A sentence names no one: the
// list shows whose plot it is beside it, and that is the only person a flag is about.
import { FLAG_KINDS, type FlagCounts, type FlagKind, type PatternFlag } from "./api";
import { formatDate, formatNumber } from "./format";
import type { MessageKey, Translate } from "./i18n";

export const FLAG_KIND_KEYS: Record<FlagKind, MessageKey> = {
  very_fast: "flags.kind.very_fast",
  same_as_before: "flags.kind.same_as_before",
  required_empty: "flags.kind.required_empty",
  edited_after_decision: "flags.kind.edited_after_decision",
  two_main: "flags.kind.two_main",
  no_plot: "flags.kind.no_plot",
};

/** The kinds the quality report finds (data problems): listed there, only counted and linked here. */
export const PROBLEM_KINDS: readonly FlagKind[] = ["two_main", "no_plot"];

/** A gap in seconds: one decimal under 10 s ("0.4 s", "8.5 s"), whole seconds above. */
export function gapText(t: Translate, ms: number, language: string): string {
  const seconds = ms / 1000;
  const n = seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds);
  return t("flags.seconds", { n: formatNumber(n, language) });
}

/** Why a plot is worth a look, in a sentence that names no one. */
export function flagText(t: Translate, flag: PatternFlag, language: string): string {
  switch (flag.kind) {
    // A previous or first plot the viewer may not see (a reviewer's held copy, a reference plot) comes as null: not named.
    case "very_fast":
      return t(flag.previousPlot === null ? "flags.text.very_fastUnnamed" : "flags.text.very_fast", { gap: gapText(t, flag.gapMs ?? 0, language), previous: flag.previousPlot ?? "" });
    case "same_as_before":
      return t(flag.previousPlot === null || flag.firstPlot === null ? "flags.text.same_as_beforeUnnamed" : "flags.text.same_as_before", {
        previous: flag.previousPlot ?? "",
        n: formatNumber(flag.runLength ?? 0, language),
        first: flag.firstPlot ?? "",
      });
    case "required_empty":
      return t(flag.questions.length === 1 ? "flags.text.required_emptyOne" : "flags.text.required_empty", { questions: flag.questions.map((q) => q.label).join(", ") });
    case "edited_after_decision":
      return t("flags.text.edited_after_decision", { at: formatDate(flag.at, language), decidedAt: formatDate(flag.decidedAt, language) });
    case "two_main":
      return t("flags.text.two_main");
    case "no_plot":
      return t("flags.text.no_plot");
  }
}

export function totalOf(counts: FlagCounts): number {
  return FLAG_KINDS.reduce((sum, k) => sum + counts[k], 0);
}

/** "Very fast: 3 · Required answer left empty: 1": the kinds with any, in their order. */
export function countsText(t: Translate, counts: FlagCounts, language: string): string {
  return FLAG_KINDS.filter((k) => counts[k] > 0)
    .map((k) => `${t(FLAG_KIND_KEYS[k])}: ${formatNumber(counts[k], language)}`)
    .join(" · ");
}

/** The threshold typed in the field, or null when it is not whole seconds from min to max. */
export function parseSeconds(text: string, min: number, max: number): number | null {
  const v = text.trim();
  if (!/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}
