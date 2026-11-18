import { useState } from "react";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest, type ChartEntry } from "../../lib/config";

/** The rainfall colour, also used for the bars under the MODIS chart. */
export const RAIN_COLOR = "#4a90d9";

/** The y axis from 0 to the wettest month rounded up to 100 mm, at least 100. */
const rainRange = (points: Point[]): [number, number] => [0, Math.max(100, Math.ceil(Math.max(0, ...points.map((p) => p.value)) / 100) * 100)];

/** Monthly rainfall at the plot as bars; no scene click, as a month has no scene. */
export default function PrecipitationCard({ params }: { params: ChartEntry["params"] }) {
  const { plot, start, end, plotId } = usePlot();
  const [open, setOpen] = useState(!params.collapsed);
  const { path, body } = chartRequest({ type: "precipitation", params }, { plot, start, end });
  const state = useApi<{ points: Point[] }>((s) => postApi(path, body, s), [plot, start, end], { enabled: open });
  return (
    <ChartCard
      title="Monthly rainfall (mm, ERA5-Land)"
      state={state}
      collapsed={!open}
      onExpand={() => setOpen(true)}
      onDownload={() => downloadText(`${plotId || "plot"}-rainfall.csv`, pointsToCsv(state.data!.points))}
    >
      {(d) => <SeriesChart points={d.points} name="Rainfall" analyses={params} color={RAIN_COLOR} yRange={rainRange(d.points)} bar />}
    </ChartCard>
  );
}
