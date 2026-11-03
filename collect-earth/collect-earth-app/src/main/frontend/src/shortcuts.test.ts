import { describe, expect, it, vi } from "vitest";
import { type KeyPress, submitOnKey } from "./shortcuts";

/** A stand-in for an element. */
const element = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;
const chip = element("DIV", { role: "radio" });

function press(key: string, target: EventTarget | null = chip, mods: Partial<KeyPress> = {}): KeyPress {
  return { key, target, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...mods };
}

describe("submitOnKey", () => {
  it("submits on Ctrl+Enter and keeps the key from the focused chip, which would take it for a click", () => {
    const submit = vi.fn();
    const e = press("Enter", chip, { ctrlKey: true });
    expect(submitOnKey(e, submit)).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });
  it("submits on Cmd+Enter", () => {
    const submit = vi.fn();
    expect(submitOnKey(press("Enter", chip, { metaKey: true }), submit)).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });
  it("leaves Enter alone without Ctrl: the chip is chosen", () => {
    const submit = vi.fn();
    const e = press("Enter");
    expect(submitOnKey(e, submit)).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
