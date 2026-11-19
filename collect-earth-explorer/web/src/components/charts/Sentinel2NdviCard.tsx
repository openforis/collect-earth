import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useCloudFilter, usePublishSummary } from "./cloudFilter";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { useFold, type CardProps } from "../../lib/folds";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";
import { chartRequest, indexLabel, normaliseFormula } from "../../lib/config";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function Sentinel2NdviCard(props: CardProps) {
  const { params, index: position = 0 } = props;
  const { plot, start, end, plotId, scene, setScene, canCompareAround, compareAround, compareScenes } = usePlot();
  const toScene = (p: Point) => ({ sensor: "sentinel2" as const, timeStart: p.date, label: `Sentinel-2 ${isoDay(p.date)}` });
  const index = params.index as string;
  const formula = params.formula === undefined ? undefined : normaliseFormula(params.formula as string);
  const label = indexLabel(params);
  const fold = useFold("sentinel2-series", props);
  const { path, body } = chartRequest({ type: "sentinel2-series", params }, { plot, start, end });
  const state = useApi<{ points: Point[] }>((s) => postApi(path, body, s), [plot, start, end, index, formula], { enabled: fold.live });
  // The chart gets the points under the cloud limit; the CSV keeps them all.
  const cloud = useCloudFilter(state.data?.points, params.maxCloud as string);
  usePublishSummary(position, fold.open, state.status, cloud.points);
  return (
    <ChartCard
      title={`Sentinel-2 ${label}`}
      tooltip="Click a point to view that scene on the map"
      state={state}
      open={fold.open}
      onToggle={fold.toggle}
      controls={cloud.control}
      onDownload={() => downloadText(`${plotId || "plot"}-sentinel2-${label.toLowerCase().replace(/\s+/g, "-")}.csv`, pointsToCsv(state.data!.points, ["cloud"]))}
    >
      {(d) => (
        <SeriesChart
          points={cloud.points ?? d.points}
          name={label}
          analyses={params}
          selected={scene?.sensor === "sentinel2" ? scene.timeStart : undefined}
          onCompareYears={canCompareAround("sentinel2") ? (y) => compareAround("sentinel2", y) : undefined}
          onClickPoint={(p) => setScene(toScene(p))}
          onCompareScenes={(a, b) => compareScenes(toScene(a), toScene(b))}
        />
      )}
    </ChartCard>
  );
}
