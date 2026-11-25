import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useCloudFilter, usePublishSummary } from "./cloudFilter";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot, type Scene } from "../../state/PlotContext";
import { useFold, type CardProps } from "../../lib/folds";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest, indexLabel, normaliseFormula, withYears } from "../../lib/config";
import { t } from "../../lib/i18n";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Per index series type: the title's sensor name, the scene sensor of a clicked point and its label's sensor, the
 * CSV file name part and extra columns, and the composite layer "Compare years" uses.
 */
const SERIES = {
  "landsat-series": { name: "Landsat", sensor: "landsat", sceneName: (p: Point) => String(p.sensor).replace("_", " "), file: "landsat", columns: ["sensor", "cloud"], layer: "landsat" },
  "sentinel2-series": { name: "Sentinel-2", sensor: "sentinel2", sceneName: () => "Sentinel-2", file: "sentinel2", columns: ["cloud"], layer: "sentinel2" },
  // There is no HLS layer: its years are compared on the Landsat composites.
  "hls-series": { name: "HLS", sensor: "hls", sceneName: (p: Point) => String(p.sensor), file: "hls", columns: ["sensor", "cloud"], layer: "landsat" },
} as const;

/** The Landsat, Sentinel-2 and HLS index series cards. */
export default function IndexSeriesCard({ type, ...props }: CardProps & { type: keyof typeof SERIES }) {
  const { params, index: position = 0 } = props;
  const { name, sensor, sceneName, file, columns, layer } = SERIES[type];
  const { plot, start, end, plotId, scene, setScene, canCompareAround, compareAround, compareScenes } = usePlot();
  const toScene = (p: Point): Scene => ({ sensor, timeStart: p.date, label: `${sceneName(p)} ${isoDay(p.date)}` });
  const index = params.index as string;
  const formula = params.formula === undefined ? undefined : normaliseFormula(params.formula as string);
  const label = indexLabel(params);
  const fold = useFold(type, props);
  const { path, body } = chartRequest({ type, params }, { plot, start, end });
  const state = useApi<{ points: Point[] }>((s) => postApi(path, body, s), [plot, start, end, index, formula], { enabled: fold.live });
  // The chart gets the points under the cloud limit; the CSV keeps them all.
  const cloud = useCloudFilter(state.data?.points, params.maxCloud as string);
  usePublishSummary(position, fold.open, state.status, cloud.points);
  return (
    <ChartCard
      title={withYears(`${name} ${label}`, params)}
      tooltip={t("series.clickTooltip")}
      state={state}
      open={fold.open}
      onToggle={fold.toggle}
      controls={cloud.control}
      onDownload={() => downloadText(`${plotId || "plot"}-${file}-${indexLabel(params, "Custom index").toLowerCase().replace(/\s+/g, "-")}.csv`, pointsToCsv(state.data!.points, [...columns]))}
    >
      {(d) => (
        <SeriesChart
          points={cloud.points ?? d.points}
          name={label}
          analyses={params}
          selected={scene?.sensor === sensor ? scene.timeStart : undefined}
          onCompareYears={canCompareAround(layer) ? (y) => compareAround(layer, y) : undefined}
          onClickPoint={(p) => setScene(toScene(p))}
          onCompareScenes={(a, b) => compareScenes(toScene(a), toScene(b))}
        />
      )}
    </ChartCard>
  );
}
