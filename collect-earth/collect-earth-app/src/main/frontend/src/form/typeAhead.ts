// The keys typed ahead while the form moves the focus on from an answer given from the keyboard (see answeredByKey in
// FormApp), kept apart from React so that what becomes of them is unit tested (typeAhead.test.ts).

import type { FocusTarget } from "./model";
import { type KeyPress, isTypeAheadKey } from "../shortcuts";

/** How long the number keys are ignored after the form moved the focus where the user did not expect it (ms) */
export const RETARGET_GUARD = 300;

/**
 * What becomes of the keys typed while the focus moved on, once the server answered the save with what is shown now:
 * pressed on the control the focus moved to ("replay") when that is still where the answer leads, else dropped, the
 * focus moving to where it does lead ("retarget"): a question the answer hid, or one it showed above, never gets a key
 * the user meant for another one.
 *
 * `landed`: where the focus moved at once, with what was known then; `real`: where it goes with the server's answer;
 * `landedShown`: the question it moved to is still shown; `sameControl`: `real` is the very control it moved to (not
 * Next where Submit has come since).
 */
export function endOfMove(landed: FocusTarget, real: FocusTarget, landedShown: boolean, sameControl: boolean): "replay" | "retarget" {
  if (!landedShown || landed.tab !== real.tab || landed.name !== real.name || !sameControl) return "retarget";
  return "replay";
}

/** A key kept while the focus moves: one that types or answers, with no modifier (Tab, Esc and the arrows go through) */
export function isHeldKey(e: Pick<KeyPress, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Delete";
}

/**
 * The keys held while the focus moves on, in the order typed, letters and digits alike; and, after the focus moved
 * where the user did not expect it, the number keys ignored for a moment (RETARGET_GUARD), which were meant for the
 * question it left.
 */
export class TypeAhead {
  private held: string[] | null = null;
  private guardUntil = -Infinity;

  /** A move is on: the keys pressed on it are held */
  get moving(): boolean {
    return this.held !== null;
  }

  /** A move starts; one that starts while another is on (a key held, pressed once it ended) keeps its keys */
  start(): void {
    this.held ??= [];
  }

  /** Keys held once more: those after one pressed at the end of a move that started the next one */
  hold(keys: string[]): void {
    this.held ??= [];
    this.held.push(...keys);
  }

  /**
   * A key pressed at `now` (ms): held for the end of the move, dropped, or let through. `onMove`: pressed on the controls
   * of the move (the answer given, the control the focus moved to, the page), not in a box elsewhere.
   */
  key(e: Pick<KeyPress, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat">, now: number, onMove: boolean): "hold" | "drop" | "pass" {
    if (this.held && onMove && isHeldKey(e)) {
      if (e.repeat) return "drop";
      this.held.push(e.key);
      return "hold";
    }
    if (now < this.guardUntil && isTypeAheadKey(e)) return "drop";
    return "pass";
  }

  /**
   * The move ends: the keys to press on the control the focus moved to, in order. None when it ends elsewhere
   * ("retarget", which guards the number keys a moment) or is given up ("abandon": the user clicked or moved the focus,
   * or the server did not answer).
   */
  end(how: "replay" | "retarget" | "abandon", now: number): string[] {
    const keys = this.held ?? [];
    this.held = null;
    if (how === "retarget") this.guardUntil = now + RETARGET_GUARD;
    return how === "replay" ? keys : [];
  }
}
