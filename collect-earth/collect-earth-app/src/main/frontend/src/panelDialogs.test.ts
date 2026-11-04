import { afterEach, describe, expect, it, vi } from "vitest";
import { dialogShown, expandForDialogs, frozenLayout, isPanelAsking, panelMessage, watchDialogs } from "./panelDialogs";

/** An element of body with the classes given */
const el = (...classes: string[]) => ({ classList: { contains: (c: string) => classes.includes(c) } });

/** A mutation observer the test calls back by hand */
function fakeObserver() {
  const o = { callback: () => {}, observed: [] as { target: unknown; options: MutationObserverInit }[], disconnected: false };
  const observe = (f: () => void) => {
    o.callback = f;
    return { observe: (target: Node, options: MutationObserverInit) => { o.observed.push({ target, options }); }, disconnect: () => { o.disconnected = true; } };
  };
  return { o, observe };
}

describe("dialogShown", () => {
  it("is a MUI dialog among the children of body", () => {
    expect(dialogShown({ children: [el("root"), el("MuiDialog-root", "MuiModal-root")] })).toBe(true);
  });
  it("is not a menu, a popover, the drawer or a dialog kept mounted closed", () => {
    expect(dialogShown({ children: [el("MuiMenu-root", "MuiPopover-root", "MuiModal-root"), el("MuiDrawer-root", "MuiModal-root"),
      el("MuiDialog-root", "MuiModal-root", "MuiModal-hidden")] })).toBe(false);
    expect(dialogShown({ children: [] })).toBe(false);
  });
});

describe("watchDialogs", () => {
  it("tells when the first dialog shows and when the last is gone, not at every change", () => {
    const body = { children: [] as ReturnType<typeof el>[] };
    const { o, observe } = fakeObserver();
    const changes: boolean[] = [];
    const stop = watchDialogs(body as unknown as HTMLElement, (shown) => changes.push(shown), observe);
    expect(o.observed[0]).toEqual({ target: body, options: { childList: true } });
    o.callback();
    body.children.push(el("MuiDialog-root"));
    o.callback();
    body.children.push(el("MuiDialog-root"));
    o.callback();
    body.children.pop();
    o.callback();
    body.children.pop();
    o.callback();
    expect(changes).toEqual([true, false]);
    stop();
    expect(o.disconnected).toBe(true);
  });
  it("sees a dialog kept mounted shown and hidden, by the classes of the children of body", () => {
    const classes = ["MuiDialog-root", "MuiModal-hidden"];
    const dialog = { classList: { contains: (c: string) => classes.includes(c) } };
    const body = { children: [dialog] };
    const { o, observe } = fakeObserver();
    const changes: boolean[] = [];
    watchDialogs(body as unknown as HTMLElement, (shown) => changes.push(shown), observe);
    expect(o.observed).toContainEqual({ target: dialog, options: { attributes: true, attributeFilter: ["class"] } });
    classes.pop();
    o.callback();
    classes.push("MuiModal-hidden");
    o.callback();
    expect(changes).toEqual([true, false]);
  });
  it("tells at once of a dialog already open", () => {
    const changes: boolean[] = [];
    watchDialogs({ children: [el("MuiDialog-root")] } as unknown as HTMLElement, (shown) => changes.push(shown), fakeObserver().observe);
    expect(changes).toEqual([true]);
  });
});

describe("panelMessage", () => {
  it("says whether to widen the frame, with the color scheme of the page", () => {
    expect(panelMessage(true, "dark")).toEqual({ type: "collectEarthPanel", expand: true, colorScheme: "dark" });
    expect(panelMessage(false)).toEqual({ type: "collectEarthPanel", expand: false });
  });
});

describe("isPanelAsking", () => {
  const parent = {};
  it("is the panel's page asking", () => {
    expect(isPanelAsking({ source: parent, data: { type: "collectEarthPanel", ask: true } }, parent)).toBe(true);
  });
  it("is no other page, nor another message", () => {
    expect(isPanelAsking({ source: {}, data: { type: "collectEarthPanel", ask: true } }, parent)).toBe(false);
    expect(isPanelAsking({ source: parent, data: { type: "collectEarthPanel", expand: true } }, parent)).toBe(false);
    expect(isPanelAsking({ source: parent, data: null }, parent)).toBe(false);
  });
});

describe("expandForDialogs", () => {
  /** The window of the panel, 400 px wide, with a page of the panel above it */
  function panelWindow() {
    const style = () => {
      const props: Record<string, string> = {};
      return { props, setProperty: (k: string, v: string) => { props[k] = v; }, removeProperty: (k: string) => { delete props[k]; } };
    };
    const html = { style: style() };
    const body = { children: [] as ReturnType<typeof el>[], style: style() };
    const root = { style: style() };
    const listeners: Record<string, (() => void)[]> = {};
    const timers: (() => void)[] = [];
    const win = {
      innerWidth: 400,
      document: { documentElement: html, body, getElementById: (id: string) => (id === "root" ? root : null) },
      parent: { postMessage: vi.fn() },
      getComputedStyle: () => ({ fontSize: "14px", colorScheme: "dark", getPropertyValue: (k: string) => (k === "--mui-spacing" ? "7px" : "") }),
      addEventListener: (type: string, f: () => void) => { (listeners[type] ??= []).push(f); },
      removeEventListener: (type: string, f: () => void) => { listeners[type] = (listeners[type] ?? []).filter((g) => g !== f); },
      setTimeout: (f: () => void) => timers.push(f),
      clearTimeout: () => {},
      resize(width: number) { this.innerWidth = width; this.fire("resize"); },
      fire(type: string, event: object = {}) { (listeners[type] ?? []).slice().forEach((f) => (f as (e: object) => void)(event)); },
    };
    return { win, html, body, root, timers };
  }
  let stop = () => {};
  afterEach(() => stop());

  it("asks for the whole window while a dialog shows, keeping the layout of the panel", () => {
    const { win, html, body, root } = panelWindow();
    const { o, observe } = fakeObserver();
    stop = expandForDialogs(win as unknown as Window, () => 14 / 16, observe);
    expect(win.parent.postMessage).not.toHaveBeenCalled();

    body.children.push(el("MuiDialog-root"));
    o.callback();
    expect(win.parent.postMessage).toHaveBeenLastCalledWith({ type: "collectEarthPanel", expand: true, colorScheme: "dark" }, "*");
    expect(frozenLayout()).toEqual({ width: 400, scale: 14 / 16 });
    expect(root.style.props.width).toBe("400px");
    expect(html.style.props).toEqual({ "font-size": "14px", "--mui-spacing": "7px", background: "transparent" });
    expect(body.style.props.background).toBe("transparent");
    // Widened, the page keeps the panel's width and scale
    win.resize(1600);
    expect(frozenLayout()).toEqual({ width: 400, scale: 14 / 16 });

    body.children.pop();
    o.callback();
    expect(win.parent.postMessage).toHaveBeenLastCalledWith({ type: "collectEarthPanel", expand: false, colorScheme: "dark" }, "*");
    // Until the frame is narrow again
    expect(frozenLayout()).not.toBeNull();
    win.resize(400);
    expect(frozenLayout()).toBeNull();
    expect(root.style.props).toEqual({});
    expect(html.style.props).toEqual({});
    expect(body.style.props).toEqual({});
  });

  it("gives the layout back after a while when the frame never widened", () => {
    const { win, body, timers } = panelWindow();
    const { o, observe } = fakeObserver();
    stop = expandForDialogs(win as unknown as Window, () => 1, observe);
    body.children.push(el("MuiDialog-root"));
    o.callback();
    body.children.pop();
    o.callback();
    expect(frozenLayout()).not.toBeNull();
    timers.forEach((f) => f());
    expect(frozenLayout()).toBeNull();
  });

  it("keeps the layout of the panel through a dialog opened as another closes", () => {
    const { win, body } = panelWindow();
    const { o, observe } = fakeObserver();
    stop = expandForDialogs(win as unknown as Window, () => 1, observe);
    body.children.push(el("MuiDialog-root"));
    o.callback();
    win.resize(1600);
    body.children.pop();
    o.callback();
    body.children.push(el("MuiDialog-root"));
    o.callback();
    expect(frozenLayout()).toEqual({ width: 400, scale: 1 });
    expect(win.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ expand: true }), "*");
  });
});

describe("expandForDialogs, the page going or asked", () => {
  function setUp() {
    const listeners: Record<string, ((e: object) => void)[]> = {};
    const style = () => ({ setProperty: () => {}, removeProperty: () => {} });
    const body = { children: [] as ReturnType<typeof el>[], style: style() };
    const win = {
      innerWidth: 400,
      document: { documentElement: { style: style() }, body, getElementById: () => ({ style: style() }) },
      parent: { postMessage: vi.fn() },
      getComputedStyle: () => ({ fontSize: "14px", colorScheme: "light", getPropertyValue: () => "" }),
      addEventListener: (type: string, f: (e: object) => void) => { (listeners[type] ??= []).push(f); },
      removeEventListener: (type: string, f: (e: object) => void) => { listeners[type] = (listeners[type] ?? []).filter((g) => g !== f); },
      setTimeout: () => 0,
      clearTimeout: () => {},
      fire(type: string, event: object = {}) { (listeners[type] ?? []).slice().forEach((f) => f(event)); },
    };
    const { o, observe } = fakeObserver();
    const stop = expandForDialogs(win as unknown as Window, () => 1, observe);
    const open = () => { body.children.push(el("MuiDialog-root")); o.callback(); };
    const close = () => { body.children.pop(); o.callback(); };
    const posted = () => win.parent.postMessage.mock.calls.map((c) => (c[0] as { expand: boolean }).expand);
    return { win, stop, open, close, posted };
  }

  it("gives the frame back when the page goes with a dialog open (a reload), and only then", () => {
    const { win, stop, open, posted } = setUp();
    win.fire("pagehide");
    expect(posted()).toEqual([]);
    open();
    win.fire("pagehide");
    expect(posted()).toEqual([true, false]);
    // Back from the cache with its dialog
    win.fire("pageshow", { persisted: true });
    expect(posted()).toEqual([true, false, true]);
    stop();
  });

  it("gives the frame back when stopped with a dialog open", () => {
    const { stop, open, posted } = setUp();
    open();
    stop();
    expect(posted()).toEqual([true, false]);
    expect(frozenLayout()).toBeNull();
  });

  it("tells the panel again what it wants when the panel asks, from its page only", () => {
    const { win, stop, open, close, posted } = setUp();
    open();
    win.fire("message", { source: win.parent, data: { type: "collectEarthPanel", ask: true } });
    win.fire("message", { source: {}, data: { type: "collectEarthPanel", ask: true } });
    expect(posted()).toEqual([true, true]);
    close();
    win.fire("message", { source: win.parent, data: { type: "collectEarthPanel", ask: true } });
    expect(posted()).toEqual([true, true, false, false]);
    stop();
  });

  it("lets the layout follow the frame at the first resize once the dialogs are gone, wider too", () => {
    const { win, stop, open, close } = setUp();
    open();
    win.innerWidth = 1600;
    win.fire("resize");
    expect(frozenLayout()?.width).toBe(400);
    close();
    // The window was made wider meanwhile: the panel is wider too
    win.innerWidth = 480;
    win.fire("resize");
    expect(frozenLayout()).toBeNull();
    stop();
  });
});
