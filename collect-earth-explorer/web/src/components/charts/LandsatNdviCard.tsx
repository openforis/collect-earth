import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import type { ChartEntry } from "../../lib/config";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function LandsatNdviCard({ params }: { params: ChartEntry["params"] }) {
  const { plot, start, end, plotId, setScene } = usePlot();
  const index = params.index as string;
  const body = { plot, start, end, ...(index !== "NDVI" && { index }) };
  const state = useApi<{ points: Point[] }>((s) => postApi("series/landsat", body, s), [plot, start, end, index]);
  return (
    <ChartCard
      title={`Landsat ${index} (click a point to view that scene)`}
      state={state}
      onDownload={() => downloadText(`${plotId || "plot"}-landsat-${index.toLowerCase()}.csv`, pointsToCsv(state.data!.points, ["sensor"]))}
    >
      {(d) => (
        <SeriesChart
          points={d.points}
          name={index}
          onClickPoint={(p) =>
            setScene({ sensor: "landsat", timeStart: p.date, label: `${String(p.sensor).replace("_", " ")} ${isoDay(p.date)}` })
          }
        />
      )}
    </ChartCard>
  );
}
