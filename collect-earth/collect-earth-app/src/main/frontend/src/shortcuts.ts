// Keyboard shortcuts of the plots map and of the web form in its iframe (unit tested in shortcuts.test.ts).

/**
 * The keys of the plots map: "/" searches the list, "N" opens the next unfinished plot and "Esc" closes the form. The
 * form has the focus while a plot is open, so it passes them on to the plots map (see {@link panelKey}).
 */
const PANEL_KEYS = ["/", "n", "N", "Escape"] as const;
export type PanelKey = (typeof PANEL_KEYS)[number];

const isPanelKey = (key: unknown): key is PanelKey => PANEL_KEYS.includes(key as PanelKey);

/** What a key press is looked at for: a KeyboardEvent, or a test's stand-in. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
  target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

/** Inputs that take no typing: a key pressed on one is no text. */
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** Whether the key goes into something typed in (a text or number box, a dropdown's search), where the keys are the user's. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { type?: string }) | null;
  if (!element || typeof element.tagName !== "string") return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === "INPUT") return !NOT_TYPED.has(String(element.type ?? "text").toLowerCase());
  return tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The key of the plots map a key pressed in the form is, to be passed on to it; null for any other key, one with a
 * modifier, one pressed while typing, and one the form already acted on (an open dropdown closed by "Esc").
 */
export function panelKey(e: KeyPress): PanelKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || !isPanelKey(e.key)) return null;
  return isTyping(e.target) ? null : e.key;
}

/** The message by which the form passes a key on to the plots map, the same way it tells it a plot was saved. */
export interface KeyMessage { type: "ce:key"; plotId: string; key: PanelKey }

/** The key of a message from the form of the plot `activeId`, or null: another message, or one from a stale form. */
export function keyOfMessage(data: unknown, activeId: string | null): PanelKey | null {
  const message = data as Partial<KeyMessage> | null;
  if (!message || message.type !== "ce:key" || activeId == null || message.plotId !== activeId) return null;
  return isPanelKey(message.key) ? message.key : null;
}

/** Ctrl+Enter (Cmd+Enter on a Mac): submit the plot. */
export function isSubmitKey(e: Pick<KeyPress, "key" | "ctrlKey" | "metaKey">): boolean {
  return e.key === "Enter" && (e.ctrlKey || e.metaKey);
}

/**
 * Ctrl+Enter submits, and does nothing else: listened to before the focused control sees it (in the capture phase), as
 * an answer chip, like any button, takes Enter for a click even with Ctrl held, and would be unselected by it.
 */
export function submitOnKey(e: KeyPress, submit: () => void): boolean {
  if (!isSubmitKey(e)) return false;
  e.preventDefault();
  e.stopPropagation();
  submit();
  return true;
}
