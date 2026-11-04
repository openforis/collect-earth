/**
 * The dialogs of Google Earth Web's panel (panel.ts) over the whole of its page: in the panel's frame a dialog would be
 * squeezed into the panel's width. While one is open the page is asked to widen the frame to the whole window
 * (javascript_plots_map_panel.fmt), and this page keeps its layout meanwhile: the width and scale it had, a transparent
 * background beyond them, so that MUI's backdrop dims Google Earth Web around the dialog.
 */

/** The type of the messages to the page of the panel. */
export const PANEL_MESSAGE = "collectEarthPanel";

/**
 * Widen the frame to the whole window, or put it back; the panel asks for it (ask) once the page has loaded. The frame must have the color-scheme of this page, or Chrome
 * paints it opaque: Google Earth Web's page has none, this one the system's.
 */
export interface PanelMessage { type: typeof PANEL_MESSAGE; expand: boolean; colorScheme?: string }

/** Whether a message is the panel's asking what this page wants (javascript_plots_map_panel.fmt), from its page only. */
export function isPanelAsking(e: { source: unknown; data: unknown }, parent: unknown): boolean {
  const data = e.data as { type?: unknown; ask?: unknown } | null;
  return e.source === parent && data != null && data.type === PANEL_MESSAGE && data.ask === true;
}

export function panelMessage(expand: boolean, colorScheme?: string): PanelMessage {
  return colorScheme ? { type: PANEL_MESSAGE, expand, colorScheme } : { type: PANEL_MESSAGE, expand };
}

interface Classed { classList: { contains(name: string): boolean } }

/**
 * Whether a dialog shows: MUI renders each in a child of body (a portal) from its opening to the end of its exit
 * transition, and hides one kept mounted while closed. Menus, popovers and the drawer are no dialogs: they stay in the
 * panel.
 */
export function dialogShown(body: { children: ArrayLike<Classed> }): boolean {
  return Array.from(body.children).some((el) => el.classList.contains("MuiDialog-root") && !el.classList.contains("MuiModal-hidden"));
}

type Observe = (onMutation: () => void) => { observe(target: Node, options: MutationObserverInit): void; disconnect(): void };

/**
 * Calls onChange(true) once a dialog shows, onChange(false) once the last is gone: whatever opens it, so no dialog is
 * missed. A mutation observer calls back before the next paint, so the dialog is hardly seen narrow. It watches the
 * children of body coming and going, and their classes, which hide and show a dialog kept mounted.
 */
export function watchDialogs(body: HTMLElement, onChange: (shown: boolean) => void,
  observe: Observe = (f) => new MutationObserver(f)): () => void {
  let shown = dialogShown(body);
  if (shown) onChange(true);
  // Observing a node again only renews its options; a child gone is dropped by the observer with it
  const watchChildren = () => Array.from(body.children).forEach((child) => observer.observe(child, { attributes: true, attributeFilter: ["class"] }));
  const observer = observe(() => {
    watchChildren();
    const now = dialogShown(body);
    if (now === shown) return;
    shown = now;
    onChange(now);
  });
  observer.observe(body, { childList: true });
  watchChildren();
  return () => observer.disconnect();
}

/** The layout kept while the frame is wide: the width of the panel, and the scale it gave (uiScale.ts). */
export interface FrozenLayout { width: number; scale: number }

let frozen: FrozenLayout | null = null;
const listeners = new Set<() => void>();

export function frozenLayout(): FrozenLayout | null {
  return frozen;
}

export function subscribeFrozenLayout(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setFrozen(layout: FrozenLayout | null) {
  frozen = layout;
  listeners.forEach((l) => l());
}

/** How long the layout stays kept once the dialogs are gone, at most, waiting for the frame to be narrow again. */
const UNFREEZE_MILLIS = 1000;

/**
 * Widens the panel's frame while a dialog shows (see above), in the window of the panel; `scale` is the scale of the
 * page now. Returns the stop.
 */
export function expandForDialogs(win: Window, scale: () => number, observe?: Observe): () => void {
  const doc = win.document;
  const html = doc.documentElement;
  const root = doc.getElementById("root");
  let timer = 0;
  // Whether a dialog shows, and what the panel was last asked for
  let shown = false;
  let expanded = false;

  const post = (expand: boolean) => {
    expanded = expand;
    // Nothing in it but whether a dialog is open: any page may read it ("*"), the panel's checks where it comes from
    win.parent.postMessage(panelMessage(expand, win.getComputedStyle(html).colorScheme), "*");
  };
  // A page going with a dialog open (a reload, the language changed) gives the frame back: the next page would otherwise
  // be laid out wide over all of Google Earth Web until it has loaded
  const onPageHide = () => { if (expanded) post(false); };
  const onPageShow = (e: PageTransitionEvent) => { if (e.persisted && shown) post(true); };
  // The panel takes the frame back when the page has loaded, and then asks: a dialog shown before then asked too early
  const onMessage = (e: MessageEvent) => { if (isPanelAsking(e, win.parent)) post(shown); };
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  win.addEventListener("message", onMessage);
  const unfreeze = () => {
    win.clearTimeout(timer);
    win.removeEventListener("resize", onResize);
    if (!frozen) return;
    html.style.removeProperty("font-size");
    html.style.removeProperty("--mui-spacing");
    html.style.removeProperty("background");
    doc.body.style.removeProperty("background");
    root?.style.removeProperty("width");
    setFrozen(null);
  };
  // Once the dialogs are gone, the first resize is the panel taking the frame back, or the window resized: either way
  // the layout follows the frame from then on
  function onResize() {
    unfreeze();
  }

  const stop = watchDialogs(doc.body, (now) => {
    shown = now;
    if (now) {
      win.clearTimeout(timer);
      win.removeEventListener("resize", onResize);
      if (!frozen) {
        // The sizes of uiScale.ts, which follow the width of the window, as they are now: as inline styles they beat its
        const style = win.getComputedStyle(html);
        html.style.setProperty("font-size", style.fontSize);
        html.style.setProperty("--mui-spacing", style.getPropertyValue("--mui-spacing"));
        html.style.setProperty("background", "transparent");
        // The body's background is the canvas's, the whole frame's
        doc.body.style.setProperty("background", "transparent");
        root?.style.setProperty("width", win.innerWidth + "px");
        setFrozen({ width: win.innerWidth, scale: scale() });
      }
      post(true);
    } else {
      post(false);
      win.addEventListener("resize", onResize);
      // A page that never widened the frame (one injected by an older Collect Earth) sends no resize
      timer = win.setTimeout(unfreeze, UNFREEZE_MILLIS);
    }
  }, observe);
  return () => {
    stop();
    win.removeEventListener("pagehide", onPageHide);
    win.removeEventListener("pageshow", onPageShow);
    win.removeEventListener("message", onMessage);
    if (expanded) post(false);
    unfreeze();
  };
}
