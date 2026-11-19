import { useMemo } from "react";
import { useFold, type CardProps } from "../../lib/folds";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest } from "../../lib/config";
import { usePref } from "../../lib/prefs";
import { RAIN_COLOR } from "./PrecipitationCard";
import { t } from "../../lib/i18n";

interface Modis {
  ndvi: Point[];
  fires: { month: number; date: number }[];
}

export default function ModisCard(props: CardProps) {
  const { params } = props;
  const { plot, start, end, plotId } = usePlot();
  const index = params.index as string;
  const fold = useFold("modis", props);
  const { path, body } = chartRequest({ type: "modis", params }, { plot, start, end });
  const state = useApi<Modis>((s) => postApi(path, body, s), [plot, start, end, index], { enabled: fold.live });
  // As the analysis switches (SeriesChart useSwitch): a survey that starts with rain on keeps the user's choice apart.
  const rainStart = params.rainfall === true;
  const [rain, setRain] = usePref(`explorer.rain${rainStart ? ".survey" : ""}`, rainStart);
  // The standalone rainfall card's request, so both share the server's answer.
  const rainRequest = chartRequest({ type: "precipitation", params: {} }, { plot, start, end });
  const rainState = useApi<{ points: Point[] }>((s) => postApi(rainRequest.path, rainRequest.body, s), [plot, start, end], { enabled: fold.live && rain });
  const rainPoints = rain ? rainState.data?.points : undefined;
  // Only the months MODIS covers (from 2000): rainfall goes back further and would stretch the time axis.
  const first = state.data?.ndvi[0]?.date;
  const bars = useMemo(
    () => rainPoints && { points: first === undefined ? rainPoints : rainPoints.filter((p) => p.date >= first - 31 * 86400000), name: t("rain.title"), color: RAIN_COLOR },
    [rainPoints, first],
  );
  return (
    <ChartCard
      title={`MODIS ${index}`}
      tooltip={t("modis.tooltip", { index })}
      state={state}
      open={fold.open}
      onToggle={fold.toggle}
      onDownload={() => downloadText(`${plotId || "plot"}-modis-${index.toLowerCase()}.csv`, pointsToCsv(state.data!.ndvi))}
      controls={
        <>
          {rain && rainState.status === "error" && <span>{t("modis.rainUnavailable")}</span>}
          <span className="chart-chips">
            <label title={t("modis.rainTitle")}>
              <input type="checkbox" aria-label={t("rain.name")} checked={rain} onChange={(e) => setRain(e.target.checked)} />
              {t("modis.rain")}
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
          markers={{ x: d.fires.map((f) => f.date), name: t("modis.burned"), color: "#d32f2f" }}
          bars={bars}
        />
      )}
    </ChartCard>
  );
}
