import { usePlot } from "../state/PlotContext";
import { indexLabel } from "../lib/config";
import { useFolds } from "../lib/folds";

const SUMMARY_SENSORS: Record<string, string> = { "landsat-series": "Landsat", "sentinel2-series": "Sentinel-2" };
const TREND_TEXT = { increase: "significant increase", decrease: "significant decrease", none: "no significant trend", "too-few": "too few years for a trend" };

/**
 * One line per open Landsat/Sentinel-2 series chart with its verdict, from what the card publishes (no request of its
 * own); a line from the first render, so the charts below do not jump. Each scrolls to its card.
 */
export default function Summary() {
  const { charts, summaries } = usePlot();
  const { isOpen } = useFolds();
  const lines = charts.flatMap((c, i) => (SUMMARY_SENSORS[c.type] && isOpen(c, i) && summaries[i]?.status !== "error" ? [i] : []));
  if (lines.length === 0) return null;
  return (
    <ul className="summary" aria-label="Summary">
      {lines.map((i) => {
        const name = `${SUMMARY_SENSORS[charts[i].type]} ${indexLabel(charts[i].params)}`;
        const s = summaries[i];
        const r = s?.status === "done" ? s.result : undefined;
        const verdict = r ? TREND_TEXT[r.trend] : "loading…";
        const rest = (r?.change !== undefined ? ` · change in ${r.change}` : "") + (r?.last !== undefined ? ` · last image ${new Date(r.last).toISOString().slice(0, 10)}` : "");
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
