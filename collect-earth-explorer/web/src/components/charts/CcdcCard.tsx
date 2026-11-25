import { useState } from "react";
import { useFold, type CardProps } from "../../lib/folds";
import ChartCard from "../ChartCard";
import CcdcChart, { type CcdcBand, type CcdcData } from "./CcdcChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText } from "../../lib/csv";
import { chartRequest, withYears } from "../../lib/config";
import { t } from "../../lib/i18n";

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function CcdcCard(props: CardProps) {
  const { params } = props;
  const { plot, start, end, plotId, scene, setScene } = usePlot();
  // The entry's band is only the initial choice; the select changes it.
  const [band, setBand] = useState<CcdcBand>(params.band as CcdcBand);
  const fold = useFold("ccdc", props);
  const { path, body } = chartRequest({ type: "ccdc", params: { ...params, band } }, { plot, start, end });
  const state = useApi<CcdcData>((s) => postApi(path, body, s), [plot, start, end, band], { enabled: fold.live });
  const controls = (
    <select aria-label={t("ccdc.bandAria")} value={band} onChange={(e) => setBand(e.target.value as CcdcBand)}>
      <option value="NDFI">NDFI</option>
      <option value="NDVI">NDVI</option>
    </select>
  );
  return (
    <ChartCard
      title={withYears("CCDC (Landsat)", params)}
      tooltip={t("ccdc.tooltip")}
      state={state}
      open={fold.open}
      onToggle={fold.toggle}
      controls={controls}
      onDownload={() => downloadText(`${plotId || "plot"}-ccdc-${band}.csv`, pointsToCsv(state.data!.observed))}
    >
      {(d) => (
        <CcdcChart
          data={d}
          selected={scene?.sensor === "landsat" ? scene.timeStart : undefined}
          onClickObserved={(p) => setScene({ sensor: "landsat", timeStart: p.date, label: `Landsat ${isoDay(p.date)}` })}
        />
      )}
    </ChartCard>
  );
}
