import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postApi, ApiFailure, errorText, isRetryable, tileLabel, whenIdle } from "./api";
import { t } from "./i18n";

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
    fetchMock.mockResolvedValue(json({ error: err }, 500));
    const f = await failure(postApi("tiles/sentinel2", body));
    expect(f.err).toEqual(err);
    expect(f.status).toBe(500);
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

  it("keeps an abort as an abort", async () => {
    const c = new AbortController();
    c.abort();
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(postApi("tiles/sentinel2", body, c.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postApi's automatic retry of a busy answer", () => {
  const fetchMock = vi.fn();
  const busy = () => json({ error: { code: "ee_busy", message: "Computation timed out.", retryable: true } }, 503);
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("succeeds on the second attempt, 2 s after a 503", async () => {
    fetchMock.mockResolvedValueOnce(busy()).mockResolvedValueOnce(json({ tileUrl: "x" }));
    const p = postApi("tiles/sentinel2", body);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ tileUrl: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the third attempt (2 s, then 5 s) on Cloud Run's 429, the server's rate_limited and no answer", async () => {
    for (const answer of [
      () => Promise.resolve(text("Rate exceeded.", 429, "Too Many Requests")),
      () => Promise.resolve(json({ error: { code: "rate_limited", message: "too many", retryable: true } }, 429)),
      () => Promise.reject(new TypeError("Failed to fetch")),
    ]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(answer);
      const p = failure(postApi("tiles/sentinel2", body));
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      const f = await p;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(f.err.retryable).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(text("Rate exceeded.", 429, "Too Many Requests"));
    const p = failure(postApi("tiles/sentinel2", body));
    await vi.advanceTimersByTimeAsync(7000);
    expect((await p).err).toEqual({ code: "http_429", message: "Too Many Requests", retryable: true });
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const n = failure(postApi("tiles/sentinel2", body));
    await vi.advanceTimersByTimeAsync(7000);
    expect((await n).err).toEqual({ code: "network", message: "Failed to fetch", retryable: true });
  });

  it("does not retry a 400, a 404 or another 5xx", async () => {
    for (const res of [
      () => json({ error: { code: "bad_request", message: "no", retryable: false } }, 400),
      () => json({ error: { code: "not_found", message: "none", retryable: false } }, 404),
      () => json({ error: { code: "internal", message: "Internal error", retryable: false } }, 500),
      () => text("Bad Gateway", 502, "Bad Gateway"),
    ]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(() => Promise.resolve(res()));
      await failure(postApi("tiles/sentinel2", body));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("an abort during the wait rejects at once as an abort and sends nothing more", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(busy()));
    const c = new AbortController();
    const p = postApi("tiles/sentinel2", body, c.signal).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    c.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toHaveProperty("name", "AbortError");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a request waiting to retry counts once as in flight for whenIdle", async () => {
    const slow: ((r: Response) => void)[] = [];
    fetchMock
      .mockImplementationOnce(() => new Promise((r) => slow.push(r)))
      .mockImplementationOnce(() => Promise.resolve(busy()))
      .mockImplementationOnce(() => Promise.resolve(json({})));
    const fn = vi.fn();
    whenIdle(fn);
    const s = postApi("ccdc", body);
    const b = postApi("tiles/sentinel2", body);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).not.toHaveBeenCalled(); // the busy one waits, still in flight
    await vi.advanceTimersByTimeAsync(1);
    await b;
    await vi.advanceTimersByTimeAsync(2000); // only the slow one is left
    expect(fn).toHaveBeenCalledTimes(1);
    slow[0](json({}));
    await s;
  });
});

describe("errorText", () => {
  const fail = (code: string, message: string, status = 500) => new ApiFailure({ code, message, retryable: false }, status);
  it("translates the known codes, keeping a refused request's detail", () => {
    expect(errorText(fail("ee_busy", "Earth Engine memory exceeded", 503))).toBe(t("err.ee_busy"));
    expect(errorText(fail("rate_limited", "too many computations from this address", 429))).toBe(t("err.ee_busy"));
    expect(errorText(fail("not_found", "no Landsat scenes for 2012", 404))).toBe(t("err.not_found"));
    expect(errorText(fail("internal", "Internal error"))).toBe(t("err.internal"));
    expect(errorText(fail("bad_request", "plot is 120.0 ha; maximum is 100 ha", 400))).toBe("The request was refused: plot is 120.0 ha; maximum is 100 ha");
    expect(errorText(fail("network", "Failed to fetch", 0))).toBe(t("err.network"));
    expect(errorText(fail("http_502", "Bad Gateway", 502))).toBe("The server did not answer (HTTP 502).");
  });
  it("keeps the server's message for an unknown code, and a plain error's message", () => {
    expect(errorText(fail("quota", "Quota exceeded"))).toBe("Quota exceeded");
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText(undefined)).toBe("");
  });
});

describe("tileLabel", () => {
  it("shows the API's English labels in the page's language, keeping sensors and dates", () => {
    expect(tileLabel("Sentinel-2 composite 2025-11-19 to 2026-11-19")).toBe("Sentinel-2 composite 2025-11-19 to 2026-11-19");
    expect(tileLabel("Landsat 2025 composite")).toBe("Landsat 2025 composite");
  });
  it("recognises every label form (in Spanish)", async () => {
    vi.resetModules();
    vi.doMock("./i18n", async (orig) => {
      const m = await orig<typeof import("./i18n")>();
      return { ...m, t: (k: Parameters<typeof m.t>[0], p?: Record<string, string | number>) => m.t(k, p, "es") };
    });
    const { tileLabel: es } = await import("./api");
    vi.doUnmock("./i18n");
    expect(es("Sentinel-2 composite 2025-11-19 to 2026-11-19")).toBe("Composición Sentinel-2 del 2025-11-19 al 2026-11-19");
    expect(es("Landsat 8/Landsat 9 2025 composite")).toBe("Composición Landsat 8/Landsat 9 2025");
    expect(es("Sentinel-1 2025 radar composite")).toBe("Composición de radar Sentinel-1 2025");
    expect(es("NDVI change: Landsat 7 2010 composite → Landsat 2024-03-01")).toBe("Cambio de NDVI: Composición Landsat 7 2010 → Landsat 2024-03-01");
    // A scene label (sensor and date) and anything unknown are shown as they come.
    expect(es("Sentinel-2 2024-05-02")).toBe("Sentinel-2 2024-05-02");
    expect(es("Something new")).toBe("Something new");
  });
});

describe("isRetryable", () => {
  it("follows the ApiFailure's retryable flag", () => {
    expect(isRetryable(new ApiFailure({ code: "busy", message: "busy", retryable: true }, 503))).toBe(true);
    expect(isRetryable(new ApiFailure({ code: "bad", message: "bad", retryable: false }, 400))).toBe(false);
  });
  it("treats any other error as retryable", () => {
    expect(isRetryable(new Error("network"))).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
  });
});

describe("API_BASE", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is empty and postApi uses the relative /api path when VITE_API_BASE is not set", async () => {
    vi.stubEnv("VITE_API_BASE", "");
    const mod = await import("./api");
    expect(mod.API_BASE).toBe("");
    await mod.postApi("ccdc", body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ccdc");
  });

  it("prefixes the path with VITE_API_BASE when set", async () => {
    vi.stubEnv("VITE_API_BASE", "https://x/api");
    const mod = await import("./api");
    expect(mod.API_BASE).toBe("https://x/api");
    await mod.postApi("ccdc", body);
    expect(fetchMock.mock.calls[0][0]).toBe("https://x/api/api/ccdc");
  });

  it("strips one trailing slash from VITE_API_BASE", async () => {
    vi.stubEnv("VITE_API_BASE", "https://x/api/");
    const mod = await import("./api");
    expect(mod.API_BASE).toBe("https://x/api");
    await mod.postApi("tiles/sentinel2", body);
    expect(fetchMock.mock.calls[0][0]).toBe("https://x/api/api/tiles/sentinel2");
  });
});

describe("whenIdle", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("calls back once, 2 s after all but one API request settled; a request in that pause restarts the wait", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const fn = vi.fn();
    whenIdle(fn);
    const a = postApi("a", body), b = postApi("b", body), slow = postApi("slow", body);
    resolvers[0](json({}));
    await a;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).not.toHaveBeenCalled(); // b and the slow one still in flight
    resolvers[1](json({}));
    await b;
    await vi.advanceTimersByTimeAsync(1500);
    const c = postApi("c", body); // another request of the current plot: wait again
    await vi.advanceTimersByTimeAsync(1000);
    resolvers[3](json({}, 500));
    await c.catch(() => {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); // only the slow one is left
    expect(fn).toHaveBeenCalledTimes(1);
    resolvers[2](json({}));
    await slow;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
