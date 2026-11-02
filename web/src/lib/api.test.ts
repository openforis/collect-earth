import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postApi, ApiFailure } from "./api";

const body = {
  plot: { type: "Polygon" as const, coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] },
  start: "2000-01-01",
  end: "2025-06-15",
};

const json = (data: unknown, status = 200, statusText = "") =>
  new Response(JSON.stringify(data), { status, statusText, headers: { "content-type": "application/json" } });
const text = (data: string, status = 200, statusText = "") => new Response(data, { status, statusText });

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiFailure);
    return e as ApiFailure;
  }
  throw new Error("expected postApi to reject");
}

describe("postApi", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the parsed body on success", async () => {
    fetchMock.mockResolvedValue(json({ tileUrl: "x" }));
    await expect(postApi("tiles/sentinel2", body)).resolves.toEqual({ tileUrl: "x" });
  });

  it("uses the server's error object when the body has the ApiError shape", async () => {
    const err = { code: "busy", message: "Earth Engine is busy", retryable: true };
    fetchMock.mockResolvedValue(json({ error: err }, 503));
    const f = await failure(postApi("tiles/sentinel2", body));
    expect(f.err).toEqual(err);
    expect(f.status).toBe(503);
    expect(f.message).toBe("Earth Engine is busy");
  });

  it("falls back to an http_<status> error when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(text("<html>Bad Gateway</html>", 502, "Bad Gateway"));
    const f = await failure(postApi("tiles/sentinel2", body));
    expect(f.err).toEqual({ code: "http_502", message: "Bad Gateway", retryable: true });
    expect(f.status).toBe(502);
  });

  it("falls back when the JSON error body has the wrong shape, and 4xx is not retryable", async () => {
    fetchMock.mockResolvedValue(json({ error: "nope" }, 404));
    const f = await failure(postApi("tiles/sentinel2", body));
    expect(f.err).toEqual({ code: "http_404", message: "HTTP 404", retryable: false });
    expect(f.message).toBe("HTTP 404");
  });

  it("throws bad_json when a 2xx response is not JSON", async () => {
    fetchMock.mockResolvedValue(text("not json", 200, "OK"));
    const f = await failure(postApi("tiles/sentinel2", body));
    expect(f.err.code).toBe("bad_json");
    expect(f.err.retryable).toBe(true);
    expect(f.status).toBe(200);
    expect(f.message).toBeTruthy();
  });
});
