// Waiting for the page to be visible: nothing is asked of the server while the page is
// hidden (another tab, a minimised window), and a wait that ends then is not lost.

/** What is used of `document`: its visibility and the event that says it changed. */
export interface VisiblePage {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Does `action` once, `delayMs` from now, when the page is visible then; when it is
 * hidden then, as soon as it is shown again. Returns a function that cancels it.
 */
export function onceVisibleAfter(delayMs: number, page: VisiblePage, action: () => void): () => void {
  let done = false;
  const onShown = () => {
    if (done || page.visibilityState === "hidden") return;
    finish();
    action();
  };
  const finish = () => {
    done = true;
    clearTimeout(timer);
    page.removeEventListener("visibilitychange", onShown);
  };
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    if (page.visibilityState !== "hidden") {
      finish();
      action();
    } else {
      page.addEventListener("visibilitychange", onShown);
    }
  }, delayMs);
  return finish;
}
