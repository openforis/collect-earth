import { useSyncExternalStore, type MouseEvent } from "react";

// A tiny history-based router: the dashboard has a handful of fixed pages, so a
// path <-> route table is all it needs. The server returns index.html for every
// app path (/join/<token>, /projects/..., /setup, /reset/<token>), so deep links work.

export const PROJECT_TABS = ["overview", "file", "people", "plots", "data", "settings"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export type Route =
  | { name: "home" }
  | { name: "setup" }
  | { name: "login" }
  | { name: "signup" }
  | { name: "project"; projectId: string; tab: ProjectTab }
  | { name: "join"; token: string }
  | { name: "reset"; token: string }
  | { name: "account" }
  | { name: "server" }
  | { name: "notFound"; path: string };

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
  const [first, second, third] = parts;
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
        return { name: "server" };
    }
  }
  if (first === "join" && parts.length === 2) {
    const token = decode(second);
    if (token) return { name: "join", token };
  }
  if (first === "reset" && parts.length === 2) {
    const token = decode(second);
    if (token) return { name: "reset", token };
  }
  if (first === "projects" && (parts.length === 2 || parts.length === 3)) {
    const projectId = decode(second);
    const tab = (third ?? "overview") as ProjectTab;
    if (projectId && PROJECT_TABS.includes(tab)) return { name: "project", projectId, tab };
  }
  return { name: "notFound", path };
}

/** The URL path of a route (the inverse of matchRoute). */
export function pathFor(route: Route): string {
  switch (route.name) {
    case "home":
      return "/";
    case "project":
      return `/projects/${encodeURIComponent(route.projectId)}${route.tab === "overview" ? "" : `/${route.tab}`}`;
    case "join":
      return `/join/${encodeURIComponent(route.token)}`;
    case "reset":
      return `/reset/${encodeURIComponent(route.token)}`;
    case "notFound":
      return route.path;
    default:
      return `/${route.name}`;
  }
}

/** Pages anyone can open without an account, even before the server is set up. */
export function isPublicRoute(route: Route): boolean {
  return route.name === "join" || route.name === "reset";
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

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
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
