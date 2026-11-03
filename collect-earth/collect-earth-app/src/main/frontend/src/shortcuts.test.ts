import { describe, expect, it, vi } from "vitest";
import {
  type KeyPress, FOCUS_KEY_WINDOW, choiceKey, escapeBlurs, focusMovedByKey, isFormMessage, isKeyboardClick, isTyping, keyOfMessage, mayAdvance, mayTakeFocus, panelKey,
  submitOnKey,
} from "./shortcuts";

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
    expect(panelKey(press("1"))).toBeNull();
    expect(panelKey(press("9"))).toBeNull();
    expect(panelKey(press("Enter"))).toBeNull();
    expect(panelKey(press("n", chip, { ctrlKey: true }))).toBeNull();
    expect(panelKey(press("n", chip, { altKey: true }))).toBeNull();
    expect(panelKey(press("Escape", chip, { defaultPrevented: true }))).toBeNull();
  });
  it("keeps a key held down, which would open plot after plot", () => {
    expect(panelKey(press("n", chip, { repeat: true }))).toBeNull();
    expect(panelKey(press("n", chip, { repeat: false }))).toBe("n");
  });
});

describe("escapeBlurs", () => {
  it("leaves a text, number or date box on Esc, a second Esc closing the form", () => {
    expect(escapeBlurs(press("Escape", element("INPUT", { type: "text" })))).toBe(true);
    expect(escapeBlurs(press("Escape", element("INPUT", { type: "date" })))).toBe(true);
    expect(escapeBlurs(press("Escape", element("TEXTAREA")))).toBe(true);
  });
  it("does nothing out of a box, for other keys, with a modifier, or when the box used the Esc", () => {
    expect(escapeBlurs(press("Escape", chip))).toBe(false);
    expect(escapeBlurs(press("n", element("INPUT")))).toBe(false);
    expect(escapeBlurs(press("Escape", element("INPUT"), { ctrlKey: true }))).toBe(false);
    expect(escapeBlurs(press("Escape", element("INPUT"), { defaultPrevented: true }))).toBe(false);
  });
});

describe("mayTakeFocus", () => {
  const body = { tag: "body" } as unknown as Element;
  const frame = { tag: "iframe" } as unknown as Element;
  const search = { tag: "input" } as unknown as Element;
  it("takes it when the plots map has nothing focused but its body or the form", () => {
    expect(mayTakeFocus(body, frame, body)).toBe(true);
    expect(mayTakeFocus(frame, frame, body)).toBe(true);
    expect(mayTakeFocus(null, frame, body)).toBe(true);
  });
  it("leaves it where the user put it since, as in the plot search", () => {
    expect(mayTakeFocus(search, frame, body)).toBe(false);
    expect(mayTakeFocus(search, null, body)).toBe(false);
  });
});

describe("isFormMessage", () => {
  const form = { name: "form" };
  it("takes messages from the open form's window, from this server", () => {
    expect(isFormMessage({ origin: "http://localhost:8028", source: form }, "http://localhost:8028", form)).toBe(true);
  });
  it("ignores another window, another origin, and any window when no form is open", () => {
    expect(isFormMessage({ origin: "http://localhost:8028", source: {} }, "http://localhost:8028", form)).toBe(false);
    expect(isFormMessage({ origin: "https://evil.example", source: form }, "http://localhost:8028", form)).toBe(false);
    expect(isFormMessage({ origin: "http://localhost:8028", source: null }, "http://localhost:8028", null)).toBe(false);
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

describe("choiceKey", () => {
  it("moves along the answers with the arrows, going round at both ends", () => {
    expect(choiceKey(press("ArrowRight"), 0, 3)).toEqual({ focus: 1 });
    expect(choiceKey(press("ArrowDown"), 2, 3)).toEqual({ focus: 0 });
    expect(choiceKey(press("ArrowLeft"), 0, 3)).toEqual({ focus: 2 });
    expect(choiceKey(press("ArrowUp"), 2, 3)).toEqual({ focus: 1 });
    expect(choiceKey(press("Home"), 2, 3)).toEqual({ focus: 0 });
    expect(choiceKey(press("End"), 0, 3)).toEqual({ focus: 2 });
  });
  it("picks the n-th answer with the number keys, of those there are", () => {
    expect(choiceKey(press("1"), 2, 3)).toEqual({ pick: 0 });
    expect(choiceKey(press("3"), 0, 3)).toEqual({ pick: 2 });
    expect(choiceKey(press("4"), 0, 3)).toBeNull();
    expect(choiceKey(press("9"), 0, 12)).toEqual({ pick: 8 });
    expect(choiceKey(press("0"), 0, 12)).toBeNull();
  });
  it("leaves Alt+arrows to the steps, Ctrl+Enter to Submit, and other keys alone", () => {
    expect(choiceKey(press("ArrowRight", chip, { altKey: true }), 0, 3)).toBeNull();
    expect(choiceKey(press("1", chip, { ctrlKey: true }), 0, 3)).toBeNull();
    expect(choiceKey(press("Enter", chip, { ctrlKey: true }), 0, 3)).toBeNull();
    expect(choiceKey(press("Enter"), 0, 3)).toBeNull();
    expect(choiceKey(press(" "), 0, 3)).toBeNull();
    expect(choiceKey(press("n"), 0, 3)).toBeNull();
    expect(choiceKey(press("Delete"), 0, 3)).toBeNull();
  });
  it("picks nothing with a number held down", () => {
    expect(choiceKey(press("2", chip, { repeat: true }), 0, 3)).toBeNull();
  });
});

describe("isKeyboardClick", () => {
  it("tells a click made by Enter or Space from one of the mouse", () => {
    expect(isKeyboardClick({ detail: 0 })).toBe(true);
    expect(isKeyboardClick({ detail: 1 })).toBe(false);
    expect(isKeyboardClick({ detail: 2 })).toBe(false);
  });
});

describe("mayAdvance", () => {
  const chosen = element("DIV") as unknown as Element;
  const other = element("INPUT") as unknown as Element;
  const body = element("BODY") as unknown as Element;
  it("moves on from the answer still focused, or from nowhere when it re-rendered", () => {
    expect(mayAdvance(true, chosen, chosen, body, false)).toBe(true);
    expect(mayAdvance(true, body, chosen, body, false)).toBe(true);
  });
  it("never pulls the focus back from the plots map around the form, its search say", () => {
    expect(mayAdvance(false, chosen, chosen, body, false)).toBe(false);
    expect(mayAdvance(false, body, chosen, body, false)).toBe(false);
  });
  it("never takes the focus from where the user put it, nor after the step changed or another answer", () => {
    expect(mayAdvance(true, other, chosen, body, false)).toBe(false);
    expect(mayAdvance(true, body, chosen, body, true)).toBe(false);
    expect(mayAdvance(true, chosen, chosen, body, true)).toBe(false);
  });
});

describe("focusMovedByKey", () => {
  it("takes a focus right after Tab, an arrow, Home or End as the user's", () => {
    for (const key of ["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
      expect(focusMovedByKey({ key, at: 1000 }, 1020)).toBe(true);
    }
  });

  it("does not take the focus the form gives itself for the user's", () => {
    // the plot opened, no key pressed yet
    expect(focusMovedByKey(null, 1000)).toBe(false);
    // an answer given with Enter, Space or a number: the form moves on to the next question
    expect(focusMovedByKey({ key: "Enter", at: 1000 }, 1020)).toBe(false);
    expect(focusMovedByKey({ key: " ", at: 1000 }, 1020)).toBe(false);
    expect(focusMovedByKey({ key: "2", at: 1000 }, 1020)).toBe(false);
  });

  it("does not take a focus long after the key for the user's", () => {
    // Tab pressed in the last plot, a new one opened since
    expect(focusMovedByKey({ key: "Tab", at: 1000 }, 1000 + FOCUS_KEY_WINDOW + 1)).toBe(false);
    expect(focusMovedByKey({ key: "Tab", at: 1000 }, 999)).toBe(false);
  });
});
