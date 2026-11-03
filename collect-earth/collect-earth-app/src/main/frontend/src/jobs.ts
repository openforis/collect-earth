import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiDelete, apiGet } from "./apiClient";

/** A job of JobService, as GET /api/jobs/{id} answers it. */
export type JobState = "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

export interface JobInfo {
  id: string;
  kind: string;
  state: JobState;
  /** 0-100, or -1 while it cannot be known */
  progress: number;
  step: string | null;
  messages: string[];
  result: unknown;
  error: string | null;
}

/** How often a running job is read */
export const POLL_MILLIS = 500;

export const isOver = (job: JobInfo | null): boolean => job !== null && job.state !== "RUNNING";

/** The percent to draw, or null for a bar that only moves. */
export const progressOf = (job: JobInfo | null): number | null => (job && job.progress >= 0 ? Math.min(100, job.progress) : null);

/** The path a job's result names (an export's file), if it does. */
export function resultPath(result: unknown): string | null {
  if (result && typeof result === "object" && typeof (result as { path?: unknown }).path === "string") return (result as { path: string }).path;
  return null;
}

export const getJob = (id: string, signal?: AbortSignal) => apiGet<JobInfo>("jobs/" + encodeURIComponent(id), signal);

/** Asks the job to stop; a job over already (409 job.over) is no failure to cancel: it is over. */
export async function cancelJob(id: string): Promise<void> {
  try {
    await apiDelete("jobs/" + encodeURIComponent(id));
  } catch (e) {
    if (e instanceof ApiError && e.code === "job.over") return;
    throw e;
  }
}

/**
 * Reads the job until it is over, every `pollMillis`: each answer goes to onJob, and the reading stops by itself
 * once the job is over. A read that fails goes to onError and the reading goes on: the server may be busy. Returns
 * what stops it.
 */
export function followJob(id: string, get: (id: string, signal: AbortSignal) => Promise<JobInfo>, onJob: (job: JobInfo) => void,
  onError: (e: unknown) => void, pollMillis = POLL_MILLIS): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = () => {
    get(id, controller.signal).then(
      (job) => {
        if (controller.signal.aborted) return;
        onJob(job);
        if (!isOver(job)) timer = setTimeout(read, pollMillis);
      },
      (e) => {
        if (controller.signal.aborted) return;
        onError(e);
        // A job no longer there (404) will not come back: nothing more to read
        if (!(e instanceof ApiError && e.status === 404)) timer = setTimeout(read, pollMillis);
      });
  };
  read();
  return () => { controller.abort(); clearTimeout(timer); };
}

/** The job of this id, followed until it is over, and a way to cancel it. */
export function useJob(id: string | null): { job: JobInfo | null; error: string | null; cancelling: boolean; cancel: () => void } {
  const [job, setJob] = useState<JobInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    setJob(null);
    setError(null);
    setCancelling(false);
    if (!id) return;
    stop.current = followJob(id, getJob, setJob, (e) => setError(e instanceof Error ? e.message : String(e)));
    return () => stop.current?.();
  }, [id]);
  const cancel = useCallback(() => {
    if (!id) return;
    setCancelling(true);
    cancelJob(id).catch((e) => { setError(e instanceof Error ? e.message : String(e)); setCancelling(false); });
  }, [id]);
  return { job, error, cancelling, cancel };
}
