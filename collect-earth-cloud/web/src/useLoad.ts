import { useCallback, useEffect, useRef, useState } from "react";

export interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /** Replace the loaded data locally (after a successful change). */
  setData: (data: T) => void;
}

/** Loads data when the page opens (and when deps change); the latest call wins. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const call = ++latest.current;
    setLoading(true);
    setError(null);
    loadRef.current().then(
      (result) => {
        if (call !== latest.current) return;
        setData(result);
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
  return { data, error, loading, reload, setData };
}
