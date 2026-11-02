import type { Polygon } from "./urlParams";

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

export async function postApi<T>(
  path: string,
  body: PlotBody & Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const parsed: unknown = await res.json().catch(() => NOT_JSON);
  if (!res.ok) {
    const err = errorOf(parsed) ?? {
      code: `http_${res.status}`,
      message: res.statusText || `HTTP ${res.status}`,
      retryable: res.status >= 500,
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
