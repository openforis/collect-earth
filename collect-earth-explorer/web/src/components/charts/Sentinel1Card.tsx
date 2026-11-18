import { useState } from "react";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest, type ChartEntry } from "../../lib/config";

/** Backscatter in dB: most land lies between -25 and -5. */
const DB_RANGE: [number, number] = [-30, 0];

/** Sentinel-1 backscatter per acquisition; no scene click, as a radar scene cannot be shown on the map yet. */
export default function Sentinel1Card({ params }: { params: ChartEntry["params"] }) {
  const { plot, start, end, plotId } = usePlot();
  const band = params.band as string;
  const [open, setOpen] = useState(!params.collapsed);
  const { path, body } = chartRequest({ type: "sentinel1-series", params }, { plot, start, end });
  const state = useApi<{ points: Point[] }>((s) => postApi(path, body, s), [plot, start, end, band], { enabled: open });
  return (
    <ChartCard
      title={`Sentinel-1 ${band} backscatter (dB)`}
      state={state}
      collapsed={!open}
      onExpand={() => setOpen(true)}
      onDownload={() => downloadText(`${plotId || "plot"}-sentinel1-${band.toLowerCase()}.csv`, pointsToCsv(state.data!.points))}
    >
      {(d) => <SeriesChart points={d.points} name={`Sentinel-1 ${band}`} analyses={params} color="#6a4c93" yRange={DB_RANGE} />}
    </ChartCard>
  );
}
