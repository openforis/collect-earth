import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { PlotProvider, usePlot } from "../state/PlotContext";
import { viewKey } from "../state/view";
import { differenceBlocked, useDifferenceTiles, useLayerTiles } from "../components/LayerSources";
import { foldsKey, type CardProps } from "./folds";
import CcdcCard from "../components/charts/CcdcCard";
import LandsatNdviCard from "../components/charts/LandsatNdviCard";
import Sentinel2NdviCard from "../components/charts/Sentinel2NdviCard";
import HlsCard from "../components/charts/HlsCard";
import ModisCard from "../components/charts/ModisCard";
import Sentinel1Card from "../components/charts/Sentinel1Card";
import PrecipitationCard from "../components/charts/PrecipitationCard";
import { resolveConfig } from "./config";
import { toPolygon, type PlotParams } from "./urlParams";
import { plotTiles, warm, warmRequests } from "./prewarm";

// The cards' bodies are captured before any chart draws; keep Plotly out of jsdom.
vi.mock("../components/Plot", () => ({ default: () => null }));

const next = toPolygon({ type: "Point", coordinates: [-88.75, 17.25] });
const params: PlotParams = { plot: next, start: "2000-01-01", end: "2026-11-01", plotId: "2" };
const CARDS: Record<string, ComponentType<CardProps>> = {
  ccdc: CcdcCard,
  "landsat-series": LandsatNdviCard,
  "sentinel2-series": Sentinel2NdviCard,
  "hls-series": HlsCard,
  modis: ModisCard,
  "sentinel1-series": Sentinel1Card,
  precipitation: PrecipitationCard,
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
  // The map's requests as the Viewer (App.tsx) makes them: its layer, and when comparing the other side or the difference.
  function Map() {
    const p = usePlot();
    const showDifference = p.compare && p.difference && !differenceBlocked(p);
    useLayerTiles(p.activeLayer, { enabled: !showDifference });
    useDifferenceTiles({ enabled: showDifference });
    useLayerTiles(p.compareLayer, { enabled: p.compare && p.activeLayer !== p.compareLayer && !showDifference });
    return null;
  }
  const { unmount } = render(
    <PlotProvider params={params} config={cfg}>
      {cfg.charts.map((c, i) => {
        const Card = CARDS[c.type];
        return <Card key={i} params={c.params} index={i} />;
      })}
      <Map />
    </PlotProvider>,
  );
  unmount();
  return fetchMock.mock.calls.map(([url, init]) => ({ path: (url as string).replace(/^\/api\//, ""), body: JSON.parse((init as RequestInit).body as string) }));
}

describe("warmRequests", () => {
  // Through JSON, as the server sees it (undefined fields drop out), in any order.
  const sorted = (list: unknown[]) => list.map((r) => JSON.stringify(r)).sort();
  const same = (cfg: ReturnType<typeof resolveConfig>) => expect(sorted(JSON.parse(JSON.stringify(warmRequests(next, params, cfg))))).toEqual(sorted(bodiesOnOpen(cfg)));

  it("sends for the next plot exactly what the cards and the map send when that plot is opened, charts first", () => {
    for (const cfg of [
      config(),
      config({ v: 1, layers: [{ type: "landsat", bands: "true-colour" }], charts: [{ type: "ccdc", band: "NDVI" }, { type: "landsat-series", index: "NDMI" }, { type: "sentinel2-series", formula: " nir / red ", name: "x" }, { type: "modis", index: "EVI" }] }),
      config({ v: 1, layers: [{ type: "sentinel2", year: 2020, maxCloud: 30 }] }),
      config({ v: 1, charts: [{ type: "hls-series" }, { type: "hls-series", index: "NBR" }] }),
      config({ v: 1, layers: [{ type: "sentinel1", bands: "vh" }], charts: [{ type: "sentinel1-series" }, { type: "sentinel1-series", band: "VV" }, { type: "precipitation" }] }),
    ])
      same(cfg);
  });

  it("warms the remembered layer at its year and bands, and the compare layer", () => {
    const cfg = config();
    localStorage.setItem(viewKey(cfg.layers), JSON.stringify({ active: 1, years: { 1: 2015 }, bands: { 1: "true-colour" }, compare: true, compareLayer: 0 }));
    const tiles = warmRequests(next, params, cfg).filter((r) => r.path.startsWith("tiles/"));
    expect(tiles.map((r) => [r.path, r.body.year, r.body.bands])).toEqual([["tiles/landsat", 2015, "true-colour"], ["tiles/sentinel2", undefined, undefined]]);
    same(cfg);
  });

  it("warms the difference instead of the two sides when the remembered view shows it", () => {
    const cfg = config({ v: 1, layers: [{ type: "landsat" }, { type: "landsat", year: 2010 }] });
    localStorage.setItem(viewKey(cfg.layers), JSON.stringify({ active: 1, compare: true, compareLayer: 0, difference: true }));
    const tiles = warmRequests(next, params, cfg).filter((r) => r.path.startsWith("tiles/"));
    expect(tiles.map((r) => r.path)).toEqual(["tiles/difference"]);
    expect(tiles[0].body).toMatchObject({ left: { path: "tiles/landsat", year: 2010 }, right: { path: "tiles/landsat", year: 2025 } });
    same(cfg);
  });

  it("skips the charts the user folded and warms those the user unfolded", () => {
    const cfg = config();
    localStorage.setItem(foldsKey(cfg.charts), JSON.stringify({ "0:landsat-series": false, "5:precipitation": true }));
    expect(warmRequests(next, params, cfg).map((r) => r.path)).toEqual(["series/sentinel2", "series/modis", "series/precipitation", "tiles/sentinel2", "ccdc"]);
    same(cfg);
  });

  it("skips collapsed charts", () => {
    const reqs = warmRequests(next, params, config({ v: 1, charts: [{ type: "ccdc", collapsed: true }, { type: "modis" }] }));
    expect(reqs.map((r) => r.path)).toEqual(["series/modis", "tiles/sentinel2"]);
  });

  it("does not warm the MODIS rainfall overlay, which is off by default", () => {
    const reqs = warmRequests(next, params, config({ v: 1, charts: [{ type: "modis", rainfall: true }] }));
    expect(reqs.map((r) => r.path)).toEqual(["series/modis", "tiles/sentinel2"]);
  });

  it("the standard configuration warms four charts (not the collapsed Sentinel-1 and rainfall ones) and one tile request, the slow CCDC last", () => {
    expect(warmRequests(next, params, config()).map((r) => r.path)).toEqual(["series/landsat", "series/sentinel2", "series/modis", "tiles/sentinel2", "ccdc"]);
  });
});

describe("plotTiles", () => {
  it("covers a small plot and one tile around it at the map's opening zoom (16) with 256 px tiles one level deeper", () => {
    const tiles = plotTiles(next, 0, 0);
    expect(tiles).toHaveLength(12);
    expect(tiles).toEqual(expect.arrayContaining([[17, 33222, 59158], [17, 33223, 59158], [17, 33221, 59157], [17, 33224, 59159]]));
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
      // CCDC fails with a 404, which postApi does not retry by itself.
      return new Promise<Response>((resolve) => pending.push(url.endsWith("ccdc") ? () => resolve(new Response("{}", { status: 404 })) : resolve));
    });
    const done = warm(next, params, config(), 0, 0);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 3; i++) {
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      pending[i](json({}));
    }
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toBe("/api/tiles/sentinel2");
    pending[3](json({ tileUrl: "https://ee/maps/m/tiles/{z}/{x}/{y}", label: "x" }));
    await flush();
    await flush();
    // The tiles come before CCDC, which is asked last and fails here without consequence.
    expect(fetchMock.mock.calls.slice(4, 16).map((c) => c[0])).toContain("https://ee/maps/m/tiles/17/33222/59158");
    expect(fetchMock.mock.calls[16][0]).toBe("/api/ccdc");
    pending[4](json({}));
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(17);
  });
});
