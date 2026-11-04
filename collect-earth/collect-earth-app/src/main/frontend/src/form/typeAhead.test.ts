import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceTarget } from "./model";
import { RETARGET_GUARD, TypeAhead, afterRender, endOfMove, isHeldKey } from "./typeAhead";

const press = (key: string, mods: { ctrlKey?: boolean; altKey?: boolean; repeat?: boolean } = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...mods });

describe("the end of a move of the focus", () => {
  const sub = { tab: 0, name: "sub" };
  const canopy = { tab: 0, name: "canopy" };
  it("presses the keys typed on the question the focus moved to, when the server's answer leads there too", () => {
    expect(endOfMove(canopy, canopy, true, true)).toBe("replay");
  });
  it("drops them when the answer hid that question", () => {
    expect(endOfMove(canopy, { tab: 1, name: "change" }, false, false)).toBe("retarget");
    expect(endOfMove(canopy, canopy, false, false)).toBe("retarget");
  });
  it("drops them, the focus going there instead, when the answer showed a question above it", () => {
    expect(endOfMove(canopy, sub, true, false)).toBe("retarget");
  });
  it("drops them when the step button the focus moved to is no longer it (Next, where Submit has come)", () => {
    expect(endOfMove({ tab: 0, name: null }, { tab: 0, name: null }, true, false)).toBe("retarget");
  });
});

describe("an answer whose reply shows a required question below it", () => {
  // Land use answered by key: before the reply, nothing is left to answer on the step, the focus goes to its button;
  // the reply shows the subdivision, required, below the land use
  const before = [{ tab: 0, questions: [{ name: "lu", byKey: true, needed: false }] }, { tab: 1, questions: [] }];
  const after = [{ tab: 0, questions: [{ name: "lu", byKey: true, needed: false }, { name: "sub", byKey: true, needed: true }] },
    { tab: 1, questions: [] }];
  it("moves the focus to the step button at once, then to the question the reply showed, the keys typed dropped", () => {
    const landed = advanceTarget(before, 0, "lu");
    expect(landed).toEqual({ tab: 0, name: null });
    const real = advanceTarget(after, 0, "lu");
    expect(real).toEqual({ tab: 0, name: "sub" });
    expect(endOfMove(landed, real, true, false)).toBe("retarget");
    const t = new TypeAhead();
    t.start();
    t.key({ key: "2", ctrlKey: false, metaKey: false, altKey: false, repeat: false }, 0, true);
    expect(t.end("retarget", 0)).toEqual([]);
  });
});

describe("the keys typed ahead", () => {
  it("are held in order, letters and digits alike, while the focus moves", () => {
    const t = new TypeAhead();
    t.start();
    expect(t.key(press("1"), 0, true)).toBe("hold");
    expect(t.key(press("n"), 0, true)).toBe("hold");
    expect(t.key(press("2"), 0, true)).toBe("hold");
    expect(t.moving).toBe(true);
    expect(t.end("replay", 10)).toEqual(["1", "n", "2"]);
    expect(t.moving).toBe(false);
  });
  it("let through those typed elsewhere, those with a modifier, and Tab", () => {
    const t = new TypeAhead();
    t.start();
    expect(t.key(press("1"), 0, false)).toBe("pass");
    expect(t.key(press("1", { ctrlKey: true }), 0, true)).toBe("pass");
    expect(t.key(press("Tab"), 0, true)).toBe("pass");
    expect(t.end("replay", 0)).toEqual([]);
  });
  it("are dropped when the move ends elsewhere, or is given up", () => {
    const t = new TypeAhead();
    t.start();
    t.key(press("1"), 0, true);
    expect(t.end("retarget", 0)).toEqual([]);
    t.start();
    t.key(press("2"), 0, true);
    expect(t.end("abandon", 0)).toEqual([]);
  });
  it("are dropped for a moment after the focus moved where it was not expected: numbers only", () => {
    const t = new TypeAhead();
    t.start();
    t.end("retarget", 1000);
    expect(t.key(press("1"), 1000 + RETARGET_GUARD - 1, true)).toBe("drop");
    expect(t.key(press("n"), 1000 + RETARGET_GUARD - 1, true)).toBe("pass");
    expect(t.key(press("1"), 1000 + RETARGET_GUARD, true)).toBe("pass");
  });
  it("keep those of a move that starts while one is on (a key held, pressed once it ended)", () => {
    const t = new TypeAhead();
    t.start();
    t.key(press("1"), 0, true);
    t.start();
    t.key(press("2"), 0, true);
    expect(t.end("replay", 0)).toEqual(["1", "2"]);
  });
  it("drop a key held down", () => {
    const t = new TypeAhead();
    t.start();
    expect(t.key(press("1", { repeat: true }), 0, true)).toBe("drop");
    expect(t.end("replay", 0)).toEqual([]);
  });
  it("are those that type or answer", () => {
    expect(isHeldKey(press("a"))).toBe(true);
    expect(isHeldKey(press(" "))).toBe(true);
    expect(isHeldKey(press("Enter"))).toBe(true);
    expect(isHeldKey(press("Escape"))).toBe(false);
    expect(isHeldKey(press("ArrowDown"))).toBe(false);
    expect(isHeldKey(press("1", { altKey: true }))).toBe(false);
  });
});

describe("afterRender", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("runs in the next task, without waiting for animation frames, which a window not in front hardly gets", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const run = vi.fn();
    afterRender(run);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
