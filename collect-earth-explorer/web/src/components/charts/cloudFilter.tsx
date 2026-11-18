import { useMemo } from "react";
import type { Point } from "../../lib/csv";
import { usePref } from "../../lib/prefs";

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
 */
export function useCloudFilter(points: Point[] | undefined) {
  const [maxCloud, setMaxCloud] = usePref("explorer.maxCloud", "any");
  const filtered = useMemo(() => {
    if (!points || maxCloud === "any") return points;
    const max = Number(maxCloud);
    return points.filter((p) => typeof p.cloud !== "number" || p.cloud <= max);
  }, [points, maxCloud]);
  const control = (
    <select
      aria-label="Maximum scene cloud cover"
      value={maxCloud}
      disabled={!points?.some((p) => typeof p.cloud === "number")}
      onChange={(e) => setMaxCloud(e.target.value)}
    >
      <option value="any">☁️ Any cloud</option>
      {LIMITS.map(([l, icon]) => (
        <option key={l} value={l}>
          {icon} max {l} %
        </option>
      ))}
    </select>
  );
  return { points: filtered, control };
}
