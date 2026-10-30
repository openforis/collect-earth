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

/** Loads data when the page opens (and when deps change); the latest call wins. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], options: LoadOptions<T> = {}): Loaded<T> {
  const [data, setState] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  /** Local changes so far: a load compares the count at its start and at its end. */
  const changes = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const mergeRef = useRef(options.merge);
  mergeRef.current = options.merge;

  useEffect(() => {
    const call = ++latest.current;
    const changesAtStart = changes.current;
    setLoading(true);
    setError(null);
    loadRef.current().then(
      (result) => {
        if (call !== latest.current) return;
        const changedSince = changes.current !== changesAtStart;
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
    changes.current += 1;
    setState((prev) => (typeof next === "function" ? (prev === null ? prev : (next as (prev: T) => T)(prev)) : next));
  }, []);
  return { data, error, loading, reload, setData };
}
