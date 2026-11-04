// After a route change: the document title names the page, and the keyboard focus moves to the
// page's heading (so screen readers announce the new page and Tab starts from its top).
import { useEffect, useRef, useState } from "react";

/** How long a page may take to show its heading (it may load data first). */
const HEADING_WAIT_MS = 5000;

/** "Plot 17 – Quality – North survey – Our server": the non-empty parts, each once, in order. */
export function pageTitle(parts: readonly (string | null | undefined)[]): string {
  const seen: string[] = [];
  for (const part of parts) {
    const s = (part ?? "").replace(/\s+/g, " ").trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.join(" – ");
}

/**
 * A page's title, from the most particular to the most general: its own heading (a person, a plot,
 * a plot file) or, without one, what the address says (fallback: "Plot 10"), then the tab chosen,
 * the page's h1 (the project's name), what the page marks as its context (a report's project, under
 * its h1: data-page-context) and the server: "Plot 10 – Quality – North survey – Our server",
 * "Team report – North survey – Our server".
 */
export function pageTitleOf(parts: { own: string | null; fallback: string | null; tab: string | null; h1: string | null; context?: string | null; server: string }): string {
  return pageTitle([parts.own ?? parts.fallback, parts.tab, parts.h1, parts.context, parts.server]);
}

/**
 * The element a page names itself with: one marked data-page-heading (a person, a plot, a plot
 * file: pages inside a project's tab), else its h1; with ownHeading only the marked one.
 */
export function pageHeading(root: ParentNode, ownHeading = false): HTMLElement | null {
  const own = visibleMatch<HTMLElement>(root, "[data-page-heading]");
  return own ?? (ownHeading ? null : visibleMatch<HTMLElement>(root, "h1"));
}

/**
 * The first element matching that is not hidden by React: while a page's code loads, React keeps the
 * page before in the document with display: none, and its heading must not name the new page.
 */
export function visibleMatch<E extends Element>(root: ParentNode, selector: string): E | null {
  if (typeof root.querySelectorAll !== "function") return root.querySelector<E>(selector);
  for (const el of root.querySelectorAll<E>(selector)) {
    if (typeof el.closest !== "function" || !el.closest('[style*="display: none"]')) return el;
  }
  return null;
}

/**
 * Whether the focus may move to the heading: not while it is in a tab list (choosing a tab keeps
 * the focus on the tab, which already says where it went).
 */
export function mayMoveFocus(active: Element | null): boolean {
  if (!active || (typeof document !== "undefined" && active === document.body)) return true;
  return active.closest('[role="tablist"]') === null;
}

/** The first sentence of an error the page shows (an alert of severity error, or one marked data-page-error), if any. */
export function errorText(root: ParentNode): string | null {
  // An error alert, or a notice marked as standing for the page (a plot that is not there).
  const alert = visibleMatch(root, ".MuiAlert-standardError .MuiAlert-message, .MuiAlert-colorError .MuiAlert-message, [data-page-error] .MuiAlert-message");
  const text = (alert?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const first = text.split(/(?<=[.!?])\s/)[0];
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

function selectedTab(root: ParentNode): string | null {
  return visibleMatch(root, '[role="tab"][aria-selected="true"]')?.textContent ?? null;
}

/**
 * Sets the title for each path (and language) once the page shows its heading, and on a change of
 * path (not the first load) moves the focus to that heading. Returns the text to announce in a
 * polite live region when the page has no heading to focus.
 */
export function usePageFocus(
  path: string,
  { serverName, language, ownTitle, ownHeading, fallback }: { serverName: string; language: string; ownTitle: boolean; ownHeading: boolean; fallback: string | null },
): string {
  const shown = useRef<string | null>(null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    // Only a new path moves the focus: not the first load, nor a change of language or server name.
    const moved = shown.current !== null && shown.current !== path;
    shown.current = path;
    // The page's <main> as it is now: while a page's code loads, the one in the document is the
    // page before's (hidden), and the new page brings its own.
    const mainOf = () => visibleMatch<HTMLElement>(document, "main") ?? document.body;
    let done = false;
    const finish = (heading: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      const main = mainOf();
      const h1 = visibleMatch<HTMLElement>(main, "h1");
      const own = heading && heading !== h1 ? heading.textContent : null;
      // Without a heading, the error the page shows names it ("Not found – Our server").
      const context = visibleMatch(main, "[data-page-context]")?.textContent ?? null;
      const title = pageTitleOf({ own: own ?? (heading ? null : errorText(main)), fallback, tab: selectedTab(main), h1: h1?.textContent ?? null, context, server: serverName });
      if (!ownTitle) document.title = title || serverName;
      if (!moved) return;
      if (heading && mayMoveFocus(document.activeElement)) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
        setAnnounce("");
      } else if (!heading) {
        setAnnounce(title || serverName);
      }
    };
    const look = () => {
      const main = mainOf();
      const heading = pageHeading(main, ownHeading);
      if (heading && (heading.textContent ?? "").trim()) finish(heading);
      // A page that could not load shows an error instead of its heading: no need to wait for one.
      else if (!heading && errorText(main)) finish(null);
    };
    const observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setTimeout(() => finish(pageHeading(mainOf())), HEADING_WAIT_MS);
    look();
    return () => {
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [path, serverName, language, ownTitle, ownHeading, fallback]);
  return announce;
}
