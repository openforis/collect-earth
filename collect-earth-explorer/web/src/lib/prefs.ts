import { useCallback, useSyncExternalStore } from "react";

/** Viewer preferences kept in localStorage, shared live by every component that reads the same key. */

type Value = boolean | string;
const listeners = new Set<() => void>();
// Used only when storage throws (private mode, blocked site data), so a choice still lasts the session.
const memory = new Map<string, Value>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(key: string, initial: Value): Value {
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
  const value = useSyncExternalStore(subscribe, () => read(key, initial));
  const set = useCallback(
    (v: Value) => {
      memory.set(key, v);
      try {
        localStorage.setItem(key, String(v));
      } catch {
        // storage unavailable: the in-memory value stands in
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
