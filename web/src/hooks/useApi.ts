import { useCallback, useEffect, useRef, useState } from "react";

export type Status = "idle" | "loading" | "done" | "error";

export interface ApiState<T> {
  status: Status;
  data?: T;
  error?: Error;
  retry: () => void;
}

export interface ApiOptions {
  /**
   * When false the hook does not call `fn` at all: any request in flight is
   * aborted, `status` is "idle" and `error` is cleared, while the last `data` is
   * retained so re-enabling can keep showing it until the fresh request lands.
   * Turning it back on (or changing `deps` while it is on) runs `fn` as usual.
   * Defaults to true.
   */
  enabled?: boolean;
}

/**
 * Runs `fn` when `deps` change; exposes status and a retry. Aborts stale runs.
 * While reloading, the previous `data` is kept (so consumers can keep showing it)
 * and any previous `error` is cleared. See `ApiOptions.enabled` to pause it.
 */
export function useApi<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  { enabled = true }: ApiOptions = {},
): ApiState<T> {
  const [state, setState] = useState<{ status: Status; data?: T; error?: Error }>({ status: "idle" });
  const [tick, setTick] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  // The setState-in-effect and exhaustive-deps warnings are intentional here:
  // the effect synchronises with an external fetch, and `fn` is excluded from
  // deps because callers typically pass an inline closure (re-running on every
  // render would refetch endlessly). The caller-supplied `deps` plus the retry
  // tick define when to refetch.
  /* oxlint-disable react/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    ctrl.current?.abort();
    if (!enabled) {
      ctrl.current = null;
      setState((s) => (s.status === "idle" && !s.error ? s : { status: "idle", data: s.data }));
      return;
    }
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ status: "loading", data: s.data }));
    fn(c.signal).then(
      (data) => !c.signal.aborted && setState({ status: "done", data }),
      (error) => !c.signal.aborted && setState((s) => ({ status: "error", data: s.data, error })),
    );
    return () => c.abort();
  }, [...deps, tick, enabled]);
  /* oxlint-enable react/set-state-in-effect, react-hooks/exhaustive-deps */

  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, retry };
}
