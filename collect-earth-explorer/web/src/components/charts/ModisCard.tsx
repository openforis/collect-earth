import { useMemo, useState } from "react";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest, type ChartEntry } from "../../lib/config";
import { usePref } from "../../lib/prefs";
import { RAIN_COLOR } from "./PrecipitationCard";

interface Modis {
  ndvi: Point[];
  fires: { month: number; date: number }[];
}

export default function ModisCard({ params }: { params: ChartEntry["params"] }) {
  const { plot, start, end, plotId } = usePlot();
  const index = params.index as string;
  const [open, setOpen] = useState(!params.collapsed);
  const { path, body } = chartRequest({ type: "modis", params }, { plot, start, end });
  const state = useApi<Modis>((s) => postApi(path, body, s), [plot, start, end, index], { enabled: open });
  // As the analysis switches (SeriesChart useSwitch): a survey that starts with rain on keeps the user's choice apart.
  const rainStart = params.rainfall === true;
  const [rain, setRain] = usePref(`explorer.rain${rainStart ? ".survey" : ""}`, rainStart);
  // The standalone rainfall card's request, so both share the server's answer.
  const rainRequest = chartRequest({ type: "precipitation", params: {} }, { plot, start, end });
  const rainState = useApi<{ points: Point[] }>((s) => postApi(rainRequest.path, rainRequest.body, s), [plot, start, end], { enabled: open && rain });
  const rainPoints = rain ? rainState.data?.points : undefined;
  // Only the months MODIS covers (from 2000): rainfall goes back further and would stretch the time axis.
  const first = state.data?.ndvi[0]?.date;
  const bars = useMemo(
    () => rainPoints && { points: first === undefined ? rainPoints : rainPoints.filter((p) => p.date >= first - 31 * 86400000), name: "Rainfall (mm)", color: RAIN_COLOR },
    [rainPoints, first],
  );
  return (
    <ChartCard
      title={`MODIS 16-day ${index} (250 m) and burned area`}
      state={state}
      collapsed={!open}
      onExpand={() => setOpen(true)}
      onDownload={() => downloadText(`${plotId || "plot"}-modis-${index.toLowerCase()}.csv`, pointsToCsv(state.data!.ndvi))}
      controls={
        <>
          {rain && rainState.status === "error" && <span>Rainfall unavailable</span>}
          <span className="chart-chips">
            <label title="Monthly rainfall (ERA5-Land) under the chart">
              <input type="checkbox" aria-label="Rainfall" checked={rain} onChange={(e) => setRain(e.target.checked)} />
              Rain
            </label>
          </span>
        </>
      }
    >
      {(d) => (
        <SeriesChart
          points={d.ndvi}
          name={`MODIS ${index}`}
          analyses={params}
          color="#1770DD"
          markers={{ x: d.fires.map((f) => f.date), name: "Burned (MCD64A1)", color: "#d32f2f" }}
          bars={bars}
        />
      )}
    </ChartCard>
  );
}
