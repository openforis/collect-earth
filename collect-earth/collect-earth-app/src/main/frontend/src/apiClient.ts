/**
 * An answer of the API that is not a success: its code, and the message to show (ApiExceptionHandler). A server
 * that could not be reached at all (after Quit, or while it restarts) is the code "network" with status 0, so the
 * pages can tell it from a refusal of the API.
 */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

// Without it the server refuses the call (ApiHeaderFilter): a page of another site cannot send it
const HEADERS = { "X-Collect-Earth": "1" };

// The same base as HOST of api.ts, but read at each call: api.ts reads window when it is imported, which the
// tests (run in node, without a window) could not do for every module that uses the API
const apiBase = () => window.location.origin + "/earth/api/";

/** The JSON of an answer, or undefined: the error pages of Jetty (403 of the filters, 404, 405) are HTML. */
function parse(text: string): any {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(apiBase() + path, {
      method,
      headers: body === undefined ? HEADERS : { ...HEADERS, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError("network", e instanceof Error ? e.message : String(e), 0);
  }
  const data = parse(await r.text());
  if (!r.ok) {
    const json = data !== null && typeof data === "object" ? data : {};
    throw new ApiError(json.error ?? "http." + r.status, json.message ?? json.details ?? (r.statusText || "HTTP " + r.status), r.status);
  }
  return data as T;
}

export const apiGet = <T>(path: string) => call<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {});
export const apiPut = <T>(path: string, body: unknown) => call<T>("PUT", path, body);
export const apiDelete = <T = void>(path: string) => call<T>("DELETE", path);
