import { useMemo } from "react";
import { useFold, type CardProps } from "../../lib/folds";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest, withYears } from "../../lib/config";
import { usePref } from "../../lib/prefs";
import { againstNormal } from "../../lib/seriesStats";
import { t } from "../../lib/i18n";

/** The rainfall colour, also used for the bars under the MODIS chart. */
export const RAIN_COLOR = "#4a90d9";
/** Months drier than normal: orange-brown, apart from the rain blue for colour-blind readers too. */
const DRY_COLOR = "#c0782f";
const DATASET_NAMES: Record<string, string> = { "era5-land": "ERA5-Land", chirps: "CHIRPS", imerg: "GPM IMERG" };

/** The y axis from 0 to the wettest month rounded up to 100 mm, at least 100. */
const rainRange = (points: Point[]): [number, number] => [0, Math.max(100, Math.ceil(Math.max(0, ...points.map((p) => p.value)) / 100) * 100)];
/** Symmetric around 0, to the largest difference rounded up to 50 mm, at least 50. */
const anomalyRange = (points: Point[]): [number, number] => {
  const m = Math.max(50, Math.ceil(Math.max(0, ...points.map((p) => Math.abs(p.value))) / 50) * 50);
  return [-m, m];
};

/**
 * Monthly rainfall at the plot as bars; no scene click, as a month has no scene. "Against normal" shows each month minus
 * its calendar month's mean instead, and the analysis switches then apply to those differences.
 */
export default function PrecipitationCard(props: CardProps) {
  const { params } = props;
  const { plot, start, end, plotId } = usePlot();
  const fold = useFold("precipitation", props);
  const dataset = params.dataset as string;
  const datasetName = DATASET_NAMES[dataset];
  const { path, body } = chartRequest({ type: "precipitation", params }, { plot, start, end });
  const state = useApi<{ points: Point[] }>((s) => postApi(path, body, s), [plot, start, end], { enabled: fold.live });
  // As the analysis switches (SeriesChart useSwitch): a survey that starts with it on keeps the user's choice apart.
  const anomalyStart = params.anomaly === true;
  const [anomalyOn, setAnomaly] = usePref(`explorer.rainAnomaly${anomalyStart ? ".survey" : ""}`, anomalyStart);
  const points = state.data?.points;
  const anomaly = useMemo(() => points && againstNormal(points), [points]);
  const shown = anomalyOn && anomaly ? anomaly : undefined;
  const colors = useMemo(() => shown?.map((p) => (p.value < 0 ? DRY_COLOR : RAIN_COLOR)), [shown]);
  const suffix = dataset === "era5-land" ? "" : `-${dataset}`;
  return (
    <ChartCard
      title={withYears(t("rain.title"), params)}
      tooltip={t("rain.tooltip", { dataset: datasetName })}
      state={state}
      open={fold.open}
      onToggle={fold.toggle}
      onDownload={() => downloadText(`${plotId || "plot"}-rainfall${suffix}.csv`, pointsToCsv(state.data!.points))}
      controls={
        state.status === "done" && (
          <span className="chart-chips">
            <label title={t(anomaly ? "rain.anomalyTitle" : "rain.anomalyFew")}>
              <input type="checkbox" aria-label={t("rain.anomalyTitle")} disabled={!anomaly} checked={anomalyOn && !!anomaly} onChange={(e) => setAnomaly(e.target.checked)} />
              {t("rain.anomaly")}
            </label>
          </span>
        )
      }
    >
      {(d) =>
        d.points.length === 0 ? (
          <div className="chart-placeholder">{t(dataset === "chirps" ? "rain.chirpsCoverage" : "rain.empty")}</div>
        ) : shown ? (
          <SeriesChart points={shown} name={t("rain.anomalyName")} analyses={params} color={RAIN_COLOR} colors={colors} yRange={anomalyRange(shown)} bar />
        ) : (
          <SeriesChart points={d.points} name={t("rain.name")} analyses={params} color={RAIN_COLOR} yRange={rainRange(d.points)} bar />
        )
      }
    </ChartCard>
  );
}
