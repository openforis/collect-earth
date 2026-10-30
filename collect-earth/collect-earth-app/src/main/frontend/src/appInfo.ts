import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "./apiClient";

/** What AppInfoController tells about the running Collect Earth (/api/app). */
export interface AppInfo {
  project: string | null;
  operator: string | null;
  language: string;
  viewer: string;
  plotsMap: boolean;
  version: string | null;
}

/** How long after a failed read of /api/app it is tried again: without it the bar, and Quit, would never show. */
export const APP_INFO_RETRY_MILLIS = 3000;

/**
 * Reads the app info until a read succeeds, trying again a while after each failure. Returns what stops it: the answer
 * of a read in flight is dropped, and no read is tried again.
 */
export function readAppInfo(get: (signal: AbortSignal) => Promise<AppInfo>, onInfo: (info: AppInfo) => void,
  retryMillis = APP_INFO_RETRY_MILLIS): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = () => {
    get(controller.signal).then(
      (info) => { if (!controller.signal.aborted) onInfo(info); },
      () => { if (!controller.signal.aborted) timer = setTimeout(read, retryMillis); });
  };
  read();
  return () => { controller.abort(); clearTimeout(timer); };
}

/** What the app bar shows (AppInfoController), and a way to read it again after a change. */
export function useAppInfo(): [AppInfo | null, () => void] {
  const [info, setInfo] = useState<AppInfo | null>(null);
  // Stops the read going on: a newer one replaces it, and the page going ends it
  const stop = useRef<(() => void) | null>(null);
  const reload = useCallback(() => {
    stop.current?.();
    stop.current = readAppInfo((signal) => apiGet<AppInfo>("app", signal), setInfo);
  }, []);
  useEffect(() => {
    reload();
    return () => stop.current?.();
  }, [reload]);
  return [info, reload];
}
