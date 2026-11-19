import { useFold, type CardProps } from "../../lib/folds";
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest } from "../../lib/config";
import { t } from "../../lib/i18n";

/** The rainfall colour, also used for the bars under the MODIS chart. */
export const RAIN_COLOR = "#4a90d9";

/** The y axis from 0 to the wettest month rounded up to 100 mm, at least 100. */
const rainRange = (points: Point[]): [number, number] => [0, Math.max(100, Math.ceil(Math.max(0, ...points.map((p) => p.value)) / 100) * 100)];

/** Monthly rainfall at the plot as bars; no scene click, as a month has no scene. */
export default function PrecipitationCard(props: CardProps) {
  const { params } = props;
  const { plot, start, end, plotId } = usePlot();
  const fold = useFold("precipitation", props);
  const { path, body } = chartRequest({ type: "precipitation", params }, { plot, start, end });
  const state = useApi<{ points: Point[] }>((s) => postApi(path, body, s), [plot, start, end], { enabled: fold.live });
  return (
    <ChartCard
      title={t("rain.title")}
      tooltip={t("rain.tooltip")}
      state={state}
      open={fold.open}
      onToggle={fold.toggle}
      onDownload={() => downloadText(`${plotId || "plot"}-rainfall.csv`, pointsToCsv(state.data!.points))}
    >
      {(d) => <SeriesChart points={d.points} name={t("rain.name")} analyses={params} color={RAIN_COLOR} yRange={rainRange(d.points)} bar />}
    </ChartCard>
  );
}
