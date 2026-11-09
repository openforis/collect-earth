// Pure helpers of the "Reference plots" section (Task 14).
import type { ExternalReferenceView, Rate, ReferenceFiguresView, ReferencePerson } from "./api";
import type { MessageKey, Translate } from "./i18n";
import { formatRate, MIN_CHECKS } from "./qualityView";

/**
 * The plot ids typed or pasted: one per line (or separated by semicolons or tabs, as a column
 * pasted from a spreadsheet), each trimmed, empty ones and repeats left out. Commas are not
 * separators: a plot of a survey with several keys is "12,3".
 */
export function parsePlotIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[\r\n;\t]+/)) {
    const id = part.trim();
    if (id !== "" && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** "75 % match the reference (15 of 20 plots)", or "Too few plots to judge (12 plots, 20 needed)". */
export function accuracyText(t: Translate, rate: Rate, language: string): string {
  if (rate.rate === null) return t(rate.compared === 1 ? "reference.tooFewOne" : "reference.tooFew", { count: rate.compared, min: MIN_CHECKS });
  return t("reference.match", { pct: formatRate(rate.rate, language), agreeing: rate.agreeing, count: rate.compared });
}

/** The page's text for a refused mark (the server's `code`), or null for another error. */
export function refusalKey(code: unknown): MessageKey | null {
  switch (code) {
    case "whole_file":
      return "reference.refused.wholeFile";
    case "unknown_plots":
      return "reference.refused.unknownPlots";
    case "not_a_plot":
      return "reference.refused.notAPlot";
    case "in_other_file":
      return "reference.refused.inOtherFile";
    case "assessed_by_others":
      return "reference.refused.assessedByOthers";
    case "too_many":
      return "reference.refused.tooMany";
    case "bad_assessor":
      return "reference.refused.badAssessor";
    case "none_free":
      return "reference.refused.noneFree";
    default:
      return null;
  }
}

/** People with the lowest accuracy first (those with a rate), then those with too few plots, by name. */
export function sortedPeople(figures: ReferenceFiguresView): ReferencePerson[] {
  return [...figures.people].sort((a, b) => {
    const ra = a.plots.rate;
    const rb = b.plots.rate;
    if (ra !== null && rb !== null && ra !== rb) return ra - rb;
    if ((ra === null) !== (rb === null)) return ra === null ? 1 : -1;
    return a.username.localeCompare(b.username);
  });
}

/** A person's weakest questions: those with a rate, lowest first, at most `max`; then (none with a rate) the most often missed. */
export function weakestQuestions(person: ReferencePerson, max = 3): ReferencePerson["questions"] {
  return person.questions
    .filter((q) => q.agreeing < q.compared)
    .sort((a, b) => {
      if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
      if (a.rate !== null && b.rate !== null && a.rate !== b.rate) return a.rate - b.rate;
      return b.compared - b.agreeing - (a.compared - a.agreeing) || a.key.localeCompare(b.key);
    })
    .slice(0, max);
}

// --- reference answers from a file ----------------------------------------------------

/** "67 % differ from the reference (20 of 30 answers)", or "Too few answers to judge (4 answers, 20 needed)". */
export function disagreementText(t: Translate, rate: Rate, language: string): string {
  if (rate.rate === null) return t(rate.compared === 1 ? "reference.ext.tooFewOne" : "reference.ext.tooFew", { count: rate.compared, min: MIN_CHECKS });
  return t("reference.ext.differ", { pct: formatRate(1 - rate.rate, language), differing: rate.compared - rate.agreeing, count: rate.compared });
}

/** More than half of the answers differ from the reference (a rate to judge by only). */
export function aboveHalf(rate: Rate): boolean {
  return rate.rate !== null && 1 - rate.rate > 0.5;
}

/** Every question's answers together: the project's share (a rate from MIN_CHECKS answers). */
export function overallRate(questions: readonly Rate[]): Rate {
  const compared = questions.reduce((sum, q) => sum + q.compared, 0);
  const agreeing = questions.reduce((sum, q) => sum + q.agreeing, 0);
  return { compared, agreeing, rate: compared >= MIN_CHECKS ? agreeing / compared : null };
}

/** The plots with differing answers, the largest share differing first (then the most differing), at most `max`. */
export function mostDiffering(byPlot: ExternalReferenceView["byPlot"], max = 50): ExternalReferenceView["byPlot"] {
  const share = (p: ExternalReferenceView["byPlot"][number]) => (p.compared - p.agreeing) / p.compared;
  return byPlot
    .filter((p) => p.agreeing < p.compared)
    .sort((a, b) => share(b) - share(a) || b.compared - b.agreeing - (a.compared - a.agreeing) || a.plot.localeCompare(b.plot, "en", { numeric: true }))
    .slice(0, max);
}
