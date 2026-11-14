// The view logic of the server administrators' page (pages/ServerPage.tsx): the health line on Overview, and the counts on
// the menu's sections.
import type { ServerOverview } from "./api";
import type { ServerSection } from "./router";

/** One thing that needs the administrator's attention, and the section where it is seen and fixed. */
export type HealthItem =
  | { kind: "alerts"; count: number; section: ServerSection }
  | { kind: "migrations"; count: number; section: ServerSection }
  | { kind: "mail"; section: ServerSection }
  | { kind: "versions"; count: number; section: ServerSection };

/**
 * What needs attention: the alerts not marked seen, the database updates not applied, and mail not set up
 * (no password reset links, no weekly emails), and the accounts using an outdated Collect Earth. Nothing for a figure
 * not loaded yet.
 */
export function serverHealth(input: {
  /** Alerts kept and not marked seen (GET /v1/admin/alerts) */
  unseenAlerts: number | null;
  overview: ServerOverview | null;
  mailReady: boolean | null;
  /** The accounts using an outdated Collect Earth (GET /v1/admin/versions) */
  outdatedAccounts?: number | null;
  now?: number;
}): HealthItem[] {
  const items: HealthItem[] = [];
  if ((input.unseenAlerts ?? 0) > 0) items.push({ kind: "alerts", count: input.unseenAlerts!, section: "overview" });
  const missing = input.overview?.database.migrations?.missing.length ?? 0;
  if (missing > 0) items.push({ kind: "migrations", count: missing, section: "system" });
  if (input.mailReady === false) items.push({ kind: "mail", section: "system" });
  if ((input.outdatedAccounts ?? 0) > 0) items.push({ kind: "versions", count: input.outdatedAccounts!, section: "system" });
  return items;
}

/** How many things need attention in each section, for the counts on the menu (sections with none are left out). */
export function attentionBySection(items: readonly HealthItem[]): Partial<Record<ServerSection, number>> {
  const counts: Partial<Record<ServerSection, number>> = {};
  for (const item of items) counts[item.section] = (counts[item.section] ?? 0) + 1;
  return counts;
}
