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

/** What the app bar shows (AppInfoController), and a way to read it again after a change. */
export function useAppInfo(): [AppInfo | null, () => void] {
  const [info, setInfo] = useState<AppInfo | null>(null);
  // The read in flight: a newer one, or the page going, drops its answer, which is no longer the latest
  const pending = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    apiGet<AppInfo>("app", controller.signal)
      .then((i) => { if (!controller.signal.aborted) setInfo(i); })
      .catch(() => { /* the bar waits: the next reload tries again */ });
  }, []);
  useEffect(() => {
    reload();
    return () => pending.current?.abort();
  }, [reload]);
  return [info, reload];
}
