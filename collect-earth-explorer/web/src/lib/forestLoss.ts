/** The forest loss answer (functions/ee/forestLoss.js) and what the card makes of it, in the browser. */

export interface Alert { date: number; ha: number; source: "RADD" | "GLAD"; confirmed: boolean }
export interface ForestLoss {
  plotHa: number;
  /** Hansen's mean tree cover over the plot in 2000, in percent; null where it has no data. */
  treeCover2000: number | null;
  hansen: { year: number; ha: number }[];
  alerts: Alert[];
  coverage: { radd: boolean; glad: boolean };
}

/** The Hansen years and alerts inside [start, end) (YYYY-MM-DD): the server answers every year, the card shows the chart's period. */
export function inPeriod(d: ForestLoss, start: string, end: string): ForestLoss {
  const from = Date.parse(start), to = Date.parse(end);
  return {
    ...d,
    hansen: d.hansen.filter((h) => Date.UTC(h.year + 1, 0, 1) > from && Date.UTC(h.year, 0, 1) < to),
    alerts: d.alerts.filter((a) => a.date >= from && a.date < to),
  };
}

/** One source's alerts summed per UTC month, confirmed and unconfirmed apart, sorted. */
export function alertsByMonth(alerts: Alert[], source: Alert["source"]): { month: number; confirmed: number; unconfirmed: number }[] {
  const months = new Map<number, { month: number; confirmed: number; unconfirmed: number }>();
  for (const a of alerts) {
    if (a.source !== source) continue;
    const d = new Date(a.date);
    const month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const m = months.get(month) ?? { month, confirmed: 0, unconfirmed: 0 };
    if (a.confirmed) m.confirmed += a.ha;
    else m.unconfirmed += a.ha;
    months.set(month, m);
  }
  return [...months.values()].sort((a, b) => a.month - b.month);
}

/** The CSV download: Hansen's years, then the alerts by date. */
export function forestLossCsv(d: ForestLoss): string {
  const rows = [
    ...d.hansen.map((h) => `${h.year},Hansen,${h.ha},`),
    ...d.alerts.map((a) => `${new Date(a.date).toISOString().slice(0, 10)},${a.source},${a.ha},${a.confirmed}`),
  ];
  return "date,source,ha,confirmed\n" + rows.map((r) => r + "\n").join("");
}
