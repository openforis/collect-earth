import type { ImagerySource, ImageryStatus } from "./types";

/**
 * The source buttons: one per tab, none when there is nothing to switch between. In Google Earth Web's panel
 * ({@code inPanel}) none for Google Earth Web, which is the page around it, and one even for a single other source:
 * its button brings the window of the other sources forward.
 */
export function imageryChoices(status: ImageryStatus, inPanel = false): { source: ImagerySource; shown: boolean }[] {
  const sources = inPanel ? status.sources.filter((source) => source !== "GOOGLE_EARTH_WEB") : status.sources;
  if (sources.length < (inPanel ? 1 : 2)) return [];
  return sources.map((source) => ({ source, shown: source === status.visible }));
}

/** The source the user picked, and until when it is shown pressed whatever the server says. */
export interface ImageryExpectation { source: ImagerySource; until: number }

/**
 * A status from the server, with the source the user picked kept as the one shown: the server brings its tab to the
 * front on a thread of its own, so for a moment it still reports the tab shown before, and the button pressed would
 * flip back. Until the server shows the picked source, or the wait is over; then the server wins (the tab may never
 * come to the front: no browser, a window closed meanwhile).
 */
export function reconcileImagery(server: ImageryStatus, expected: ImageryExpectation | null, now: number):
  { status: ImageryStatus; expected: ImageryExpectation | null } {
  if (!expected || server.visible === expected.source || now > expected.until) return { status: server, expected: null };
  return { status: { ...server, visible: expected.source }, expected };
}

export function sameImageryStatus(a: ImageryStatus, b: ImageryStatus): boolean {
  return a.visible === b.visible && a.sources.length === b.sources.length && a.sources.every((s, i) => s === b.sources[i]);
}
