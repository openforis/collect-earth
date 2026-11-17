import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { PlotProvider } from "../state/PlotContext";
import { useLayerTiles } from "../components/LayerSources";
import CcdcCard from "../components/charts/CcdcCard";
import LandsatNdviCard from "../components/charts/LandsatNdviCard";
import Sentinel2NdviCard from "../components/charts/Sentinel2NdviCard";
import ModisCard from "../components/charts/ModisCard";
import { resolveConfig, type ChartEntry } from "./config";
import { toPolygon, type PlotParams } from "./urlParams";
import { plotTiles, warm, warmRequests } from "./prewarm";

// The cards' bodies are captured before any chart draws; keep Plotly out of jsdom.
vi.mock("../components/Plot", () => ({ default: () => null }));

const next = toPolygon({ type: "Point", coordinates: [-88.75, 17.25] });
const params: PlotParams = { plot: next, start: "2000-01-01", end: "2026-11-01", plotId: "2" };
const CARDS: Record<string, ComponentType<{ params: ChartEntry["params"] }>> = {
  ccdc: CcdcCard,
  "landsat-series": LandsatNdviCard,
  "sentinel2-series": Sentinel2NdviCard,
  modis: ModisCard,
};
const config = (text?: object) => resolveConfig(text && JSON.stringify(text), 2026);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The path and body the page sends on first load of `params` with `cfg`, captured from the real cards and map hook. */
function bodiesOnOpen(cfg: ReturnType<typeof resolveConfig>) {
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => {}));
  function Map() {
    useLayerTiles(0);
    return null;
  }
  const { unmount } = render(
    <PlotProvider params={params} config={cfg}>
      {cfg.charts.map((c, i) => {
        const Card = CARDS[c.type];
        return <Card key={i} params={c.params} />;
      })}
      <Map />
    </PlotProvider>,
  );
  unmount();
  return fetchMock.mock.calls.map(([url, init]) => ({ path: (url as string).replace(/^\/api\//, ""), body: JSON.parse((init as RequestInit).body as string) }));
}

describe("warmRequests", () => {
  it("sends for the next plot exactly what the cards and the map send when that plot is opened, charts first", () => {
    for (const cfg of [
      config(),
      config({ v: 1, layers: [{ type: "landsat", bands: "true-colour" }], charts: [{ type: "ccdc", band: "NDVI" }, { type: "landsat-series", index: "NDMI" }, { type: "sentinel2-series", formula: " nir / red ", name: "x" }, { type: "modis", index: "EVI" }] }),
      config({ v: 1, layers: [{ type: "sentinel2", year: 2020, maxCloud: 30 }] }),
    ]) {
      const opened = bodiesOnOpen(cfg);
      // Through JSON, as the server sees it (undefined fields drop out).
      const warmed = JSON.parse(JSON.stringify(warmRequests(next, params, cfg)));
      expect(warmed).toEqual(opened);
      expect(warmed.at(-1).path).toMatch(/^tiles\//);
    }
  });

  it("skips collapsed charts", () => {
    const reqs = warmRequests(next, params, config({ v: 1, charts: [{ type: "ccdc", collapsed: true }, { type: "modis" }] }));
    expect(reqs.map((r) => r.path)).toEqual(["series/modis", "tiles/sentinel2"]);
  });

  it("the standard configuration warms four charts and one tile request", () => {
    expect(warmRequests(next, params, config()).map((r) => r.path)).toEqual(["ccdc", "series/landsat", "series/sentinel2", "series/modis", "tiles/sentinel2"]);
  });
});

describe("plotTiles", () => {
  it("covers a small plot at the map's opening zoom (16) with 256 px tiles one level deeper", () => {
    expect(plotTiles(next, 0, 0)).toEqual([[17, 33222, 59158], [17, 33223, 59158]]);
  });
  it("uses a lower zoom when the plot does not fit the pane at 16", () => {
    const big = { type: "Polygon" as const, coordinates: [[[-88.755, 17.245], [-88.745, 17.245], [-88.745, 17.255], [-88.755, 17.255], [-88.755, 17.245]]] };
    expect(new Set(plotTiles(big, 900, 700).map((t) => t[0]))).toEqual(new Set([16]));
  });
  it("is capped at 12 tiles", () => {
    const huge = { type: "Polygon" as const, coordinates: [[[-89, 17], [-88, 17], [-88, 18], [-89, 18], [-89, 17]]] };
    expect(plotTiles(huge, 0, 0)).toHaveLength(12);
  });
});

describe("warm", () => {
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

  it("sends one request at a time, then downloads the plot's tiles from the answer's template, swallowing errors", async () => {
    const pending: ((r: Response) => void)[] = [];
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("https://ee/")) return Promise.resolve(new Response("img"));
      return new Promise<Response>((resolve, reject) => pending.push(url.endsWith("ccdc") ? () => reject(new Error("down")) : resolve));
    });
    const done = warm(next, params, config(), 0, 0);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 4; i++) {
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      pending[i](json({}));
    }
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][0]).toBe("/api/tiles/sentinel2");
    pending[4](json({ tileUrl: "https://ee/maps/m/tiles/{z}/{x}/{y}", label: "x" }));
    await done;
    expect(fetchMock.mock.calls.slice(5).map((c) => c[0])).toEqual(["https://ee/maps/m/tiles/17/33222/59158", "https://ee/maps/m/tiles/17/33223/59158"]);
  });
});
