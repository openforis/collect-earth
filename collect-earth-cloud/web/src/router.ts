import { useSyncExternalStore, type MouseEvent } from "react";

// A tiny history-based router: the dashboard has a handful of fixed pages, so a
// path <-> route table is all it needs. The server returns index.html for every
// app path (/join/<token>, /projects/..., /setup, /reset/<token>), so deep links work.

// Progress is the first tab (its path is the project's own). The tabs are what is used day to day; Setup holds the
// project's configuration, section by section (PROJECT_VIEWS.setup), starting with the getting-started checklist.
export const PROJECT_TABS = ["progress", "map", "people", "quality", "training", "data", "activity", "setup"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/**
 * The tabs split into views, each with its own address (/projects/<id>/quality/checks); the first is the tab's own
 * address. A tab not listed has one page.
 */
export const PROJECT_VIEWS = {
  quality: ["review", "checks", "figures", "notes"],
  people: ["members", "team"],
  setup: ["overview", "survey", "plots", "areas", "layout", "quality", "schedule", "sharing", "next", "project"],
} as const satisfies Partial<Record<ProjectTab, readonly string[]>>;
export type ViewTab = keyof typeof PROJECT_VIEWS;
export type ProjectView<T extends ViewTab = ViewTab> = (typeof PROJECT_VIEWS)[T][number];

/** Tabs of before, now Setup's sections: their old addresses open the section. */
const MOVED_TABS: Record<string, ProjectView<"setup">> = { overview: "overview", file: "survey", plots: "plots", settings: "project" };

/** A tab's view from an address part: the first view when none or not one of them. */
export function viewOf<T extends ViewTab>(tab: T, view: string | undefined): ProjectView<T> {
  const views = PROJECT_VIEWS[tab] as readonly string[];
  return (view && views.includes(view) ? view : views[0]) as ProjectView<T>;
}

export type Route =
  | { name: "home" }
  | { name: "setup" }
  | { name: "login" }
  | { name: "signup" }
  | { name: "project"; projectId: string; tab: ProjectTab; view?: string }
  /** One plot file of a project, where its plots are divided between people (under the Plot files tab). */
  | { name: "plotFile"; projectId: string; fileId: string }
  /** One training set's page (coordinators), under the Training tab. */
  | { name: "trainingSet"; projectId: string; setId: string }
  /** One person's page (under the People tab, coordinators). */
  | { name: "person"; projectId: string; userId: string }
  /** A member's own quality report (any member with an account), printable. */
  | { name: "myQuality"; projectId: string }
  /** A member's own work: the numbers the coordinators see about them (any member with an account). */
  | { name: "myWork"; projectId: string }
  /** The analysis of the collected data, the pivot table that replaces Saiku (any member: a collector sees their own plots). */
  | { name: "analysis"; projectId: string }
  /** The IPCC uncertainty of the land areas (coordinators and reviewers), from the analysis page. */
  | { name: "uncertainty"; projectId: string }
  /** The coordinators' printable team report, for training (no names). */
  | { name: "teamReport"; projectId: string }
  /** A training set's printable report (coordinators): agreement, golden answers, scores. */
  | { name: "trainingReport"; projectId: string; setId: string }
  /** One plot found by plot search (coordinators and reviewers), under the Quality tab. */
  | { name: "plot"; projectId: string; plot: string }
  /** The printable weekly summary (coordinators): an ISO week (YYYY-Www), or null for this week. */
  | { name: "weekly"; projectId: string; week: string | null }
  | { name: "join"; token: string }
  | { name: "reset"; token: string }
  /** A read-only progress link for funders (no login): /p/<token>. */
  | { name: "publicProgress"; token: string }
  /** A weekly email's unsubscribe link (no login): /unsubscribe/<token>. */
  | { name: "unsubscribe"; token: string }
  /** An email confirmation link (no login): /confirm-email/<token>. */
  | { name: "confirmEmail"; token: string }
  | { name: "account" }
  /** The server administrators' page, by section (/server is the overview). */
  | { name: "server"; section: ServerSection }
  | { name: "notFound"; path: string };

/** The sections of the server administrators' page, in the menu's order. */
export const SERVER_SECTIONS = ["overview", "accounts", "projects", "settings", "system"] as const;
export type ServerSection = (typeof SERVER_SECTIONS)[number];

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The route for a URL path (query string and hash are ignored). */
export function matchRoute(pathname: string): Route {
  const path = pathname.split(/[?#]/)[0];
  const parts = path.split("/").filter((p) => p.length > 0);
  const [first, second, third, fourth, fifth] = parts;
  if (parts.length === 0) return { name: "home" };
  if (parts.length === 1) {
    switch (first) {
      case "projects":
        return { name: "home" };
      case "setup":
        return { name: "setup" };
      case "login":
        return { name: "login" };
      case "signup":
        return { name: "signup" };
      case "account":
        return { name: "account" };
      case "server":
        return { name: "server", section: "overview" };
    }
  }
  if (first === "server" && parts.length === 2 && (SERVER_SECTIONS as readonly string[]).includes(second) && second !== "overview") {
    return { name: "server", section: second as ServerSection };
  }
  if (first === "join" && parts.length === 2) {
    const token = decode(second);
    if (token) return { name: "join", token };
  }
  if (first === "reset" && parts.length === 2) {
    const token = decode(second);
    if (token) return { name: "reset", token };
  }
  if (first === "p" && parts.length === 2) {
    const token = decode(second);
    if (token) return { name: "publicProgress", token };
  }
  if (first === "unsubscribe" && parts.length === 2) {
    const token = decode(second);
    if (token) return { name: "unsubscribe", token };
  }
  if (first === "confirm-email" && parts.length === 2) {
    const token = decode(second);
    if (token) return { name: "confirmEmail", token };
  }
  if (first === "projects" && parts.length === 3 && third === "my-quality") {
    const projectId = decode(second);
    if (projectId) return { name: "myQuality", projectId };
  }
  if (first === "projects" && parts.length === 3 && third === "my-work") {
    const projectId = decode(second);
    if (projectId) return { name: "myWork", projectId };
  }
  if (first === "projects" && parts.length === 3 && third === "analysis") {
    const projectId = decode(second);
    if (projectId) return { name: "analysis", projectId };
  }
  if (first === "projects" && parts.length === 4 && third === "analysis" && fourth === "uncertainty") {
    const projectId = decode(second);
    if (projectId) return { name: "uncertainty", projectId };
  }
  // A view of a tab split into views (before /people/<id>, a person's page: their ids are never a view's name)
  if (first === "projects" && parts.length === 4 && third in PROJECT_VIEWS && (PROJECT_VIEWS[third as ViewTab] as readonly string[]).includes(fourth)) {
    const projectId = decode(second);
    if (projectId) return { name: "project", projectId, tab: third as ProjectTab, view: fourth };
  }
  if (first === "projects" && parts.length === 4 && third === "people") {
    const projectId = decode(second);
    const userId = decode(fourth);
    if (projectId && userId) return { name: "person", projectId, userId };
  }
  if (first === "projects" && parts.length === 5 && third === "training" && fifth === "report") {
    const projectId = decode(second);
    const setId = decode(fourth);
    if (projectId && setId) return { name: "trainingReport", projectId, setId };
  }
  if (first === "projects" && parts.length === 4 && third === "quality" && fourth === "team-report") {
    const projectId = decode(second);
    if (projectId) return { name: "teamReport", projectId };
  }
  if (first === "projects" && (parts.length === 4 || parts.length === 5) && third === "activity" && fourth === "week") {
    const projectId = decode(second);
    const week = parts.length === 5 ? decode(fifth) : null;
    if (projectId && (parts.length === 4 || (week && /^\d{4}-W\d{2}$/.test(week)))) return { name: "weekly", projectId, week };
  }
  if (first === "projects" && parts.length === 5 && third === "quality" && fourth === "plot") {
    const projectId = decode(second);
    const plot = decode(fifth);
    if (projectId && plot) return { name: "plot", projectId, plot };
  }
  if (first === "projects" && (parts.length === 2 || parts.length === 3)) {
    const projectId = decode(second);
    // The tabs that became Setup's sections, and "overview" (Setup's old name): old links still open them.
    const moved = third ? MOVED_TABS[third] : undefined;
    if (projectId && moved) return { name: "project", projectId, tab: "setup", ...(moved === "overview" ? {} : { view: moved }) };
    const tab = (third ?? "progress") as ProjectTab;
    if (projectId && PROJECT_TABS.includes(tab)) return { name: "project", projectId, tab };
  }
  if (first === "projects" && parts.length === 4 && third === "plots") {
    const projectId = decode(second);
    const fileId = decode(fourth);
    if (projectId && fileId) return { name: "plotFile", projectId, fileId };
  }
  if (first === "projects" && parts.length === 4 && third === "training") {
    const projectId = decode(second);
    const setId = decode(fourth);
    if (projectId && setId) return { name: "trainingSet", projectId, setId };
  }
  return { name: "notFound", path };
}

/** The URL path of a route (the inverse of matchRoute). */
export function pathFor(route: Route): string {
  switch (route.name) {
    case "home":
      return "/";
    case "project":
      return `/projects/${encodeURIComponent(route.projectId)}${route.tab === "progress" ? "" : `/${route.tab}`}${
        route.view && route.tab in PROJECT_VIEWS && route.view !== PROJECT_VIEWS[route.tab as ViewTab][0] ? `/${route.view}` : ""
      }`;
    case "plotFile":
      return `/projects/${encodeURIComponent(route.projectId)}/plots/${encodeURIComponent(route.fileId)}`;
    case "trainingSet":
      return `/projects/${encodeURIComponent(route.projectId)}/training/${encodeURIComponent(route.setId)}`;
    case "person":
      return `/projects/${encodeURIComponent(route.projectId)}/people/${encodeURIComponent(route.userId)}`;
    case "myQuality":
      return `/projects/${encodeURIComponent(route.projectId)}/my-quality`;
    case "myWork":
      return `/projects/${encodeURIComponent(route.projectId)}/my-work`;
    case "teamReport":
      return `/projects/${encodeURIComponent(route.projectId)}/quality/team-report`;
    case "analysis":
      return `/projects/${encodeURIComponent(route.projectId)}/analysis`;
    case "uncertainty":
      return `/projects/${encodeURIComponent(route.projectId)}/analysis/uncertainty`;
    case "trainingReport":
      return `/projects/${encodeURIComponent(route.projectId)}/training/${encodeURIComponent(route.setId)}/report`;
    case "plot":
      return `/projects/${encodeURIComponent(route.projectId)}/quality/plot/${encodeURIComponent(route.plot)}`;
    case "weekly":
      return `/projects/${encodeURIComponent(route.projectId)}/activity/week${route.week ? `/${encodeURIComponent(route.week)}` : ""}`;
    case "join":
      return `/join/${encodeURIComponent(route.token)}`;
    case "reset":
      return `/reset/${encodeURIComponent(route.token)}`;
    case "publicProgress":
      return `/p/${encodeURIComponent(route.token)}`;
    case "unsubscribe":
      return `/unsubscribe/${encodeURIComponent(route.token)}`;
    case "confirmEmail":
      return `/confirm-email/${encodeURIComponent(route.token)}`;
    case "server":
      return route.section === "overview" ? "/server" : `/server/${route.section}`;
    case "notFound":
      return route.path;
    default:
      return `/${route.name}`;
  }
}

/** Pages anyone can open without an account, even before the server is set up. */
export function isPublicRoute(route: Route): boolean {
  return route.name === "join" || route.name === "reset" || route.name === "publicProgress" || route.name === "unsubscribe" || route.name === "confirmEmail";
}

/** Pages for people who are not logged in (a logged-in person is sent home from them). */
export function isLoggedOutRoute(route: Route): boolean {
  return route.name === "login" || route.name === "signup" || route.name === "setup";
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/**
 * A page that holds changes not saved yet asks before the app moves elsewhere: the guard answers false to stop this
 * move (it then asks, and navigates itself once the person chooses to leave). One at a time; null removes it.
 */
let leaveGuard: ((path: string) => boolean) | null = null;
export function setLeaveGuard(guard: ((path: string) => boolean) | null): void {
  leaveGuard = guard;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (leaveGuard && !leaveGuard(path)) return;
  if (options.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.scrollTo?.(0, 0);
  notify();
}

/** The current path; re-renders the caller when it changes. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/");
}

/**
 * href + onClick for any clickable element (MUI Button, Link, CardActionArea…) so it
 * navigates inside the app, while ctrl/middle-click still open a new tab.
 */
export function linkProps(path: string): { href: string; onClick: (event: MouseEvent<HTMLElement>) => void } {
  return {
    href: path,
    onClick: (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(path);
    },
  };
}
