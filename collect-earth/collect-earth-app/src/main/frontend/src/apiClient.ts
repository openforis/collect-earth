import { earthBase } from "./api";

/**
 * An answer of the API that is not a success: its code, and the message to show (ApiExceptionHandler). A server
 * that could not be reached at all (after Quit, or while it restarts) is the code "network" with status 0, so the
 * pages can tell it from a refusal of the API; a success whose body is not JSON is the code "parse".
 */
export class ApiError extends Error {
  /** @param body what the server answered, for the errors some answers carry beyond the message (settings.invalid) */
  constructor(readonly code: string, message: string, readonly status: number, readonly body?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
}

// Without it the server refuses the call (ApiHeaderFilter): a page of another site cannot send it
const HEADERS = { "X-Collect-Earth": "1" };

/** The JSON of an answer, `undefined` for an empty one, or NOT_JSON: the error pages of Jetty (403 of the filters, 404, 405) are HTML. */
const NOT_JSON = Symbol("not JSON");
function parse(text: string): any {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(earthBase() + "api/" + path, {
      method,
      headers: body === undefined ? HEADERS : { ...HEADERS, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // A call the page gave up on is not a server that is gone: the caller asked for it, and ignores it
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiError("network", e instanceof Error ? e.message : String(e), 0);
  }
  const data = parse(await r.text());
  if (!r.ok) {
    const json = data !== null && typeof data === "object" ? data : {};
    throw new ApiError(json.error ?? "http." + r.status, json.message ?? json.details ?? (r.statusText || "HTTP " + r.status), r.status, json);
  }
  if (data === NOT_JSON) throw new ApiError("parse", "The answer of " + path + " is not JSON", r.status);
  return data as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => call<T>("GET", path, undefined, signal);
export const apiPost = <T>(path: string, body?: unknown, signal?: AbortSignal) => call<T>("POST", path, body ?? {}, signal);
export const apiPut = <T>(path: string, body: unknown, signal?: AbortSignal) => call<T>("PUT", path, body, signal);
export const apiDelete = <T = void>(path: string, signal?: AbortSignal) => call<T>("DELETE", path, undefined, signal);
