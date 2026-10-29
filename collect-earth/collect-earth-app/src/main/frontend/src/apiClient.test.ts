import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "./apiClient";

// The tests run in node, which has no window: the client reads the page's origin from it
beforeEach(() => vi.stubGlobal("window", { location: { origin: "http://localhost:8028" } }));
afterEach(() => vi.unstubAllGlobals());

/** A fetch that answers every call with the response made by `make`, and records the calls. */
function respond(make: () => Response) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => make());
}

function answer(status: number, body: unknown) {
  return respond(() => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

/** The ApiError a call ends in, so that its code and status are checked and not only its message. */
async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("the call did not fail");
}

describe("apiClient", () => {
  it("sends the header the server requires", async () => {
    const fetchMock = answer(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);
    await apiGet("app");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Collect-Earth"]).toBe("1");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8028/earth/api/app");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("posts JSON and returns the answer", async () => {
    const fetchMock = answer(200, { path: "C:/a.csv" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiPost("files/choose", { mode: "OPEN" })).toEqual({ path: "C:/a.csv" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ mode: "OPEN" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["X-Collect-Earth"]).toBe("1");
  });

  it("posts an empty object when there is no body", async () => {
    const fetchMock = answer(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await apiPost("actions/quit");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe("{}");
  });

  it("turns an error answer into an ApiError", async () => {
    vi.stubGlobal("fetch", answer(400, { error: "operator.length", message: "Too short" }));
    await expect(apiPost("app/operator", {})).rejects.toEqual(new ApiError("operator.length", "Too short", 400));
    vi.stubGlobal("fetch", answer(400, { error: "operator.length", message: "Too short" }));
    const e = await failure(apiPost("app/operator", {}));
    expect(e.code).toBe("operator.length");
    expect(e.message).toBe("Too short");
    expect(e.status).toBe(400);
  });

  it("copes with the HTML error pages of Jetty", async () => {
    vi.stubGlobal("fetch", respond(() => new Response("<html><body><h2>HTTP ERROR 403 Forbidden</h2></body></html>",
      { status: 403, statusText: "Forbidden", headers: { "Content-Type": "text/html" } })));
    const e = await failure(apiGet("app"));
    expect(e.code).toBe("http.403");
    expect(e.message).toBe("Forbidden");
    expect(e.status).toBe(403);
  });

  it("has a message even when the error answer has neither a body nor a status text", async () => {
    vi.stubGlobal("fetch", respond(() => new Response(null, { status: 404 })));
    const e = await failure(apiGet("nothing"));
    expect(e.code).toBe("http.404");
    expect(e.message).toBe("HTTP 404");
    expect(e.status).toBe(404);
  });

  it("resolves to undefined on an empty answer", async () => {
    const fetchMock = respond(() => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiPut("app/operator", { operator: "Someone" })).toBeUndefined();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ operator: "Someone" }));
  });

  it("deletes", async () => {
    const fetchMock = respond(() => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiDelete("jobs/7")).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8028/earth/api/jobs/7");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("tells a server that is gone from an error of the API", async () => {
    vi.stubGlobal("fetch", respond(() => { throw new TypeError("Failed to fetch"); }));
    const e = await failure(apiGet("app"));
    expect(e.code).toBe("network");
    expect(e.status).toBe(0);
    expect(e.message).toBe("Failed to fetch");
  });
});
