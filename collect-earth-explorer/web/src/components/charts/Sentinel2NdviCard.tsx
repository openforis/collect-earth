import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function Sentinel2NdviCard() {
  const { plot, start, end, plotId, setScene } = usePlot();
  const state = useApi<{ points: Point[] }>((s) => postApi("series/sentinel2", { plot, start, end }, s), [plot, start, end]);
  return (
    <ChartCard
      title="Sentinel-2 NDVI (click a point to view that scene)"
      state={state}
      onDownload={() => downloadText(`${plotId || "plot"}-sentinel2-ndvi.csv`, pointsToCsv(state.data!.points))}
    >
      {(d) => (
        <SeriesChart
          points={d.points}
          name="NDVI"
          onClickPoint={(p) => setScene({ sensor: "sentinel2", timeStart: p.date, label: `Sentinel-2 ${isoDay(p.date)}` })}
        />
      )}
    </ChartCard>
  );
}
