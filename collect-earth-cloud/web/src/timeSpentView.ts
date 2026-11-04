// The words of the time spent on each plot (components/TimeSpent.tsx), kept apart from React so they are tested.
import type { Translate } from "./i18n";
import { durationText } from "./peopleView";

/** A time in seconds as words: "45 s", "3 min 20 s", "12 min"; from an hour on, "2 h 5 min". */
export function secondsText(t: Translate, seconds: number): string {
  if (seconds < 3600) return durationText(t, seconds * 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes === 0 ? t("timeSpent.hours", { h: hours }) : t("timeSpent.hoursMinutes", { h: hours, m: minutes });
}

/** The bands' words: "under 30 s", "30 s to 1 min", … "20 min or more". */
export function bandLabels(t: Translate, limits: readonly number[]): string[] {
  const d = (s: number) => secondsText(t, s);
  return [
    ...limits.map((limit, i) => (i === 0 ? t("person.under", { d: d(limit) }) : t("person.between", { from: d(limits[i - 1]), to: d(limit) }))),
    t("timeSpent.orMore", { d: d(limits[limits.length - 1]) }),
  ];
}

/** The bands under the quick limit, which a chart draws in the warning colour (none while there is no limit). */
export function quickBands(limits: readonly number[], quickBelow: number | null): boolean[] {
  return [...limits.map((limit) => quickBelow !== null && limit <= quickBelow), false];
}

/** The bands' short words under a chart's columns: "<30 s", "30 s", "1 min", … "20 min+" (each band's start). */
export function bandShortLabels(t: Translate, limits: readonly number[]): string[] {
  const d = (s: number) => secondsText(t, s);
  return [`<${d(limits[0])}`, ...limits.slice(0, -1).map(d), `${d(limits[limits.length - 1])}+`];
}
