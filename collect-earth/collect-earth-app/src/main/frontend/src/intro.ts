// The introduction to the interface, for people new to Collect Earth 2 (and those who knew Collect Earth 1): what is
// shown, where and when. Three things, each shown once (the server remembers, AppInfoController):
//   - "changes": what changed from Collect Earth 1, a page for those who used it;
//   - the map of the screen: the controls of the plot list ("map.list") and of a plot's form ("map.form") labelled all
//     at once, with a single button to close it;
//   - tips ("tip.*"): one line beside a control the first time it matters, one at a time.
// Pure functions, so the rules are tested; the components (components/intro) measure and draw.
import type { MessageKey } from "./i18n";

/** What the server knows of the introduction here (GET /earth/api/app, `intro`). */
export interface IntroInfo {
  /** The ids of what was shown */
  seen: string[];
  /** The tips are on (Help > Show tips) */
  tips: boolean;
  /** Collect Earth was in use here before it had an introduction: someone who knew Collect Earth 1 */
  earlierUser: boolean;
}

export type IntroCard = "changes" | "map.list" | "map.form";
export type TipId = "tip.corrections" | "tip.training" | "tip.cloud" | "tip.filter" | "tip.keys" | "tip.dashboard";

/** What the page shows now, as far as the introduction needs it. */
export interface IntroContext {
  intro: IntroInfo | null | undefined;
  /** The page is the user's: the app bar shows, the name or the sign-in is given, nothing is open over it */
  ready: boolean;
  /** The pane in sight (App: one pane, the list or the form) */
  pane: "list" | "form";
  /** The plots of the list, and those completed */
  plots: number;
  saved: number;
  /** A cloud project */
  cloud: boolean;
  /** Plots a coordinator gave to correct, while the list is the user's own */
  toCorrect: number;
  /** The list is a training's */
  training: boolean;
  /** The plots opened since the page loaded */
  opened: number;
}

const has = (ctx: IntroContext, id: string) => ctx.intro?.seen.includes(id) ?? true;

/**
 * The card to show now, or null: what changed first (for those who knew Collect Earth 1), then the map of the pane in
 * sight. Nothing without a project's plots: there is nothing to point at.
 */
export function cardFor(ctx: IntroContext): IntroCard | null {
  if (!ctx.intro || !ctx.ready) return null;
  if (ctx.intro.earlierUser && !has(ctx, "changes")) return "changes";
  if (ctx.pane === "list") return ctx.plots > 0 && !has(ctx, "map.list") ? "map.list" : null;
  return has(ctx, "map.form") ? null : "map.form";
}

/** No tip sooner than this after the one before: they come one at a time, and not in a row. */
export const TIP_GAP_MILLIS = 60_000;
/** The keyboard tip comes with the third plot opened, the dashboard's once this many plots are completed. */
export const KEYS_AFTER_PLOTS = 3;
export const FILTER_AFTER_SAVED = 3;
export const DASHBOARD_AFTER_SAVED = 10;

/** A tip: the control it points at (the first selector found), and its text. */
export interface Tip { id: TipId; anchor: string; text: MessageKey; pane: "list" | "form" | "any"; when: (ctx: IntroContext) => boolean }

// In the order they are offered: what a coordinator asks first, then where the data goes, then the conveniences.
export const TIPS: readonly Tip[] = [
  { id: "tip.corrections", anchor: "[data-testid=corrections-open]", text: "tip.corrections", pane: "list", when: (c) => c.toCorrect > 0 },
  { id: "tip.training", anchor: "[data-testid=training-plots]", text: "tip.training", pane: "list", when: (c) => c.training },
  { id: "tip.cloud", anchor: "[data-testid=project-chip]", text: "tip.cloud", pane: "any", when: (c) => c.cloud },
  { id: "tip.filter", anchor: "[data-filter=pending]", text: "tip.filter", pane: "list", when: (c) => c.saved >= FILTER_AFTER_SAVED && c.saved < c.plots },
  { id: "tip.keys", anchor: "[data-testid=form-next]", text: "tip.keys", pane: "form", when: (c) => c.opened >= KEYS_AFTER_PLOTS },
  { id: "tip.dashboard", anchor: "#app-menu-button-all", text: "tip.dashboard", pane: "any", when: (c) => c.saved >= DASHBOARD_AFTER_SAVED },
];

/**
 * The tip to show now, or null: none while a card is due, while the tips are off, or within TIP_GAP_MILLIS of the last
 * one (`lastTipAt`, null for none yet).
 */
export function tipFor(ctx: IntroContext, now: number, lastTipAt: number | null): Tip | null {
  if (!ctx.intro || !ctx.ready || !ctx.intro.tips || cardFor(ctx) !== null) return null;
  if (lastTipAt !== null && now - lastTipAt < TIP_GAP_MILLIS) return null;
  return TIPS.find((tip) => !has(ctx, tip.id) && (tip.pane === "any" || tip.pane === ctx.pane) && tip.when(ctx)) ?? null;
}

/** The introduction with more shown. */
export function withSeen(intro: IntroInfo, ids: readonly string[]): IntroInfo {
  const added = ids.filter((id) => !intro.seen.includes(id));
  return added.length ? { ...intro, seen: [...intro.seen, ...added] } : intro;
}

/** The introduction with the tips switched: on again, they start over (as the server does). */
export function withTips(intro: IntroInfo, tips: boolean): IntroInfo {
  return { ...intro, tips, seen: tips && !intro.tips ? intro.seen.filter((id) => !id.startsWith("tip.")) : intro.seen };
}

// --- the map of the screen ------------------------------------------------------------------------------------------

/**
 * A control the map labels: its selectors (the box around all those found), in the page or, with `frame`, in the form
 * of the plot open (its iframe, of the same origin), and its line of the legend.
 */
export interface MapTarget { id: string; selectors: string[]; frame?: boolean; text: MessageKey }

export const LIST_MAP: readonly MapTarget[] = [
  { id: "menu", selectors: ["#app-menu-button-all"], text: "intro.list.menu" },
  { id: "chip", selectors: ["[data-testid=project-chip]"], text: "intro.list.chip" },
  { id: "settings", selectors: ["[data-testid=settings-button]"], text: "intro.list.settings" },
  { id: "quit", selectors: ["[data-testid=quit-button]"], text: "intro.list.quit" },
  { id: "find", selectors: [".MuiTextField-root:has(#plot-search)", "[data-filter=all]", "[data-filter=saved]"], text: "intro.list.find" },
  { id: "next", selectors: ["[data-testid=next-unfinished]"], text: "intro.list.next" },
  { id: "plot", selectors: ["[data-testid=plot-list] [role=option]"], text: "intro.list.plot" },
];

export const FORM_MAP: readonly MapTarget[] = [
  { id: "list", selectors: ["[data-testid=show-list]"], text: "intro.form.list" },
  // One arrow and the state alone: boxed with the other arrow and the count, they would be one box around the header
  { id: "arrows", selectors: ["[data-testid=form-next]"], text: "intro.form.arrows" },
  { id: "status", selectors: ["[data-testid=form-status]"], text: "intro.form.status" },
  { id: "imagery", selectors: ["[data-testid=imagery-bar] [role=group]"], text: "intro.form.imagery" },
  { id: "steps", selectors: ["[role=tablist]"], frame: true, text: "intro.form.steps" },
  { id: "saved", selectors: ["[data-testid=entry-save-state]"], frame: true, text: "intro.form.saved" },
  { id: "step", selectors: ["[data-testid=entry-next]", "[data-testid=entry-submit]"], frame: true, text: "intro.form.step" },
];

export interface Rect { left: number; top: number; width: number; height: number }

/** The box around some boxes; null for none. */
export function union(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** A box moved by where its frame is in the page. */
export function offset(rect: Rect, by: { left: number; top: number }): Rect {
  return { left: rect.left + by.left, top: rect.top + by.top, width: rect.width, height: rect.height };
}

/** The box drawn around a control: a little larger, and never beyond the page. */
export function spot(rect: Rect, viewport: { width: number; height: number }, pad = 4): Rect {
  const left = Math.max(2, rect.left - pad);
  const top = Math.max(2, rect.top - pad);
  const right = Math.min(viewport.width - 2, rect.left + rect.width + pad);
  const bottom = Math.min(viewport.height - 2, rect.top + rect.height + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** The size of a number's badge, and how far it overlaps its control's corner. */
export const BADGE = 22;

/** Where the number of a control goes: on its top left corner, inside the page; on a tall box (the list), inside it. */
export function badgeAt(box: Rect, viewport: { width: number; height: number }): { left: number; top: number } {
  const left = Math.min(Math.max(2, box.left - BADGE / 2), viewport.width - BADGE - 2);
  const top = Math.min(Math.max(2, box.top - BADGE / 2), viewport.height - BADGE - 2);
  return { left, top };
}

/**
 * Where the legend goes: in the tallest band of the page that no labelled control is in (below the list's controls,
 * between the top and the bottom of a form), as tall as it needs when the band allows, scrolling inside otherwise.
 */
export function legendBand(boxes: readonly Rect[], viewport: { width: number; height: number }, gap = 12): { top: number; height: number } {
  const edges = [...boxes].sort((a, b) => a.top - b.top);
  let best = { top: gap, height: 0 };
  let from = 0;
  const offer = (top: number, bottom: number) => {
    const height = bottom - top - 2 * gap;
    if (height > best.height) best = { top: top + gap, height };
  };
  for (const box of edges) {
    offer(from, box.top);
    from = Math.max(from, box.top + box.height);
  }
  offer(from, viewport.height);
  return best.height > 0 ? best : { top: gap, height: Math.max(0, viewport.height - 2 * gap) };
}
