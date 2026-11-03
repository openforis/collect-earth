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
  /** held down: the key again, which must not open plot after plot */
  repeat?: boolean;
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
 * modifier, one held down, one pressed while typing, and one the form already acted on (an open dropdown closed by "Esc").
 */
export function panelKey(e: KeyPress): PanelKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented || !isPanelKey(e.key)) return null;
  return isTyping(e.target) ? null : e.key;
}

/**
 * Whether "Esc" leaves the box being typed in (blurs it), as on the plots map: a second "Esc" then closes the form. Not
 * when the box acted on it already (an open dropdown closed).
 */
export function escapeBlurs(e: KeyPress): boolean {
  return e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented && isTyping(e.target);
}

/**
 * Whether the form may take the focus when its plot opens: only if nothing else took it in the meantime in the plots
 * map's page (`active`, its focused element), the user typing in the plot search, say. The page's body, or the form's
 * own frame, is nothing else.
 */
export function mayTakeFocus(active: Element | null, frame: Element | null, body: Element | null): boolean {
  return active == null || active === body || (frame != null && active === frame);
}

/** Where the plots map finds the iframe of the form (FormPanel). */
const FORM_FRAME_SELECTOR = 'iframe[data-testid="form-frame"]';

/** Whether a message comes from the form open in the plots map: from its frame, and from this server. */
export function isFormMessage(e: { origin: string; source: unknown }, origin: string, formWindow: unknown): boolean {
  return e.origin === origin && formWindow != null && e.source === formWindow;
}

/** The window of the form open in the plots map, or null when there is none. */
export function formWindow(): Window | null {
  return document.querySelector<HTMLIFrameElement>(FORM_FRAME_SELECTOR)?.contentWindow ?? null;
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
