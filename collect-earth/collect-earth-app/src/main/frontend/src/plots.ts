import type { ListFilter, PlotStatus } from "./types";

// Pure plot-list logic shared by the store and the UI (unit tested in plots.test.ts).

export function matchesFilter(id: string, status: PlotStatus, filter: ListFilter, query: string): boolean {
  if (filter === "pending" && status === "saved") return false;
  if (filter === "saved" && status !== "saved") return false;
  const q = query.trim().toLowerCase();
  return !q || id.toLowerCase().includes(q);
}

export function visibleIds(order: string[], statuses: Record<string, PlotStatus>,
    filter: ListFilter, query: string): string[] {
  return order.filter((id) => matchesFilter(id, statuses[id] ?? "empty", filter, query));
}

/** First plot after `fromId` (wrapping around, CSV order) that is not completed. */
export function nextUnfinished(order: string[], statuses: Record<string, PlotStatus>,
    fromId: string | null): string | null {
  if (!order.length) return null;
  const start = fromId ? order.indexOf(fromId) + 1 : 0;
  for (let i = 0; i < order.length; i++) {
    const id = order[(start + i) % order.length];
    if (statuses[id] !== "saved") return id;
  }
  return null;
}

/** Neighbour of `fromId` among `ids` (step +1/-1); null at the ends. When `fromId` is
 *  not among `ids`, the first (or last) id is returned. */
export function neighbour(ids: string[], fromId: string | null, step: 1 | -1): string | null {
  if (!ids.length) return null;
  const index = fromId == null ? -1 : ids.indexOf(fromId);
  if (index === -1) return step > 0 ? ids[0] : ids[ids.length - 1];
  const next = index + step;
  return next >= 0 && next < ids.length ? ids[next] : null;
}

export interface Counts { total: number; saved: number; partial: number; pending: number }

export function countStatuses(order: string[], statuses: Record<string, PlotStatus>): Counts {
  let saved = 0, partial = 0;
  for (const id of order) {
    if (statuses[id] === "saved") saved++;
    else if (statuses[id] === "partial") partial++;
  }
  return { total: order.length, saved, partial, pending: order.length - saved };
}

export function normalizeStatus(value: unknown): PlotStatus {
  return value === "saved" || value === "partial" ? value : "empty";
}
