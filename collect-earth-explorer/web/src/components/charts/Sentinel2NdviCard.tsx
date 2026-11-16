import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import type { ChartEntry } from "../../lib/config";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function Sentinel2NdviCard({ params }: { params: ChartEntry["params"] }) {
  const { plot, start, end, plotId, setScene } = usePlot();
  const index = params.index as string;
  const body = { plot, start, end, ...(index !== "NDVI" && { index }) };
  const state = useApi<{ points: Point[] }>((s) => postApi("series/sentinel2", body, s), [plot, start, end, index]);
  return (
    <ChartCard
      title={`Sentinel-2 ${index} (click a point to view that scene)`}
      state={state}
      onDownload={() => downloadText(`${plotId || "plot"}-sentinel2-${index.toLowerCase()}.csv`, pointsToCsv(state.data!.points))}
    >
      {(d) => (
        <SeriesChart
          points={d.points}
          name={index}
          onClickPoint={(p) => setScene({ sensor: "sentinel2", timeStart: p.date, label: `Sentinel-2 ${isoDay(p.date)}` })}
        />
      )}
    </ChartCard>
  );
}
