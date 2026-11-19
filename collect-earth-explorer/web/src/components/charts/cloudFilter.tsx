import { useEffect, useMemo } from "react";
import type { Point } from "../../lib/csv";
import { usePref } from "../../lib/prefs";
import { summarize } from "../../lib/seriesStats";
import { usePlot } from "../../state/PlotContext";
import type { Status } from "../../hooks/useApi";
import { t } from "../../lib/i18n";

/** Each limit with its icon: from full cloud (no limit) through sun behind cloud to sun (nearly clear scenes only). */
const LIMITS = [
  ["80", "🌥️"],
  ["60", "🌥️"],
  ["40", "⛅"],
  ["20", "🌤️"],
  ["10", "☀️"],
];

/**
 * The scene cloud-cover limit shared by the Landsat and Sentinel-2 cards: the points under it (a point
 * without a numeric `cloud` is kept), memoised so the chart sees a stable list, and the select for the card.
 * `start` is the survey's limit (the chart entry's `maxCloud`); under one that is not the standard 40 the user's
 * choice is stored apart, as for the analysis switches (SeriesChart `useSwitch`).
 */
export function useCloudFilter(points: Point[] | undefined, start = "40") {
  const [maxCloud, setMaxCloud] = usePref(`explorer.maxCloud${start === "40" ? "" : ".survey"}`, start);
  const filtered = useMemo(() => {
    if (!points || maxCloud === "any") return points;
    const max = Number(maxCloud);
    return points.filter((p) => typeof p.cloud !== "number" || p.cloud <= max);
  }, [points, maxCloud]);
  const control = (
    <select
      aria-label={t("cloud.aria")}
      value={maxCloud}
      disabled={!points?.some((p) => typeof p.cloud === "number")}
      onChange={(e) => setMaxCloud(e.target.value)}
    >
      <option value="any">☁️ {t("cloud.any")}</option>
      {LIMITS.map(([l, icon]) => (
        <option key={l} value={l}>
          {icon} {t("cloud.max", { n: l })}
        </option>
      ))}
    </select>
  );
  return { points: filtered, control };
}

/** Publishes a series card's summary line (see `summaries`) of `points` while the card is open; nothing when folded or gone. */
export function usePublishSummary(index: number, open: boolean, status: Status, points: Point[] | undefined) {
  const { setSummary } = usePlot();
  const result = useMemo(() => (points ? summarize(points) : undefined), [points]);
  useEffect(() => {
    setSummary(index, open ? { status, result } : undefined);
    return () => setSummary(index, undefined);
  }, [setSummary, index, open, status, result]);
}
