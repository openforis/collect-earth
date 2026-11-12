import type { ImagerySource, ImageryStatus } from "./types";

/**
 * The source buttons of Google Earth Web's panel: one per tab but Google Earth Web's, which is the page around the
 * panel; one even for a single other source, as its button brings the window of the other sources forward.
 */
export function imageryChoices(status: ImageryStatus): { source: ImagerySource; shown: boolean }[] {
  return status.sources.filter((source) => source !== "GOOGLE_EARTH_WEB")
    .map((source) => ({ source, shown: source === status.visible }));
}

/**
 * The number of a source's key (Alt+1, Alt+2...): its place among the tabs, Google Earth Web first, though it has no
 * button.
 */
export function imageryNumberOf(status: ImageryStatus, source: ImagerySource): number {
  return status.sources.indexOf(source) + 1;
}

/** The source the key of number `n` shows (see imageryNumberOf), when it has a button; null otherwise */
export function imageryForNumber(status: ImageryStatus, n: number): ImagerySource | null {
  return imageryChoices(status).find((c) => imageryNumberOf(status, c.source) === n)?.source ?? null;
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
