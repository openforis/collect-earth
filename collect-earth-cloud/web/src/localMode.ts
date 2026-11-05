import type { ExportKind, LogKind, MapPlots, MapStatus } from "./api";
import { MAP_STATUSES } from "./api";
import { pathFor, PROJECT_TABS, type ProjectTab, type Route } from "./router";

// The single-person view (docs/plans/2026-11-03-desktop-dashboard.md, Task 4): the dashboard that
// Collect Earth runs on the person's own computer (the server's LOCAL_MODE, src/local.ts there),
// for one person working alone. Whatever is about other people (people, plot files and their
// division, checks, reference plots, the review queue, differences, progress links, mail, the AI)
// or about the server (accounts, the server panel, other projects) is left out, and the server
// answers 404 for it: nothing here may ask for it. Pure, so each tab's choices are tested.

/** The tabs, in their order: People, Plot files, Setup and the project file's tab are left out. */
export const LOCAL_TABS = ["progress", "map", "data", "quality", "activity", "settings"] as const satisfies readonly ProjectTab[];

/** The project's tabs in this mode. */
export function projectTabs(localMode: boolean): readonly ProjectTab[] {
  return localMode ? LOCAL_TABS : PROJECT_TABS;
}

export function isLocalTab(tab: ProjectTab): boolean {
  return (LOCAL_TABS as readonly ProjectTab[]).includes(tab);
}

/**
 * Where an address leads in the local mode, signed in: the page itself, or where to go instead.
 * `projectId` is the one project (null before the account has it). Pages about other people or
 * about accounts go to the project's Progress tab, or home (which goes there); so do the links
 * of mail and invitations, which this mode never makes.
 */
export function localPage(route: Route, projectId: string | null): { kind: "route"; route: Route } | { kind: "redirect"; to: string } {
  const progress = (id: string) => ({ kind: "redirect" as const, to: pathFor({ name: "project", projectId: id, tab: "progress" }) });
  switch (route.name) {
    case "home":
      return projectId ? progress(projectId) : { kind: "route", route };
    case "project":
      return isLocalTab(route.tab) ? { kind: "route", route } : progress(route.projectId);
    case "plot":
    case "weekly":
    case "analysis":
    case "notFound":
      return { kind: "route", route };
    case "plotFile":
    case "trainingSet":
    case "person":
    case "myQuality":
    case "myWork":
    case "teamReport":
    case "trainingReport":
      return progress(route.projectId);
    default:
      // Accounts (log in, sign up, setup, my account, the server panel) and the links of mail,
      // invitations, password resets and progress links.
      return { kind: "redirect", to: "/" };
  }
}

// --- Progress -----------------------------------------------------------------------

export type TotalStat = "plots" | "assigned" | "submitted" | "started" | "notStarted";

/** The headline numbers: plots given to someone mean nothing when one person holds them all. */
export function totalStats(localMode: boolean): readonly TotalStat[] {
  return localMode ? ["plots", "submitted", "started", "notStarted"] : ["plots", "assigned", "submitted", "started", "notStarted"];
}

/**
 * The "Needs attention" cards: none in the local mode. Every card is about other people (quiet
 * people, plots not downloaded or not given, late work, old project files or Collect Earths),
 * the checks' differences or the server's storage, and each points to a tab this mode hides.
 */
export function attentionShown<T>(localMode: boolean, attention: T[] | null): T[] | null {
  return localMode ? null : attention;
}

// --- Map ----------------------------------------------------------------------------

/** The statuses that can be reached alone: decisions and checks need other people. */
export const LOCAL_MAP_STATUSES: readonly MapStatus[] = ["notStarted", "started", "submitted"];

/** The statuses the legend lists: in the local mode those reachable alone, and any other that has plots. */
export function legendStatuses(localMode: boolean, counts: Record<MapStatus, number>): readonly MapStatus[] {
  if (!localMode) return MAP_STATUSES;
  return MAP_STATUSES.filter((s) => LOCAL_MAP_STATUSES.includes(s) || counts[s] > 0);
}

/** The map without who holds each plot (it is always the one person). */
export function localMapPlots(map: MapPlots): MapPlots {
  return { ...map, people: null, holders: null };
}

// --- Data ---------------------------------------------------------------------------

export type DataSection = "download" | "backup" | "qualityCheck";

/**
 * The Data tab's cards. Alone: the data download only. The Collect Earth backup is for opening a
 * cloud project's data in Collect Earth, whose own database already holds every record here; the
 * quality check's pointer is about checks.
 */
export function dataSections(localMode: boolean): readonly DataSection[] {
  return localMode ? ["download"] : ["download", "backup", "qualityCheck"];
}

// --- Quality ------------------------------------------------------------------------

export type QualitySection =
  | "reports"
  | "counts"
  | "reviewQueue"
  | "checks"
  | "reference"
  | "comparison"
  | "flags"
  | "answers"
  | "health"
  | "notes"
  | "problems"
  | "assistant";

/**
 * The Quality tab's sections, in their order. Alone: the pattern flags, the plain distribution of
 * your answers and the survey's health. The others compare people (checks, reference plots, the
 * review queue, the differences and the figures by person, the team report), write to collectors
 * (guidance notes) or are the AI's.
 */
export function qualitySections(localMode: boolean): readonly QualitySection[] {
  return localMode
    ? ["flags", "answers", "health"]
    : ["reports", "counts", "reviewQueue", "checks", "reference", "comparison", "flags", "answers", "health", "notes", "problems", "assistant"];
}

// --- Activity -----------------------------------------------------------------------

/** Kinds of the log under the coordinators' heading: alone, what the desktop and the person do here. */
export function otherLogKinds(localMode: boolean, coordinatorKinds: readonly LogKind[]): readonly LogKind[] {
  return localMode ? coordinatorKinds.filter((k) => k === "files" || k === "settings" || k === "downloads") : coordinatorKinds;
}

/** The CSV downloads: alone, the daily activity (the people table is one row; decisions and differences need checks). */
export function activityDownloads(localMode: boolean): readonly ExportKind[] {
  return localMode ? ["daily"] : ["people", "daily", "decisions", "differences"];
}

/** The weekly summary's blocks: alone, no one else's week, and quality is the pattern flags. */
export function weeklyBlocks(localMode: boolean): readonly ("progress" | "people" | "quality" | "flags")[] {
  return localMode ? ["progress", "flags"] : ["progress", "people", "quality"];
}

// --- Settings -----------------------------------------------------------------------

export type SettingsCard = "rename" | "progress" | "shareLinks" | "ai" | "delete";

/**
 * The Settings tab's cards. Alone: the progress settings (where the forecast's deadline and target
 * are set). The project's name and its deletion are the desktop's, and progress links and the AI
 * are off in this mode.
 */
export function settingsCards(localMode: boolean): readonly SettingsCard[] {
  return localMode ? ["progress"] : ["rename", "progress", "shareLinks", "ai", "delete"];
}

// --- One plot's page ----------------------------------------------------------------

/** What a plot's page shows besides its records and flags. Alone: no decision, differences, holders, nor whose record each is. */
export function plotPageParts(localMode: boolean): { decision: boolean; differences: boolean; holders: boolean; names: boolean; openFiles: boolean } {
  return localMode
    ? { decision: false, differences: false, holders: false, names: false, openFiles: false }
    : { decision: true, differences: true, holders: true, names: true, openFiles: true };
}
