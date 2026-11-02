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
  const json = await res
    .json()
    .catch(() => ({ error: { code: "bad_json", message: res.statusText, retryable: true } }));
  if (!res.ok) throw new ApiFailure(json.error, res.status);
  return json as T;
}

export interface TileResponse {
  tileUrl: string;
  label: string;
  dateRange?: { start: string; end: string };
  sensor?: string;
}
