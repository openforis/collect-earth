import { usePlot } from "../state/PlotContext";
import { indexLabel } from "../lib/config";
import { useFolds } from "../lib/folds";
import { t } from "../lib/i18n";

const SUMMARY_SENSORS: Record<string, string> = { "landsat-series": "Landsat", "sentinel2-series": "Sentinel-2", "hls-series": "HLS" };

/**
 * One line per open Landsat/Sentinel-2/HLS series chart with its verdict, from what the card publishes (no request of its
 * own); a line from the first render, so the charts below do not jump. Each scrolls to its card.
 */
export default function Summary() {
  const { charts, summaries } = usePlot();
  const { isOpen } = useFolds();
  const lines = charts.flatMap((c, i) => (SUMMARY_SENSORS[c.type] && isOpen(c, i) && summaries[i]?.status !== "error" ? [i] : []));
  if (lines.length === 0) return null;
  return (
    <ul className="summary" aria-label={t("summary.aria")}>
      {lines.map((i) => {
        const name = `${SUMMARY_SENSORS[charts[i].type]} ${indexLabel(charts[i].params)}`;
        const s = summaries[i];
        const r = s?.status === "done" ? s.result : undefined;
        const verdict = t(r ? `summary.${r.trend}` : "summary.loading");
        const rest =
          (r?.change !== undefined ? ` · ${t("summary.change", { year: r.change })}` : "") +
          (r?.last !== undefined ? ` · ${t("summary.last", { date: new Date(r.last).toISOString().slice(0, 10) })}` : "");
        return (
          <li key={i}>
            <button className="summary-line" onClick={() => document.getElementById(`chart-${i}`)?.scrollIntoView({ block: "start" })}>
              <span className="summary-name">{name}:</span>{" "}
              <span className={r?.trend === "increase" || r?.trend === "decrease" ? "summary-significant" : undefined}>{verdict}</span>
              {rest}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
