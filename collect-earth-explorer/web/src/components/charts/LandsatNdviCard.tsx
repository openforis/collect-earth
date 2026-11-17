import { useState } from "react";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest, normaliseFormula, type ChartEntry } from "../../lib/config";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function LandsatNdviCard({ params }: { params: ChartEntry["params"] }) {
  const { plot, start, end, plotId, setScene } = usePlot();
  const index = params.index as string;
  const formula = params.formula === undefined ? undefined : normaliseFormula(params.formula as string);
  // What the chart is called: the index, or the custom formula's name.
  const label = formula === undefined ? index : (params.name as string | undefined) || "Custom index";
  const [open, setOpen] = useState(!params.collapsed);
  const { path, body } = chartRequest({ type: "landsat-series", params }, { plot, start, end });
  const state = useApi<{ points: Point[] }>((s) => postApi(path, body, s), [plot, start, end, index, formula], { enabled: open });
  return (
    <ChartCard
      title={`Landsat ${label} (click a point to view that scene)`}
      state={state}
      collapsed={!open}
      onExpand={() => setOpen(true)}
      onDownload={() => downloadText(`${plotId || "plot"}-landsat-${label.toLowerCase().replace(/\s+/g, "-")}.csv`, pointsToCsv(state.data!.points, ["sensor"]))}
    >
      {(d) => (
        <SeriesChart
          points={d.points}
          name={label}
          onClickPoint={(p) =>
            setScene({ sensor: "landsat", timeStart: p.date, label: `${String(p.sensor).replace("_", " ")} ${isoDay(p.date)}` })
          }
        />
      )}
    </ChartCard>
  );
}
