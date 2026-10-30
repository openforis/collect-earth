import { normalizeStatus } from "./plots";
import type { PlotStatus } from "./types";

/** The app without a map, which Collect Earth opens with the Google Earth Pro viewer (BrowserService.homeUrl). */
export function isHome(search: string): boolean {
  return new URLSearchParams(search).has("home");
}

export const IN_HOME = typeof window !== "undefined" && isHome(window.location.search);

/**
 * How many plots are done, started and not started: a plot with no status yet is not started. The controller keeps
 * its statuses normalised already (normalizeStatus); they are read through it all the same, so anything else counts as
 * not started rather than as nothing.
 */
export function statusCounts(ids: string[], statuses: Record<string, PlotStatus | undefined>) {
  const counts = { saved: 0, partial: 0, empty: 0, total: ids.length };
  for (const id of ids) counts[normalizeStatus(statuses[id])]++;
  return counts;
}
