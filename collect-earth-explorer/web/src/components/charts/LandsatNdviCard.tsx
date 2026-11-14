import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function LandsatNdviCard() {
  const { plot, start, end, plotId, setScene } = usePlot();
  const state = useApi<{ points: Point[] }>((s) => postApi("series/landsat", { plot, start, end }, s), [plot, start, end]);
  return (
    <ChartCard
      title="Landsat NDVI (click a point to view that scene)"
      state={state}
      onDownload={() => downloadText(`${plotId || "plot"}-landsat-ndvi.csv`, pointsToCsv(state.data!.points, ["sensor"]))}
    >
      {(d) => (
        <SeriesChart
          points={d.points}
          name="NDVI"
          onClickPoint={(p) =>
            setScene({ sensor: "landsat", timeStart: p.date, label: `${String(p.sensor).replace("_", " ")} ${isoDay(p.date)}` })
          }
        />
      )}
    </ChartCard>
  );
}
