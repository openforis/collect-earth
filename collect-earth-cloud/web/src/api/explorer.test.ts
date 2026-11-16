import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORER_URL, getCatalogue } from "./explorer";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const catalogue = { v: 1, layers: {}, charts: {}, indices: {}, bands: {}, standard: { v: 1, layers: [], charts: [] } };

describe("the Explorer's catalogue", () => {
  it("is read from the Explorer, without credentials", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(catalogue), { status: 200 }));
    expect(await getCatalogue()).toEqual(catalogue);
    expect(EXPLORER_URL).toBe("https://explorer.collectearth.org");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://explorer.collectearth.org/api/catalogue");
    expect(init!.credentials).toBe("omit");
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails on an HTTP error or a body that is not a catalogue", async () => {
    fetchMock.mockResolvedValue(new Response("busy", { status: 503 }));
    await expect(getCatalogue()).rejects.toThrow("503");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ layers: {}, charts: {} }), { status: 200 }));
    await expect(getCatalogue()).rejects.toThrow("not a catalogue");
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(getCatalogue()).rejects.toThrow();
  });
});
