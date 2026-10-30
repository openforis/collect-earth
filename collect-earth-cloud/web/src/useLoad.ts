import { useCallback, useEffect, useRef, useState } from "react";

export interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /**
   * Replace the loaded data locally (after a successful change): the new data, or a
   * function of the data as it is then (so two changes close together both stay).
   */
  setData: (next: T | ((prev: T) => T)) => void;
}

export interface LoadOptions<T> {
  /**
   * For a load that started before a local change (setData) and ends after it: what to
   * show, from what was loaded and the data as changed here. Without it, the loaded data
   * is dropped and the local one kept (the next load brings the rest).
   */
  merge?: (fresh: T, prev: T) => T;
}

/**
 * What a finished load shows: what was loaded, unless the data was changed here after
 * the load started (it may have read the server before that change); then the local
 * data, or `merge` of both.
 */
export function landed<T>(fresh: T, prev: T | null, changedSince: boolean, merge?: (fresh: T, prev: T) => T): T {
  if (!changedSince || prev === null) return fresh;
  return merge ? merge(fresh, prev) : prev;
}

/**
 * The local changes (setData) counted for the loads: a load compares the count at its
 * start and at its end. When the deps change (another project...), the count starts
 * again: changes made to the data of before are not about what is loaded now. A reload
 * (same deps) keeps counting.
 */
export class LocalChanges {
  count = 0;
  private deps: readonly unknown[] | null = null;

  /** At a load's start: the count to compare with at its end. */
  start(deps: readonly unknown[]): number {
    if (this.deps === null || this.deps.length !== deps.length || this.deps.some((d, i) => !Object.is(d, deps[i]))) {
      this.deps = [...deps];
      this.count = 0;
    }
    return this.count;
  }

  change(): void {
    this.count += 1;
  }

  /** Whether the data was changed here since a load that started at `start`. */
  since(start: number): boolean {
    return this.count !== start;
  }
}

/** Loads data when the page opens (and when deps change); the latest call wins. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], options: LoadOptions<T> = {}): Loaded<T> {
  const [data, setState] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  /** Local changes so far: a load compares the count at its start and at its end. */
  const changes = useRef(new LocalChanges());
  const loadRef = useRef(load);
  loadRef.current = load;
  const mergeRef = useRef(options.merge);
  mergeRef.current = options.merge;

  useEffect(() => {
    const call = ++latest.current;
    const changesAtStart = changes.current.start(deps);
    setLoading(true);
    setError(null);
    loadRef.current().then(
      (result) => {
        if (call !== latest.current) return;
        const changedSince = changes.current.since(changesAtStart);
        setState((prev) => landed(result, prev, changedSince, mergeRef.current));
        setLoading(false);
      },
      (err: unknown) => {
        if (call !== latest.current) return;
        setError(err);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setData = useCallback((next: T | ((prev: T) => T)) => {
    changes.current.change();
    setState((prev) => (typeof next === "function" ? (prev === null ? prev : (next as (prev: T) => T)(prev)) : next));
  }, []);
  return { data, error, loading, reload, setData };
}
