import { useState } from "react";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import type { ChartEntry } from "../../lib/config";

interface Modis {
  ndvi: Point[];
  fires: { month: number; date: number }[];
}

export default function ModisCard({ params }: { params: ChartEntry["params"] }) {
  const { plot, start, end, plotId } = usePlot();
  const index = params.index as string;
  const [open, setOpen] = useState(!params.collapsed);
  const body = { plot, start, end, ...(index !== "NDVI" && { index }) };
  const state = useApi<Modis>((s) => postApi("series/modis", body, s), [plot, start, end, index], { enabled: open });
  return (
    <ChartCard
      title={`MODIS 16-day ${index} (250 m) and burned area`}
      state={state}
      collapsed={!open}
      onExpand={() => setOpen(true)}
      onDownload={() => downloadText(`${plotId || "plot"}-modis-${index.toLowerCase()}.csv`, pointsToCsv(state.data!.ndvi))}
    >
      {(d) => (
        <SeriesChart
          points={d.ndvi}
          name={`MODIS ${index}`}
          color="#1565c0"
          markers={{ x: d.fires.map((f) => f.date), name: "Burned (MCD64A1)", color: "#d32f2f" }}
        />
      )}
    </ChartCard>
  );
}
