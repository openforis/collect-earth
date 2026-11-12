// Which groups of a page hold changes not saved yet (the server page's settings groups): the page warns before the
// app moves elsewhere (router setLeaveGuard) and before the browser leaves it (beforeunload).
import { useEffect, useSyncExternalStore } from "react";

const dirty = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: readonly string[] = [];
const notify = () => {
  snapshot = [...dirty.values()];
  listeners.forEach((l) => l());
};

/** Marks group `id` (named `label` to the person) as holding changes not saved, or not. */
export function setUnsaved(id: string, label: string, unsaved: boolean): void {
  if (unsaved ? dirty.get(id) === label : !dirty.has(id)) return;
  if (unsaved) dirty.set(id, label);
  else dirty.delete(id);
  notify();
}

/** Forgets every group's changes (the person chose to leave without saving them). */
export function clearUnsaved(): void {
  if (dirty.size === 0) return;
  dirty.clear();
  notify();
}

/** The names of the groups holding changes not saved, in the order they were changed. */
export function unsavedGroups(): readonly string[] {
  return snapshot;
}

export function useUnsavedGroups(): readonly string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

/** A group's changes not saved, kept up to date while it is shown, and forgotten when it goes. */
export function useUnsaved(id: string, label: string, unsaved: boolean): void {
  useEffect(() => setUnsaved(id, label, unsaved), [id, label, unsaved]);
  useEffect(() => () => setUnsaved(id, label, false), [id, label]);
}
