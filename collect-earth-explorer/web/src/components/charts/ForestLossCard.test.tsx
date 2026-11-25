import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Data, PlotMouseEvent } from "plotly.js";
import { PlotProvider, usePlot } from "../../state/PlotContext";
import { resolveConfig } from "../../lib/config";
import * as csv from "../../lib/csv";
import type { ForestLoss } from "../../lib/forestLoss";
import ForestLossCard from "./ForestLossCard";

interface Captured { data: Data[]; onClick?: (e: Partial<PlotMouseEvent>) => void }
const captured: Captured[] = [];
vi.mock("../Plot", () => ({
  default: (props: Captured) => {
    captured.push(props);
    return <div data-testid="plot" onClick={() => props.onClick?.({ points: [{ curveNumber: 0, x: "2024-07-01T00:00:00.000Z" }] } as never)} />;
  },
}));

const params = {
  plot: { type: "Polygon" as const, coordinates: [[[-63.08, -10.076], [-63.071, -10.076], [-63.071, -10.067], [-63.08, -10.067], [-63.08, -10.076]]] },
  start: "2000-01-01",
  end: "2026-11-25",
  plotId: "demo",
};
const ANSWER: ForestLoss = {
  plotHa: 98.6,
  treeCover2000: 80,
  hansen: [{ year: 2009, ha: 0.08 }, { year: 2024, ha: 41.5 }],
  alerts: [
    { date: Date.UTC(2024, 7, 20), ha: 0.2, source: "RADD", confirmed: false },
    { date: Date.UTC(2024, 7, 31), ha: 0.5, source: "RADD", confirmed: true },
    { date: Date.UTC(2025, 2, 1), ha: 2, source: "GLAD", confirmed: true },
  ],
  coverage: { radd: true, glad: false },
};
const fetchMock = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function Compare() {
  const p = usePlot();
  return <span data-testid="compare">{p.compare ? `${p.compareYear}` : ""}</span>;
}

function setup(over: Record<string, unknown> = {}) {
  const config = resolveConfig(JSON.stringify({ v: 1, charts: [{ type: "forest-loss", ...over }] }), 2026);
  render(
    <PlotProvider params={params} config={config}>
      <ForestLossCard params={config.charts[0].params} />
      <Compare />
    </PlotProvider>,
  );
}

describe("ForestLossCard", () => {
  beforeEach(() => {
    captured.length = 0;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json(ANSWER));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts the plot to series/forest-loss, draws Hansen and each source's confirmed and unconfirmed bars, and states the facts", async () => {
    setup();
    await screen.findByTestId("plot");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/series/forest-loss");
    const names = captured.at(-1)!.data.map((d) => d.name);
    expect(names).toEqual(["Hansen yearly loss", "RADD confirmed", "RADD unconfirmed", "GLAD confirmed"]);
    expect(screen.getByText("Tree cover in 2000: 80 %. Loss: 41.6 ha, 42 % of the plot. GLAD alerts do not cover this plot.")).toBeTruthy();
  });

  it("shows only the entry's years, in the title too, and downloads them as CSV", async () => {
    const download = vi.spyOn(csv, "downloadText").mockImplementation(() => {});
    setup({ startYear: 2010, endYear: 2024 });
    await screen.findByTestId("plot");
    expect(screen.getByRole("heading").textContent).toBe("Forest loss (ha) 2010–2024");
    expect(captured.at(-1)!.data.map((d) => d.name)).toEqual(["Hansen yearly loss", "RADD confirmed", "RADD unconfirmed"]);
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(download.mock.calls[0]).toEqual(["demo-forest-loss.csv", "date,source,ha,confirmed\n2024,Hansen,41.5,\n2024-08-20,RADD,0.2,false\n2024-08-31,RADD,0.5,true\n"]);
    download.mockRestore();
  });

  it("a click on a Hansen year compares the Landsat years around it", async () => {
    setup();
    fireEvent.click(await screen.findByTestId("plot"));
    expect(screen.getByTestId("compare").textContent).toBe("2025");
  });
});
