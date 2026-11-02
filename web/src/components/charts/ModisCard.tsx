import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";

interface Modis {
  ndvi: Point[];
  fires: { month: number; date: number }[];
}

export default function ModisCard() {
  const { plot, start, end, plotId } = usePlot();
  const state = useApi<Modis>((s) => postApi("series/modis", { plot, start, end }, s), [plot, start, end]);
  return (
    <ChartCard
      title="MODIS 16-day NDVI (250 m) and burned area"
      state={state}
      onDownload={() => downloadText(`${plotId || "plot"}-modis-ndvi.csv`, pointsToCsv(state.data!.ndvi))}
    >
      {(d) => (
        <SeriesChart
          points={d.ndvi}
          name="MODIS NDVI"
          color="#1565c0"
          markers={{ x: d.fires.map((f) => f.date), name: "Burned (MCD64A1)", color: "#d32f2f" }}
        />
      )}
    </ChartCard>
  );
}
