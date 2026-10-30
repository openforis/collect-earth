import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onceVisibleAfter, type VisiblePage } from "./visibility";

/** A page whose visibility the test sets. */
function page(state: "visible" | "hidden"): VisiblePage & { show(): void; hide(): void } {
  const events = new EventTarget();
  const p = {
    visibilityState: state as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => events.addEventListener(type, fn),
    removeEventListener: (type: string, fn: () => void) => events.removeEventListener(type, fn),
    show() {
      p.visibilityState = "visible";
      events.dispatchEvent(new Event("visibilitychange"));
    },
    hide() {
      p.visibilityState = "hidden";
      events.dispatchEvent(new Event("visibilitychange"));
    },
  };
  return p;
}

describe("doing something once the page is visible, after a wait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does it after the wait when the page is visible", () => {
    const action = vi.fn();
    onceVisibleAfter(10_000, page("visible"), action);
    vi.advanceTimersByTime(9_999);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("hidden when the wait ends: does it as soon as the page is shown again, once", () => {
    const action = vi.fn();
    const p = page("visible");
    onceVisibleAfter(10_000, p, action);
    p.hide();
    vi.advanceTimersByTime(60_000);
    expect(action).not.toHaveBeenCalled();
    p.show();
    expect(action).toHaveBeenCalledTimes(1);
    p.hide();
    p.show();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("shown again before the wait ends: still waits", () => {
    const action = vi.fn();
    const p = page("hidden");
    onceVisibleAfter(10_000, p, action);
    p.show();
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("cancelled: never does it", () => {
    const action = vi.fn();
    const p = page("hidden");
    const cancel = onceVisibleAfter(10_000, p, action);
    vi.advanceTimersByTime(10_000);
    cancel();
    p.show();
    vi.advanceTimersByTime(10_000);
    expect(action).not.toHaveBeenCalled();
  });
});
