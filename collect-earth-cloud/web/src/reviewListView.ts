// The review queue as a list (docs/plans/2026-11-20-review-at-scale.md, A1-A2): what the lines say, the pages, the
// selection, and what one decision for many plots is for. Pure: the list component (project/ReviewList.tsx) draws them.

import type { ApplyTarget, ReviewListLine, ReviewListQuery, SkippedPlot } from "./api";
import { FLAG_KIND_KEYS } from "./flagsView";
import type { MessageKey, Translate } from "./i18n";

/** Why a plot is in the list, as words (a kind of flag, a check that differs, saved again) */
export function kindKey(kind: string): MessageKey | null {
  if (kind === "difference") return "queue.kind.difference";
  if (kind === "resubmitted") return "queue.kind.resubmitted";
  return (FLAG_KIND_KEYS as Record<string, MessageKey>)[kind] ?? null;
}

export function kindsText(t: Translate, line: Pick<ReviewListLine, "kinds">): string {
  return line.kinds.map((k) => { const key = kindKey(k); return key ? t(key) : k; }).join(", ");
}

/** The number of pages, and the page (from 1) an offset is on */
export const pageCount = (total: number, limit: number): number => Math.max(1, Math.ceil(total / limit));
export const pageOf = (offset: number, limit: number): number => Math.floor(offset / limit) + 1;

/** The plots picked: some by name, or all those the filters show */
export interface Selection {
  plots: ReadonlySet<string>;
  /** Every plot that matches the filters, on every page */
  allMatching: boolean;
}

export const NO_SELECTION: Selection = { plots: new Set(), allMatching: false };

export function toggle(selection: Selection, plot: string): Selection {
  const plots = new Set(selection.plots);
  if (plots.has(plot)) plots.delete(plot);
  else plots.add(plot);
  return { plots, allMatching: false };
}

/** Picks the page's plots, or leaves them when all were picked */
export function togglePage(selection: Selection, page: readonly string[]): Selection {
  const all = page.length > 0 && page.every((plot) => selection.plots.has(plot));
  const plots = new Set(selection.plots);
  for (const plot of page) {
    if (all) plots.delete(plot);
    else plots.add(plot);
  }
  return { plots, allMatching: false };
}

/** Whether the page's box is ticked (all), half ticked (some) or not */
export function pageState(selection: Selection, page: readonly string[]): "all" | "some" | "none" {
  if (selection.allMatching) return page.length > 0 ? "all" : "none";
  const n = page.filter((plot) => selection.plots.has(plot)).length;
  return n === 0 ? "none" : n === page.length ? "all" : "some";
}

export const isPicked = (selection: Selection, plot: string): boolean => selection.allMatching || selection.plots.has(plot);

/** How many plots the selection is for */
export const pickedCount = (selection: Selection, total: number): number => (selection.allMatching ? total : selection.plots.size);

/** What one decision is for: the plots picked, or the filters (every page) */
export function applyTarget(selection: Selection, query: ReviewListQuery): ApplyTarget {
  return selection.allMatching ? { filter: { state: query.state, person: query.person, kind: query.kind, q: query.q } } : { plots: [...selection.plots] };
}

/**
 * The plots of a page worked through one at a time: those still waiting (a decided plot opens on its own page), from
 * the one clicked on to the end of the page, then the page's first ones.
 */
export function cardSequence(lines: readonly ReviewListLine[], from: string): string[] {
  const waiting = lines.filter((l) => l.section !== null).map((l) => l.plot);
  const at = waiting.indexOf(from);
  return at < 0 ? waiting : [...waiting.slice(at), ...waiting.slice(0, at)];
}

const SKIPPED_KEYS: Record<SkippedPlot["reason"], MessageKey> = {
  no_check: "reviewList.skipped.no_check",
  not_in_list: "reviewList.skipped.not_in_list",
  reference_plot: "reviewList.skipped.reference_plot",
};

/** "12: it has no check" */
export const skippedText = (t: Translate, s: SkippedPlot): string => t(SKIPPED_KEYS[s.reason], { plot: s.plot });
