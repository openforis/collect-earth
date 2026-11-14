import { useState } from "react";
import ChartCard from "../ChartCard";
import CcdcChart, { type CcdcBand, type CcdcData } from "./CcdcChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText } from "../../lib/csv";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function CcdcCard() {
  const { plot, start, end, plotId, setScene } = usePlot();
  const [band, setBand] = useState<CcdcBand>("NDFI");
  const state = useApi<CcdcData>((s) => postApi("ccdc", { plot, start, end, band }, s), [plot, start, end, band]);
  const controls = (
    <select aria-label="CCDC band" value={band} onChange={(e) => setBand(e.target.value as CcdcBand)}>
      <option value="NDFI">NDFI</option>
      <option value="NDVI">NDVI</option>
    </select>
  );
  return (
    <ChartCard
      title="CCDC temporal segmentation (Landsat 7/8/9)"
      state={state}
      controls={controls}
      onDownload={() => downloadText(`${plotId || "plot"}-ccdc-${band}.csv`, pointsToCsv(state.data!.observed))}
    >
      {(d) => (
        <CcdcChart
          data={d}
          onClickObserved={(p) => setScene({ sensor: "landsat", timeStart: p.date, label: `Landsat ${isoDay(p.date)}` })}
        />
      )}
    </ChartCard>
  );
}
