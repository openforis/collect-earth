// Keyboard shortcuts of the plots map and of the web form in its iframe (unit tested in shortcuts.test.ts).

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
