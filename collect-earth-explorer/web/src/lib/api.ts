import type { Polygon } from "./urlParams";
import { t } from "./i18n";

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
}

export class ApiFailure extends Error {
  err: ApiError;
  status: number;
  constructor(err: ApiError, status: number) {
    super(err.message);
    this.name = "ApiFailure";
    this.err = err;
    this.status = status;
  }
}

export interface PlotBody {
  plot: Polygon;
  start: string;
  end: string;
}

function isApiError(v: unknown): v is ApiError {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.message === "string" && typeof o.retryable === "boolean";
}

/** The server's `{ error }` object when it has the ApiError shape, else undefined. */
function errorOf(body: unknown): ApiError | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const err = (body as { error?: unknown }).error;
  return isApiError(err) ? err : undefined;
}

const NOT_JSON = Symbol("not json");

/**
 * Prefix for API URLs. Empty in dev and tests, where `/api/...` is served same-origin (Vite proxy,
 * Hosting emulator rewrite, jsdom fetch mocks). `web/.env.production` sets `VITE_API_BASE` to the
 * function's own URL so production requests bypass Hosting's 60 s proxy limit; the Express app
 * mounts its routes under `/api`, so the final URL has that segment twice (`.../api/api/ccdc`).
 */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

let inFlight = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let onIdle: (() => void) | undefined;

/**
 * Calls `fn` once, when at most one API request has been in flight for 2 s after one settled: the page's own
 * requests are done but perhaps the slowest (CCDC can take over a minute, as long as a plot is looked at).
 * A later call replaces a pending `fn`.
 */
export function whenIdle(fn: () => void) {
  onIdle = fn;
}

export async function postApi<T>(
  path: string,
  body: PlotBody & Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  inFlight++;
  clearTimeout(idleTimer);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request<T>(path, body, signal);
      } catch (e) {
        if (attempt >= RETRY_DELAYS.length || !busy(e)) throw e;
        await wait(RETRY_DELAYS[attempt], signal);
      }
    }
  } finally {
    if (--inFlight <= 1 && onIdle) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const fn = onIdle;
        onIdle = undefined;
        fn?.();
      }, 2000);
    }
  }
}

/** Pauses before the automatic retries of a busy answer: at most three attempts in all. */
const RETRY_DELAYS = [2000, 5000];

/** A refusal for load (the server's or Cloud Run's 429, a 503) or no answer at all: likely to pass by itself. */
const busy = (e: unknown) => e instanceof ApiFailure && e.err.retryable && (e.status === 429 || e.status === 503 || e.err.code === "network");

/** Resolves after `ms`, or rejects with the abort reason (as fetch does) as soon as `signal` aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function request<T>(path: string, body: PlotBody & Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // No answer at all (offline, DNS, CORS); an abort stays an abort.
    if (signal?.aborted) throw e;
    throw new ApiFailure({ code: "network", message: (e as Error).message, retryable: true }, 0);
  }
  const parsed: unknown = await res.json().catch(() => NOT_JSON);
  if (!res.ok) {
    const err = errorOf(parsed) ?? {
      code: `http_${res.status}`,
      message: res.statusText || `HTTP ${res.status}`,
      // 429: Cloud Run's answer when every instance is busy (maxInstances), worth a retry.
      retryable: res.status >= 500 || res.status === 429,
    };
    throw new ApiFailure(err, res.status);
  }
  if (parsed === NOT_JSON) {
    throw new ApiFailure({ code: "bad_json", message: "The server returned an unreadable response", retryable: true }, res.status);
  }
  return parsed as T;
}

export interface TileResponse {
  tileUrl: string;
  label: string;
  dateRange?: { start: string; end: string };
  sensor?: string;
}

/**
 * Whether a failed request is worth offering a Retry for: an `ApiFailure` says so
 * itself; anything else (network error, unexpected exception) is assumed transient.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof ApiFailure ? error.err.retryable : true;
}

const ERROR_KEYS = { ee_busy: "err.ee_busy", rate_limited: "err.ee_busy", not_found: "err.not_found", bad_request: "err.bad_request", internal: "err.internal", bad_json: "err.bad_json", network: "err.network" } as const;

/**
 * A failed request in the page's language: the API's known codes (app.js errorToResponse, lib/errors.js) and the
 * client's own by their code, a bare HTTP failure by its status; another code keeps the server's (English) message.
 * A refused request keeps the server's detail, which says what was wrong.
 */
export function errorText(error: Error | undefined): string {
  if (!(error instanceof ApiFailure)) return error?.message ?? "";
  const { code, message } = error.err;
  if (Object.hasOwn(ERROR_KEYS, code)) return t(ERROR_KEYS[code as keyof typeof ERROR_KEYS], { detail: message });
  if (/^http_\d+$/.test(code)) return t("err.http", { status: error.status });
  return message;
}

/**
 * A tile response's English `label` in the page's language. The API's labels are shared by all languages (cached), so the
 * known forms are recognised here, keeping sensor names and dates; anything else (a scene: sensor and date) is shown as is.
 */
export function tileLabel(label: string): string {
  let m: RegExpMatchArray | null;
  if ((m = label.match(/^NDVI change: (.+?) → (.+)$/))) return t("tile.change", { left: tileLabel(m[1]), right: tileLabel(m[2]) });
  if ((m = label.match(/^Sentinel-2 composite (\S+) to (\S+)$/))) return t("tile.s2", { start: m[1], end: m[2] });
  if ((m = label.match(/^Sentinel-1 (\d{4}) radar composite$/))) return t("tile.s1", { year: m[1] });
  if ((m = label.match(/^(.+) (\d{4}) composite$/))) return t("tile.composite", { sensors: m[1], year: m[2] });
  return label;
}
