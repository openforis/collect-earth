import { useState } from "react";
import { hashOf, readPref, usePref, writePref } from "./prefs";
import type { ChartEntry } from "./config";
import { usePlot } from "../state/PlotContext";

/**
 * Which chart cards the user folded, remembered between plots: one JSON object per configuration's charts
 * (so another survey's are not affected), keyed by each chart's position and type.
 */
export const foldsKey = (charts: ChartEntry[]) => `explorer.folds.${hashOf(charts)}`;
const idOf = (entry: ChartEntry, i: number) => `${i}:${entry.type}`;

function parse(stored: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(stored);
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch {
    // corrupt: nothing stored
  }
  return {};
}

/** The user's stored choice for chart `i`, else the configuration's `collapsed`. */
const openIn = (stored: string, entry: ChartEntry, i: number) => {
  const v = parse(stored)[idOf(entry, i)];
  return typeof v === "boolean" ? v : !entry.params.collapsed;
};

/** Whether chart `i` of `charts` will open unfolded (read once, for the next-plot warm-up). */
export const chartOpen = (charts: ChartEntry[], i: number) => openIn(readPref(foldsKey(charts), "{}"), charts[i], i);

/** Whether each chart of the configuration is open, following the stored folds live. */
export function useFolds() {
  const { charts } = usePlot();
  const key = foldsKey(charts);
  const [stored] = usePref(key, "{}");
  return {
    isOpen: (entry: ChartEntry, i: number) => openIn(stored, entry, i),
    setOpen: (entry: ChartEntry, i: number, open: boolean) => writePref(key, JSON.stringify({ ...parse(readPref(key, "{}")), [idOf(entry, i)]: open })),
  };
}

/** The props of a chart card: its entry's parameters and its position in the configuration. */
export interface CardProps {
  params: ChartEntry["params"];
  index?: number;
}

/**
 * A card's fold: whether it is `open`, whether it may request (`live`: from the first time it is open, so a
 * card folded after loading keeps its data and unfolds without refetching) and the header's `toggle`.
 */
export function useFold(type: string, { params, index = 0 }: CardProps) {
  const { isOpen, setOpen } = useFolds();
  const entry = { type, params };
  const open = isOpen(entry, index);
  const [live, setLive] = useState(open);
  if (open && !live) setLive(true);
  return { open, live, toggle: () => setOpen(entry, index, !open) };
}
