// Keyboard shortcuts of the plots map and of the web form in its iframe (unit tested in shortcuts.test.ts).

/**
 * The keys of the plots map: "/" searches the list, "N" opens the next unfinished plot and "Esc" closes the form; Alt+1,
 * Alt+2... show the imagery sources, in the order of their buttons (see {@link imageryKey}). The form has the focus while
 * a plot is open, so it passes them on to the plots map (see {@link panelKey}).
 */
const PANEL_KEYS = ["/", "n", "N", "Escape"] as const;
const IMAGERY_KEYS = ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8", "Alt+9"] as const;
export type ImageryKey = (typeof IMAGERY_KEYS)[number];
export type PanelKey = (typeof PANEL_KEYS)[number] | ImageryKey;

const isPanelKey = (key: unknown): key is PanelKey => PANEL_KEYS.includes(key as never) || IMAGERY_KEYS.includes(key as never);

/** What a key press is looked at for: a KeyboardEvent, or a test's stand-in. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  /** the key's place on the keyboard ("Digit1"), whatever it types with Alt held (Option+1 types "¡" on a Mac) */
  code?: string;
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
  const imagery = imageryKey(e);
  if (imagery) return imagery;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented || !isPanelKey(e.key)) return null;
  return isTyping(e.target) ? null : e.key;
}

/**
 * Alt+1 to Alt+9: the imagery source of that number, in the order of the buttons over the form (Google Earth Web, ESRI
 * Wayback, Earth Engine, Earth Map...). The digits of the main row only, by their place: Alt and the digits of the
 * numeric keypad type a character by its code on Windows. Not with AltGr (Ctrl+Alt), nor held down; and in a box typed
 * in, only when Alt and the digit type the digit itself, not a character of the layout (Option+2 types "@" on a Mac
 * with a Spanish or Portuguese layout).
 */
export function imageryKey(e: KeyPress): ImageryKey | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented) return null;
  const digit = /^Digit([1-9])$/.exec(e.code ?? "")?.[1];
  if (!digit || (isTyping(e.target) && e.key !== digit)) return null;
  return `Alt+${digit}` as ImageryKey;
}

/** The number of the imagery source a key shows (1 for the first), or null for another key */
export function imageryNumber(key: PanelKey): number | null {
  return key.startsWith("Alt+") ? Number(key.slice(4)) : null;
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
  return active == null || active === body || (frame != null && active === frame) || handsFocusOn(active);
}

/**
 * Marks the controls of the plots map that open a plot with a click (the arrows of the form's header, a plot of the list,
 * "Next unfinished plot"): focused by that click, they leave the focus to the form of the plot they opened, so its
 * questions are answered from the keyboard at once. Never a box typed in, the plot search.
 */
export const HANDS_FOCUS = "data-hands-focus";

function handsFocusOn(active: Element): boolean {
  const element = active as Element & { closest?: (selector: string) => Element | null };
  return typeof element.closest === "function" && element.closest(`[${HANDS_FOCUS}]`) != null && !isTyping(active);
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

/**
 * P, out of a box typed in: "Same as previous plot", the answers of the plot submitted before copied to the questions of
 * the step left empty. Not held down, nor with a modifier.
 */
export function isCopyKey(e: KeyPress): boolean {
  return (e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.defaultPrevented
    && !isTyping(e.target);
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

/**
 * What a key pressed on an answer of a choice question does, the question being one Tab stop (roving tabindex): the
 * arrows, Home and End move the focus from answer `current` of `count`, and 1 to 9 pick the n-th answer. Enter and Space
 * are the answer's own, as on any button. Null for any other key, one with a modifier (Alt+arrows change the step), and
 * a number held down or past the last answer.
 */
export function choiceKey(e: Pick<KeyPress, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat">, current: number,
  count: number): { focus: number } | { pick: number } | null {
  if (e.ctrlKey || e.metaKey || e.altKey || count <= 0) return null;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown": return { focus: (current + 1) % count };
    case "ArrowLeft":
    case "ArrowUp": return { focus: (current - 1 + count) % count };
    case "Home": return { focus: 0 };
    case "End": return { focus: count - 1 };
    default: {
      if (e.repeat || !/^[1-9]$/.test(e.key)) return null;
      const n = Number(e.key) - 1;
      return n < count ? { pick: n } : null;
    }
  }
}

/** The keys that move the focus from control to control: Tab, and the arrows, Home and End among the answers */
const FOCUS_KEYS = new Set(["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);
/** How soon after its key a focus counts as moved by it (ms) */
export const FOCUS_KEY_WINDOW = 500;

/** A key pressed, and when (ms, on the clock of `now` below) */
export interface PressedKey { key: string; at: number }

/**
 * Whether a focus that came at `now` was moved there by the user from the keyboard: a key that moves the focus was
 * pressed just before (`last`, the key pressed last). Not a focus the form gave itself, the question to answer when a
 * plot opens or the next once one was answered (Enter, a number): MUI shows a tooltip on any focus it takes for a
 * keyboard one, and the description of an answer covered the label of the next question.
 */
export function focusMovedByKey(last: PressedKey | null, now: number): boolean {
  return !!last && FOCUS_KEYS.has(last.key) && now - last.at >= 0 && now - last.at <= FOCUS_KEY_WINDOW;
}

/**
 * Whether a click on an answer came from the keyboard (Enter or Space on it, or a number key): the browser, and MUI for
 * the elements that are not buttons, click them with no mouse button pressed (detail 0).
 */
export function isKeyboardClick(e: { detail: number }): boolean {
  return e.detail === 0;
}

/**
 * Whether a key is one typed ahead while the form moves the focus on from an answer given from the keyboard: a number
 * key, which answers the next question once the focus is there. Kept until then, it is neither lost nor taken by the
 * answer just given, which it would change.
 */
export function isTypeAheadKey(e: Pick<KeyPress, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat">): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && /^[1-9]$/.test(e.key);
}

/**
 * Whether the focus may move on from an answer given from the keyboard (`from`, the control focused then), once its
 * save is answered: only if the form's page still has the focus (not the plots map around it, its search say), and
 * the focus is still on that control, or nowhere in the page (the control re-rendered). `stale`: the step changed, or
 * another answer was given, since.
 */
export function mayAdvance(pageFocused: boolean, active: Element | null, from: Element | null, body: Element | null,
  stale: boolean): boolean {
  return !stale && pageFocused && active != null && (active === from || active === body);
}
