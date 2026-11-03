import { describe, expect, it, vi } from "vitest";
import { type KeyPress, isTyping, keyOfMessage, panelKey, submitOnKey } from "./shortcuts";

/** A stand-in for an element: what isTyping reads of one. */
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

describe("isTyping", () => {
  it("is typing in a text box, a number box, a text area and an editable element", () => {
    expect(isTyping(element("INPUT", { type: "text" }))).toBe(true);
    expect(isTyping(element("INPUT", { type: "number" }))).toBe(true);
    expect(isTyping(element("INPUT"))).toBe(true);
    expect(isTyping(element("TEXTAREA"))).toBe(true);
    expect(isTyping(element("DIV", { isContentEditable: true }))).toBe(true);
  });
  it("is not typing on a chip, a button, a check box or nothing", () => {
    expect(isTyping(chip)).toBe(false);
    expect(isTyping(element("BUTTON"))).toBe(false);
    expect(isTyping(element("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("panelKey", () => {
  it("passes on the keys of the plots map", () => {
    expect(panelKey(press("n"))).toBe("n");
    expect(panelKey(press("N"))).toBe("N");
    expect(panelKey(press("/"))).toBe("/");
    expect(panelKey(press("Escape"))).toBe("Escape");
  });
  it("keeps the keys typed in a text or number box", () => {
    expect(panelKey(press("n", element("INPUT", { type: "text" })))).toBeNull();
    expect(panelKey(press("/", element("INPUT", { type: "number" })))).toBeNull();
    expect(panelKey(press("Escape", element("TEXTAREA")))).toBeNull();
  });
  it("keeps other keys, keys with a modifier and keys the form acted on", () => {
    expect(panelKey(press("a"))).toBeNull();
    expect(panelKey(press("Enter"))).toBeNull();
    expect(panelKey(press("n", chip, { ctrlKey: true }))).toBeNull();
    expect(panelKey(press("n", chip, { altKey: true }))).toBeNull();
    expect(panelKey(press("Escape", chip, { defaultPrevented: true }))).toBeNull();
  });
});

describe("keyOfMessage", () => {
  it("reads the key passed on by the form of the plot open", () => {
    expect(keyOfMessage({ type: "ce:key", plotId: "7", key: "N" }, "7")).toBe("N");
  });
  it("ignores the form of another plot, other messages and other keys", () => {
    expect(keyOfMessage({ type: "ce:key", plotId: "6", key: "N" }, "7")).toBeNull();
    expect(keyOfMessage({ type: "ce:key", plotId: "7", key: "N" }, null)).toBeNull();
    expect(keyOfMessage({ type: "ce:saved", plotId: "7" }, "7")).toBeNull();
    expect(keyOfMessage({ type: "ce:key", plotId: "7", key: "x" }, "7")).toBeNull();
    expect(keyOfMessage(null, "7")).toBeNull();
    expect(keyOfMessage("ce:key", "7")).toBeNull();
  });
});
