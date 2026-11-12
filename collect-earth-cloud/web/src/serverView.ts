// The view logic of the server administrators' page (pages/ServerPage.tsx): the health line at the top of each section.
import type { OwnerAlert, ServerOverview } from "./api";
import type { ServerSection } from "./router";

/** One thing that needs the administrator's attention, and the section where it is seen and fixed. */
export type HealthItem =
  | { kind: "alerts"; count: number; section: ServerSection }
  | { kind: "migrations"; count: number; section: ServerSection }
  | { kind: "mail"; section: ServerSection };

const DAY_MS = 24 * 3600 * 1000;

/**
 * What needs attention: the alerts raised in the last 24 hours, the database updates not applied, and mail not set up
 * (no password reset links, no weekly emails). Nothing for a figure not loaded yet.
 */
export function serverHealth(input: { alerts: readonly OwnerAlert[] | null; overview: ServerOverview | null; mailReady: boolean | null; now: number }): HealthItem[] {
  const items: HealthItem[] = [];
  const recent = (input.alerts ?? []).filter((a) => input.now - a.at < DAY_MS).length;
  if (recent > 0) items.push({ kind: "alerts", count: recent, section: "overview" });
  const missing = input.overview?.database.migrations?.missing.length ?? 0;
  if (missing > 0) items.push({ kind: "migrations", count: missing, section: "system" });
  if (input.mailReady === false) items.push({ kind: "mail", section: "system" });
  return items;
}
