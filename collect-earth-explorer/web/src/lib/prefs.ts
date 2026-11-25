import { useCallback, useSyncExternalStore } from "react";

/**
 * Viewer preferences kept in localStorage, shared live by every component that reads the same key. In the editor's
 * preview (`preview=1`, same origin) only in memory, so it neither uses nor changes the person's remembered choices.
 */

type Value = boolean | string;
const listeners = new Set<() => void>();
// Used when storage throws (private mode, blocked site data), so a choice still lasts the session; alone in the preview.
const memory = new Map<string, Value>();
const preview = typeof location !== "undefined" && new URLSearchParams(location.search).get("preview") === "1";

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The stored value of `key`, else `initial` (whose type decides how it is read). */
export function readPref(key: string, initial: boolean): boolean;
export function readPref(key: string, initial: string): string;
export function readPref(key: string, initial: Value): Value;
export function readPref(key: string, initial: Value): Value {
  if (preview) return memory.get(key) ?? initial;
  try {
    const v = localStorage.getItem(key);
    if (v === null) return initial;
    return typeof initial === "boolean" ? v === "true" : v;
  } catch {
    return memory.get(key) ?? initial;
  }
}

/** A boolean or string preference; `initial` decides which. */
export function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void];
export function usePref(key: string, initial: string): [string, (v: string) => void];
// The setter's `never` only satisfies TypeScript's overload check; callers see the overloads above.
export function usePref(key: string, initial: Value): [Value, (v: never) => void] {
  const value = useSyncExternalStore(subscribe, () => readPref(key, initial));
  const set = useCallback((v: Value) => writePref(key, v), [key]);
  return [value, set];
}

/** Stores `v` under `key` and tells every `usePref` of it. */
export function writePref(key: string, v: Value) {
  memory.set(key, v);
  try {
    if (!preview) localStorage.setItem(key, String(v));
  } catch {
    // storage unavailable: the in-memory value stands in
  }
  listeners.forEach((l) => l());
}

/**
 * How many tab sessions have called this for `key`, this one included (Collect Earth keeps one tab per run and reloads
 * it per plot, so a session is a run). Counted once per session; Infinity in the preview or when storage throws.
 */
export function sessionNumber(key: string): number {
  if (preview) return Infinity;
  try {
    const seen = sessionStorage.getItem(key);
    if (seen !== null) return Number(seen);
    const n = (Number(localStorage.getItem(key)) || 0) + 1;
    localStorage.setItem(key, String(n));
    sessionStorage.setItem(key, String(n));
    return n;
  } catch {
    return Infinity;
  }
}

/** Makes `sessionNumber(key)` return Infinity for the rest of this tab session. */
export function endForSession(key: string) {
  try {
    if (!preview) sessionStorage.setItem(key, "Infinity");
  } catch {
    // storage unavailable: sessionNumber already returns Infinity
  }
}

/** A short hash of `value`'s JSON (FNV-1a), to key what is stored per configuration. */
export function hashOf(value: unknown): string {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify(value)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}
